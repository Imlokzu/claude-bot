from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
import time
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

import brain_context
import dream_cycle
import main
import memory


EMPTY_RESPONSE = json.dumps({"people": {}, "life": {}, "topics": {}, "pets": {}})


class DreamCycleTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        for category in ("logs", "people", "life", "topics", "pets"):
            (self.root / category).mkdir(parents=True)
        # Both modules re-export brain_context.BRAIN_DIR; patch the canonical root.
        self.brain_patch = patch.object(brain_context, "BRAIN_DIR", self.root)
        self.brain_patch.start()

    def tearDown(self) -> None:
        self.brain_patch.stop()
        self.temp_dir.cleanup()

    def _write(self, relative: str, content: str) -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    async def test_request_prefers_anyrouter_and_normalizes_url(self) -> None:
        response = unittest.mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"choices": [{"message": {"content": EMPTY_RESPONSE}}]}
        post = AsyncMock(return_value=response)
        client = unittest.mock.MagicMock()
        client.__aenter__.return_value.post = post
        env = {
            "ANYROUTER_API_KEY": "router-key",
            "ANYROUTER_BASE_URL": "https://router.example/v1///",
            "DREAM_CYCLE_API_KEY": "cycle-key",
            "DREAM_CYCLE_BASE_URL": "https://cycle.example/v1",
            "DEEPSEEK_API_KEY": "legacy-key",
            "DEEPSEEK_BASE_URL": "https://legacy.example/v1",
        }

        with patch.dict(os.environ, env, clear=True), patch.object(
            dream_cycle.httpx, "AsyncClient", return_value=client
        ):
            result = await dream_cycle._request("prompt")

        self.assertEqual(result, EMPTY_RESPONSE)
        _, kwargs = post.call_args
        self.assertEqual(post.call_args.args[0], "https://router.example/v1/chat/completions")
        self.assertEqual(kwargs["json"]["model"], "deepseek/DeepSeek-V4-Flash")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer router-key")

    async def test_request_supports_dream_cycle_and_configured_model(self) -> None:
        response = unittest.mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
        post = AsyncMock(return_value=response)
        client = unittest.mock.MagicMock()
        client.__aenter__.return_value.post = post
        env = {
            "DREAM_CYCLE_API_KEY": "cycle-key",
            "DREAM_CYCLE_BASE_URL": "http://localhost:9000/v1/",
            "DREAM_CYCLE_MODEL": "custom/model",
        }

        with patch.dict(os.environ, env, clear=True), patch.object(
            dream_cycle.httpx, "AsyncClient", return_value=client
        ):
            await dream_cycle._request("prompt")

        _, kwargs = post.call_args
        self.assertEqual(post.call_args.args[0], "http://localhost:9000/v1/chat/completions")
        self.assertEqual(kwargs["json"]["model"], "custom/model")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer cycle-key")

    async def test_request_supports_legacy_deepseek_environment(self) -> None:
        response = unittest.mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {"choices": [{"message": {"content": "ok"}}]}
        post = AsyncMock(return_value=response)
        client = unittest.mock.MagicMock()
        client.__aenter__.return_value.post = post

        with patch.dict(
            os.environ,
            {"DEEPSEEK_API_KEY": "legacy-key", "DEEPSEEK_BASE_URL": "https://api.deepseek.test/v1"},
            clear=True,
        ), patch.object(dream_cycle.httpx, "AsyncClient", return_value=client):
            await dream_cycle._request("prompt")

        self.assertEqual(post.call_args.args[0], "https://api.deepseek.test/v1/chat/completions")
        self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer legacy-key")

    async def test_request_missing_key_does_not_make_http_call(self) -> None:
        client_factory = unittest.mock.MagicMock()
        with patch.dict(
            os.environ, {"DREAM_CYCLE_BASE_URL": "https://cycle.example/v1"}, clear=True
        ), patch.object(dream_cycle.httpx, "AsyncClient", client_factory):
            with self.assertRaisesRegex(dream_cycle.DreamCycleError, "DREAM_CYCLE_API_KEY"):
                await dream_cycle._request("prompt")
        client_factory.assert_not_called()

    async def test_request_http_error_redacts_key_and_provider_details(self) -> None:
        secret = "do-not-expose-this-key"
        request = dream_cycle.httpx.Request("POST", "https://router.example/v1/chat/completions")
        response = dream_cycle.httpx.Response(401, request=request, text=f"invalid {secret}")
        post = AsyncMock(side_effect=dream_cycle.httpx.HTTPStatusError(f"invalid {secret}", request=request, response=response))
        client = unittest.mock.MagicMock()
        client.__aenter__.return_value.post = post

        with patch.dict(
            os.environ,
            {"ANYROUTER_API_KEY": secret, "ANYROUTER_BASE_URL": "https://router.example/v1"},
            clear=True,
        ), patch.object(dream_cycle.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(dream_cycle.DreamCycleError) as caught:
                await dream_cycle._request("prompt")

        self.assertEqual(str(caught.exception), "API request failed")
        self.assertNotIn(secret, str(caught.exception))

    def test_load_recent_logs_filters_last_three_calendar_dates(self) -> None:
        self._write("logs/2026-07-29.md", "today")
        self._write("logs/2026-07-28.md", "yesterday")
        self._write("logs/2026-07-27.md", "two days ago")
        self._write("logs/2026-07-26.md", "old")
        self._write("logs/smoke-test.md", "not dated")

        result = dream_cycle.load_recent_logs(today=date(2026, 7, 29))

        self.assertEqual(
            result,
            {
                "2026-07-27.md": "two days ago",
                "2026-07-28.md": "yesterday",
                "2026-07-29.md": "today",
            },
        )

    async def test_omission_preserves_existing_and_non_model_safe_notes(self) -> None:
        self._write("people/owner.md", "# Owner\n\nOriginal durable fact")
        self._write("people/name with spaces.md", "# Special Name\n\nPreserve this too")
        self._write("topics/legacy.md", "# Legacy\n\nNever delete by omission")

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=EMPTY_RESPONSE)):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertEqual((self.root / "people/owner.md").read_text(), "# Owner\n\nOriginal durable fact")
        self.assertEqual(
            (self.root / "people/name with spaces.md").read_text(),
            "# Special Name\n\nPreserve this too",
        )
        self.assertEqual((self.root / "topics/legacy.md").read_text(), "# Legacy\n\nNever delete by omission")

    async def test_success_upserts_and_builds_descriptive_indexes(self) -> None:
        self._write("people/owner.md", "# Owner\n\nOld")
        self._write("people/ім'я note.md", "# Особлива людина\n\nВажлива давня нотатка.")
        response = json.dumps(
            {
                "people": {"owner.md": "# Owner\n\nBuilds thoughtful robots."},
                "life": {"routine.md": "# Morning Routine\n\nWalk before breakfast."},
                "topics": {},
                "pets": {},
            }
        )

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertEqual((self.root / "people/owner.md").read_text(), "# Owner\n\nBuilds thoughtful robots.")
        people_index = (self.root / "people/_index.md").read_text()
        self.assertIn("- [Owner](owner.md) - Builds thoughtful robots.\n", people_index)
        self.assertIn(
            "- [Особлива людина](%D1%96%D0%BC%27%D1%8F%20note.md) - Важлива давня нотатка.\n",
            people_index,
        )
        self.assertEqual(
            (self.root / "life/_index.md").read_text(),
            "- [Morning Routine](routine.md) - Walk before breakfast.\n",
        )

    async def test_same_cycle_people_to_pet_link_commits_atomically(self) -> None:
        response = json.dumps(
            {
                "people": {"owner.md": "# Owner\n\nLives with [Мія](../pets/miia.md)."},
                "life": {},
                "topics": {},
                "pets": {"miia.md": "# Мія\n\nA curious cat."},
            },
            ensure_ascii=False,
        )

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertIn("[Мія](../pets/miia.md)", (self.root / "people/owner.md").read_text())
        self.assertEqual((self.root / "pets/miia.md").read_text(), "# Мія\n\nA curious cat.")
        self.assertIn("[Мія](miia.md)", (self.root / "pets/_index.md").read_text())

    async def test_symlinked_category_is_rejected_without_touching_external_files(self) -> None:
        external = Path(self.temp_dir.name).parent / f"external-{self.root.name}"
        external.mkdir()
        external_note = external / "owner.md"
        external_note.write_text("# External\n\nUntouched", encoding="utf-8")
        (self.root / "people").rmdir()
        (self.root / "people").symlink_to(external, target_is_directory=True)
        self.addCleanup(lambda: external.rmdir() if external.exists() else None)
        self.addCleanup(lambda: external_note.unlink(missing_ok=True))
        request = AsyncMock(return_value=EMPTY_RESPONSE)

        with patch.object(dream_cycle, "_request", new=request):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        request.assert_not_awaited()
        self.assertEqual(external_note.read_text(), "# External\n\nUntouched")

    async def test_parent_symlink_swap_before_commit_is_rejected(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nBefore")
        external = Path(self.temp_dir.name).parent / f"swap-{self.root.name}"
        external.mkdir()
        response = json.dumps(
            {"people": {"owner.md": "# Owner\n\nAfter"}, "life": {}, "topics": {}, "pets": {}}
        )
        real_verify = dream_cycle._verify_note_snapshot
        calls = 0

        def swap_parent(snapshots):
            nonlocal calls
            calls += 1
            real_verify(snapshots)
            if calls == 2:
                owner.unlink()
                (self.root / "people").rmdir()
                (self.root / "people").symlink_to(external, target_is_directory=True)

        self.addCleanup(lambda: (self.root / "people").unlink() if (self.root / "people").is_symlink() else None)
        self.addCleanup(lambda: external.rmdir() if external.exists() else None)
        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)), patch.object(
            dream_cycle, "_verify_note_snapshot", side_effect=swap_parent
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertFalse((external / "owner.md").exists())

    async def test_invalid_broken_and_self_links_retain_all_state(self) -> None:
        invalid_targets = [
            "![x](../pets/miia.md)",
            "[x](https://example.com/x.md)",
            "[x](//example.com/x.md)",
            "[x](/pets/miia.md)",
            "[x](#heading)",
            "[x](../pets/miia.md?raw=1)",
            "[x](../pets/miia.md%23heading)",
            "[x](..\\pets\\miia.md)",
            "[x](../pets/miia.md\x00)",
            "[x](../pets/miia.txt)",
            "[x](../logs/2026-07-29.md)",
            "[x](../pets/_index.md)",
            "[x](../../../outside.md)",
            "[x](owner.md)",
            "[x](../pets/missing.md)",
        ]
        for index, linked_content in enumerate(invalid_targets):
            with self.subTest(linked_content=linked_content):
                owner = self._write("people/owner.md", f"# Owner\n\nBefore {index}")
                pet = self._write("pets/miia.md", "# Мія\n\nStable")
                old_log = self._write("logs/2020-01-01.md", "retain")
                response = json.dumps(
                    {
                        "people": {"owner.md": f"# Owner\n\n{linked_content}"},
                        "life": {},
                        "topics": {},
                        "pets": {},
                    }
                )
                with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)):
                    ok = await dream_cycle.dream_cycle()
                self.assertFalse(ok)
                self.assertEqual(owner.read_text(), f"# Owner\n\nBefore {index}")
                self.assertEqual(pet.read_text(), "# Мія\n\nStable")
                self.assertEqual(old_log.read_text(), "retain")

    async def test_reference_autolink_html_and_encoded_links_are_rejected(self) -> None:
        invalid_contents = [
            "# Owner\n\n[Pet][miia]\n\n[miia]: ../pets/miia.md",
            "# Owner\n\n![Pet][miia]\n\n[miia]: ../pets/miia.md",
            "# Owner\n\n<https://example.com/x.md>",
            "# Owner\n\n<a href='../pets/miia.md'>Pet</a>",
            "# Owner\n\n&lt;img src='../pets/miia.md'&gt;",
            "# Owner\n\n&amp;lt;a href='../pets/miia.md'&amp;gt;Pet&amp;lt;/a&amp;gt;",
            "# Owner\n\n[x](%2568%2574%2574%2570%2573%253A%252F%252Fexample.com%252Fx.md)",
            "# Owner\n\n[x](%252e%252e%252f%252e%252e%252foutside.md)",
        ]
        self._write("pets/miia.md", "# Мія\n\nStable")
        for index, content in enumerate(invalid_contents):
            with self.subTest(content=content):
                owner = self._write("people/owner.md", f"# Owner\n\nBefore {index}")
                response = json.dumps(
                    {"people": {"owner.md": content}, "life": {}, "topics": {}, "pets": {}}
                )
                with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)):
                    ok = await dream_cycle.dream_cycle()
                self.assertFalse(ok)
                self.assertEqual(owner.read_text(), f"# Owner\n\nBefore {index}")

    def test_retrieval_follows_one_hop_only_and_excludes_indexes_and_logs(self) -> None:
        self._write(
            "people/owner.md",
            "# Owner\n\nUnique-primary lives with [Мія](../pets/miia.md).",
        )
        self._write("pets/miia.md", "# Мія\n\nLinks to [Vet](../people/vet.md).")
        self._write("people/vet.md", "# Vet\n\nThird hop only")
        self._write("people/_index.md", "# Unique-primary index")
        self._write("logs/2026-07-29.md", "# Unique-primary log")

        result = memory.find_relevant_notes("unique-primary", top_n=1)

        self.assertEqual([note["path"] for note in result], ["people/owner.md", "pets/miia.md"])

    def test_retrieval_caps_linked_notes_and_total_snippet_budget_deterministically(self) -> None:
        self._write(
            "people/owner.md",
            "# Owner\n\nBudget-key "
            + "a" * 2000
            + " [Zed](../pets/zed.md) [Amy](../pets/amy.md) [Extra](../pets/extra.md)",
        )
        self._write("pets/zed.md", "# Zed\n\n" + "z" * 2000)
        self._write("pets/amy.md", "# Amy\n\n" + "b" * 2000)
        self._write("pets/extra.md", "# Extra\n\n" + "e" * 2000)

        with patch.object(memory, "_TOTAL_SNIPPET_LIMIT", 3200):
            result = memory.find_relevant_notes("budget-key", top_n=1)

        self.assertEqual(
            [note["path"] for note in result],
            ["people/owner.md", "pets/zed.md", "pets/amy.md"],
        )
        self.assertEqual(sum(len(note["snippet"]) for note in result), 3200)
        self.assertTrue(all(len(note["snippet"]) <= memory._NOTE_SNIPPET_LIMIT for note in result))

    async def test_missed_old_log_is_included_then_deleted(self) -> None:
        old_log = self._write("logs/2020-01-01.md", "missed after failed night")
        seen_prompts = []

        async def request(prompt: str) -> str:
            seen_prompts.append(prompt)
            return EMPTY_RESPONSE

        with patch.object(dream_cycle, "_request", side_effect=request):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertFalse(old_log.exists())
        self.assertEqual(len(seen_prompts), 1)
        self.assertIn("2020-01-01.md", seen_prompts[0])
        self.assertIn("missed after failed night", seen_prompts[0])
        self.assertIn("BEGIN UNTRUSTED DATA", seen_prompts[0])

    async def test_log_changed_during_request_is_retained(self) -> None:
        old_log = self._write("logs/2020-01-01.md", "included version")

        async def request(_prompt: str) -> str:
            old_log.write_text("new content during request", encoding="utf-8")
            return EMPTY_RESPONSE

        with patch.object(dream_cycle, "_request", side_effect=request):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertEqual(old_log.read_text(), "new content during request")

    async def test_log_changed_after_manifest_revalidation_is_never_moved(self) -> None:
        old_log = self._write("logs/2020-01-01.md", "included version")
        real_verify = dream_cycle._verify_note_snapshot
        verify_calls = 0
        mutated = False

        def mutate_after_note_revalidation(snapshots):
            nonlocal verify_calls, mutated
            verify_calls += 1
            real_verify(snapshots)
            if verify_calls == 2:
                old_log.write_text("concurrent version", encoding="utf-8")
                mutated = True

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=EMPTY_RESPONSE)), patch.object(
            dream_cycle, "_verify_note_snapshot", side_effect=mutate_after_note_revalidation
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertTrue(ok)
        self.assertTrue(mutated)
        self.assertEqual(old_log.read_text(), "concurrent version")

    def test_generated_index_text_uses_strict_plain_text_sanitizer(self) -> None:
        index = dream_cycle._index_content(
            {
                "owner.md": (
                    "# [Owner](https://evil.test) <img src=x> (Admin)\u202e!\n\n"
                    "Knows ![secret](bad.png), keeps readable: commas, periods & dashes.\x07"
                ).encode("utf-8")
            }
        )
        self.assertEqual(
            index,
            "- [Owner Admin!](owner.md) - Knows secret, keeps readable: commas, periods & dashes.\n",
        )
        for unsafe in ("]", "(", "<img", "bad.png", "\u202e", "\x07"):
            self.assertNotIn(unsafe, index.replace("](owner.md)", ""))

    async def test_note_changed_during_request_aborts_without_changes(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nOriginal")
        old_log = self._write("logs/2020-01-01.md", "must remain")

        async def request(_prompt: str) -> str:
            owner.write_text("# Owner\n\nChanged concurrently", encoding="utf-8")
            return json.dumps(
                {
                    "people": {"new.md": "# New\n\nShould not commit"},
                    "life": {},
                    "topics": {},
                    "pets": {},
                }
            )

        with patch.object(dream_cycle, "_request", side_effect=request):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertEqual(owner.read_text(), "# Owner\n\nChanged concurrently")
        self.assertFalse((self.root / "people/new.md").exists())
        self.assertTrue(old_log.exists())

    async def test_transaction_failure_restores_note_and_expired_log(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nBefore")
        old_log = self._write("logs/2020-01-01.md", "restore me")
        response = json.dumps(
            {"people": {"owner.md": "# Owner\n\nAfter"}, "life": {}, "topics": {}, "pets": {}}
        )
        real_replace = os.replace
        failed = False

        def fail_first_commit(source, destination):
            nonlocal failed
            if not failed and f"{os.sep}writes{os.sep}" in os.fspath(source):
                failed = True
                raise OSError("simulated commit failure")
            return real_replace(source, destination)

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)), patch.object(
            dream_cycle.os, "replace", side_effect=fail_first_commit
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertTrue(failed)
        self.assertEqual(owner.read_text(), "# Owner\n\nBefore")
        self.assertEqual(old_log.read_text(), "restore me")

    async def test_validation_and_api_failures_retain_logs(self) -> None:
        old_log = self._write("logs/2020-01-01.md", "must remain")

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value='{"people": {}}')):
            self.assertFalse(await dream_cycle.dream_cycle())
        self.assertTrue(old_log.exists())

        with patch.object(dream_cycle, "_request", new=AsyncMock(side_effect=RuntimeError("offline"))):
            self.assertFalse(await dream_cycle.dream_cycle())
        self.assertTrue(old_log.exists())

    async def test_process_lock_contention_skips_api_and_changes(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nStable")
        process_lock = dream_cycle._acquire_process_lock()
        self.assertIsNotNone(process_lock)
        request = AsyncMock(return_value=EMPTY_RESPONSE)
        try:
            with patch.object(dream_cycle, "_request", new=request):
                ok = await dream_cycle.dream_cycle()
        finally:
            dream_cycle._release_process_lock(process_lock)

        self.assertFalse(ok)
        request.assert_not_awaited()
        self.assertEqual(owner.read_text(), "# Owner\n\nStable")

    def test_mutation_lock_blocks_note_save_and_log_append(self) -> None:
        lock = memory.acquire_brain_mutation_lock(self.root)
        started = threading.Event()
        finished = threading.Event()

        def write_memory() -> None:
            started.set()
            memory.save_note("people/blocked.md", "blocked note")
            memory.append_chat_log("hello", "reply", "calm")
            finished.set()

        writer = threading.Thread(target=write_memory)
        writer.start()
        self.assertTrue(started.wait(timeout=1))
        time.sleep(0.05)
        self.assertFalse(finished.is_set())
        self.assertFalse((self.root / "people/blocked.md").exists())

        memory.release_brain_mutation_lock(lock)
        writer.join(timeout=2)
        self.assertFalse(writer.is_alive())
        self.assertTrue(finished.is_set())
        self.assertEqual((self.root / "people/blocked.md").read_text(), "blocked note")
        self.assertEqual(len(list((self.root / "logs").glob("*.md"))), 1)

    def test_mutation_lock_timeout_is_bounded_and_leaks_no_handle(self) -> None:
        holder = memory.acquire_brain_mutation_lock(self.root, timeout_s=0)
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(TimeoutError, "brain mutation lock unavailable"):
                memory.acquire_brain_mutation_lock(
                    self.root,
                    timeout_s=0.05,
                    poll_s=0.005,
                )
        finally:
            memory.release_brain_mutation_lock(holder)

        self.assertLess(time.monotonic() - started, 0.5)
        reacquired = memory.try_acquire_brain_mutation_lock(self.root)
        self.assertIsNotNone(reacquired)
        memory.release_brain_mutation_lock(reacquired)

    async def test_async_mutation_lock_cancellation_leaks_no_handle(self) -> None:
        holder = memory.acquire_brain_mutation_lock(self.root, timeout_s=0)
        with patch.object(dream_cycle, "_MUTATION_LOCK_TIMEOUT_S", 1.0), patch.object(
            dream_cycle, "_MUTATION_LOCK_POLL_S", 0.01
        ):
            waiter = asyncio.create_task(dream_cycle._acquire_mutation_lock_async())
            await asyncio.sleep(0.03)
            waiter.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await waiter
        memory.release_brain_mutation_lock(holder)

        await asyncio.sleep(0.03)
        reacquired = memory.try_acquire_brain_mutation_lock(self.root)
        self.assertIsNotNone(reacquired)
        memory.release_brain_mutation_lock(reacquired)

    async def test_async_mutation_lock_timeout_is_bounded(self) -> None:
        holder = memory.acquire_brain_mutation_lock(self.root, timeout_s=0)
        started = asyncio.get_running_loop().time()
        try:
            with patch.object(dream_cycle, "_MUTATION_LOCK_TIMEOUT_S", 0.05), patch.object(
                dream_cycle, "_MUTATION_LOCK_POLL_S", 0.005
            ):
                with self.assertRaisesRegex(TimeoutError, "brain mutation lock unavailable"):
                    await dream_cycle._acquire_mutation_lock_async()
        finally:
            memory.release_brain_mutation_lock(holder)
        self.assertLess(asyncio.get_running_loop().time() - started, 0.5)

    async def test_backup_snapshot_mismatch_aborts_and_preserves_new_bytes(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nOriginal")
        response = json.dumps(
            {
                "people": {"owner.md": "# Owner\n\nReplacement"},
                "life": {},
                "topics": {},
                "pets": {},
            }
        )
        real_replace = os.replace
        injected = False

        def mutate_moved_backup(source, destination):
            nonlocal injected
            result = real_replace(source, destination)
            if not injected and f"{os.sep}backups{os.sep}" in os.fspath(destination):
                Path(destination).write_text("# Owner\n\nConcurrent external bytes", encoding="utf-8")
                injected = True
            return result

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)), patch.object(
            dream_cycle.os, "replace", side_effect=mutate_moved_backup
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertTrue(injected)
        self.assertEqual(owner.read_text(), "# Owner\n\nConcurrent external bytes")
        self.assertFalse(list(self.root.glob(".dream-recovery-*")))

    async def test_restore_failure_preserves_recovery_backup(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nBefore")
        response = json.dumps(
            {"people": {"owner.md": "# Owner\n\nAfter"}, "life": {}, "topics": {}, "pets": {}}
        )
        real_replace = os.replace
        commit_failed = False
        restore_failed = False

        def fail_commit_and_owner_restore(source, destination):
            nonlocal commit_failed, restore_failed
            source_text = os.fspath(source)
            destination_text = os.fspath(destination)
            if not commit_failed and f"{os.sep}writes{os.sep}" in source_text:
                commit_failed = True
                raise OSError("simulated commit failure")
            if (
                commit_failed
                and not restore_failed
                and f"{os.sep}backups{os.sep}people{os.sep}owner.md" in source_text
                and destination_text.endswith(f"{os.sep}people{os.sep}owner.md")
            ):
                restore_failed = True
                raise OSError("simulated restore failure")
            return real_replace(source, destination)

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)), patch.object(
            dream_cycle.os, "replace", side_effect=fail_commit_and_owner_restore
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertTrue(commit_failed)
        self.assertTrue(restore_failed)
        self.assertFalse(owner.exists())
        recoveries = list(self.root.glob(".dream-recovery-*"))
        self.assertEqual(len(recoveries), 1)
        backup = recoveries[0] / "backups/people/owner.md"
        self.assertEqual(backup.read_text(), "# Owner\n\nBefore")
        audit = (self.root / "dream_cycle.log").read_text()
        self.assertIn(f"recovery required at {recoveries[0].name}", audit)

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=EMPTY_RESPONSE)):
            recovered = await dream_cycle.dream_cycle()

        self.assertTrue(recovered)
        self.assertEqual(owner.read_text(), "# Owner\n\nBefore")
        self.assertFalse(list(self.root.glob(".dream-recovery-*")))

    def _recovery_artifact(self, phase: str, destination: str, original: str) -> Path:
        stage = self.root / ".dream-recovery-test"
        backup = stage / "backups" / destination
        backup.parent.mkdir(parents=True)
        backup.write_text(original, encoding="utf-8")
        (stage / "manifest.json").write_text(
            json.dumps(
                {
                    "phase": phase,
                    "paths": [{"path": destination, "had_original": True}],
                }
            ),
            encoding="utf-8",
        )
        return stage

    def test_prepared_recovery_rolls_back_destination(self) -> None:
        destination = self._write("people/owner.md", "committed-looking bytes")
        stage = self._recovery_artifact("prepared", "people/owner.md", "original bytes")

        dream_cycle.recover_pending_transactions()

        self.assertEqual(destination.read_text(), "original bytes")
        self.assertFalse(stage.exists())

    def test_committed_recovery_preserves_destination_and_cleans_artifact(self) -> None:
        destination = self._write("people/owner.md", "committed bytes")
        stage = self._recovery_artifact("committed", "people/owner.md", "original bytes")

        dream_cycle.recover_pending_transactions()

        self.assertEqual(destination.read_text(), "committed bytes")
        self.assertFalse(stage.exists())

    async def test_failure_to_publish_committed_marker_rolls_back_all_writes(self) -> None:
        owner = self._write("people/owner.md", "# Owner\n\nBefore")
        response = json.dumps(
            {"people": {"owner.md": "# Owner\n\nAfter"}, "life": {}, "topics": {}, "pets": {}}
        )
        real_replace = os.replace
        marker_failed = False

        def fail_committed_marker(source, destination):
            nonlocal marker_failed
            if (
                not marker_failed
                and Path(source).name == "manifest.tmp"
                and Path(destination).name == "manifest.json"
            ):
                manifest = json.loads(Path(source).read_text(encoding="utf-8"))
                if manifest.get("phase") == "committed":
                    marker_failed = True
                    raise OSError("simulated committed marker failure")
            return real_replace(source, destination)

        with patch.object(dream_cycle, "_request", new=AsyncMock(return_value=response)), patch.object(
            dream_cycle.os, "replace", side_effect=fail_committed_marker
        ):
            ok = await dream_cycle.dream_cycle()

        self.assertFalse(ok)
        self.assertTrue(marker_failed)
        self.assertEqual(owner.read_text(), "# Owner\n\nBefore")
        self.assertFalse(list(self.root.glob(".dream-recovery-*")))

    def test_startup_recovery_acquires_mutation_lock_before_recovery(self) -> None:
        observed_lock = None

        def inspect_lock() -> None:
            nonlocal observed_lock
            observed_lock = memory.try_acquire_brain_mutation_lock(self.root)

        with patch.object(dream_cycle, "_recover_interrupted_transactions", side_effect=inspect_lock):
            dream_cycle.recover_pending_transactions()

        self.assertIsNone(observed_lock)
        reacquired = memory.try_acquire_brain_mutation_lock(self.root)
        self.assertIsNotNone(reacquired)
        memory.release_brain_mutation_lock(reacquired)

    async def test_lifespan_recovers_before_background_services_start(self) -> None:
        events = []

        class Scheduler:
            def add_job(self, *_args, **_kwargs) -> None:
                events.append("scheduler.add_job")

            def start(self) -> None:
                events.append("scheduler.start")

            def shutdown(self, wait=False) -> None:
                events.append(f"scheduler.shutdown:{wait}")

        def fake_recover_all() -> None:
            events.append("recovery")

        with patch.object(
            main.brain_context, "BRAIN_DIR", self.root
        ), patch.object(
            main.brain_context, "BRAIN_RUNTIME_DIR", self.root / "runtime"
        ), patch.object(
            main, "_recover_all_user_brains", side_effect=fake_recover_all
        ), patch.object(main.console_log, "install"), patch.object(
            main, "_install_signal_chain"
        ), patch.object(
            main.vision_watcher, "start", side_effect=lambda: events.append("watcher.start")
        ), patch.object(
            main, "AsyncIOScheduler", Scheduler
        ), patch.object(
            main.events, "close_all"
        ), patch.object(
            main.vision_watcher, "stop", new=AsyncMock()
        ), patch.object(
            main.display_bridge, "shutdown", new=AsyncMock()
        ), patch.object(
            main.services_manager, "shutdown_all"
        ):
            async with main.lifespan(main.app):
                events.append("yield")

        self.assertLess(events.index("recovery"), events.index("watcher.start"))
        self.assertLess(events.index("recovery"), events.index("scheduler.start"))
        self.assertLess(events.index("scheduler.start"), events.index("yield"))


if __name__ == "__main__":
    unittest.main()
