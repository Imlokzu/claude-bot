"""
Focused tests for per-user brain isolation via ContextVar + SHA-256 mapping.

All tests patch the protected direct-call brain (brain_context.BRAIN_DIR) and
the runtime directory (brain_context.BRAIN_RUNTIME_DIR) to temp folders, so the
real brain/ tree is never touched.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import brain_context
import memory
from fastapi.testclient import TestClient

import main


class BrainContextTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.template = self.root / "template"
        self.runtime = self.root / "runtime"
        self.template.mkdir()
        self.runtime.mkdir()
        # Populated private content must never become a seed for another user.
        (self.template / "people").mkdir()
        (self.template / "people" / "user.md").write_text("# Template user\n", encoding="utf-8")
        (self.template / "topics").mkdir()
        (self.template / "topics" / "shared.md").write_text("# Shared topic\n", encoding="utf-8")
        (self.template / "logs").mkdir()
        (self.template / "logs" / "private.md").write_text("private chat", encoding="utf-8")
        (self.template / ".brain_mutation.lock").write_text("", encoding="utf-8")
        (self.template / "dream_cycle.log").write_text("audit", encoding="utf-8")
        (self.template / "custom.lock").write_text("lock", encoding="utf-8")
        (self.template / "recovery").mkdir()
        (self.template / "recovery" / "manifest.json").write_text("{}", encoding="utf-8")
        (self.template / "_navigation.md").write_text("generated", encoding="utf-8")
        self.patch_template = patch.object(brain_context, "BRAIN_DIR", self.template)
        self.patch_runtime = patch.object(brain_context, "BRAIN_RUNTIME_DIR", self.runtime)
        self.patch_template.start()
        self.patch_runtime.start()

    def tearDown(self) -> None:
        self.patch_template.stop()
        self.patch_runtime.stop()
        self.temp.cleanup()

    def _user_dir(self, session_id: str) -> Path:
        return (self.runtime / hashlib.sha256(session_id.encode("utf-8")).hexdigest() / "brain").resolve()

    def test_safe_mapping_sha256(self) -> None:
        root = brain_context.init_user_brain("alice")
        expected = self._user_dir("alice")
        self.assertEqual(root.resolve(), expected.resolve())
        self.assertTrue(expected.is_dir())
        self.assertTrue((expected / "people").is_dir())
        self.assertTrue((expected / "topics").is_dir())
        self.assertTrue((expected / "logs").is_dir())
        self.assertFalse((expected / "people" / "user.md").exists())

    def test_malicious_session_ids_are_harmless(self) -> None:
        malicious = (
            "../../../etc/passwd",
            "..\\\\windows\\\\system32",
            "/absolute/path",
            "a\x00b",
            "a/../b",
            "very" + "long" * 500,
            "user/with/slashes",
            "user\\with\\backslashes",
            "",  # falls back to default namespace
        )
        resolved_runtime = self.runtime.resolve()
        for sid in malicious:
            with self.subTest(sid=sid):
                root = brain_context.init_user_brain(sid)
                self.assertTrue(root.resolve().is_relative_to(resolved_runtime))
                # No traversal outside runtime: the raw string never appears as a path component
                self.assertNotIn("/", root.name)
                self.assertNotIn("\\", root.name)
                self.assertNotIn("..", root.name)
                expected_name = self._user_dir(
                    sid if sid else brain_context.DEFAULT_BRAIN_ID
                ).name
                self.assertEqual(root.name, expected_name)

    def test_preexisting_symlink_cannot_redirect_user_brain(self) -> None:
        digest = hashlib.sha256(b"symlink-user").hexdigest()
        outside = self.root / "outside"
        outside.mkdir()
        (self.runtime / digest).symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError):
            brain_context.init_user_brain("symlink-user")
        self.assertEqual(list(outside.iterdir()), [])

    def test_background_recovery_rejects_replaced_digest_symlink(self) -> None:
        digest = hashlib.sha256(b"recovery-user").hexdigest()
        outside = self.root / "outside-recovery"
        outside.mkdir()
        (self.runtime / digest).symlink_to(outside, target_is_directory=True)

        with patch.object(brain_context, "list_user_brain_ids", return_value=[digest]), patch.object(
            main.dream_cycle, "recover_pending_transactions"
        ) as recover, self.assertLogs(main.log, level="ERROR"):
            main._recover_all_user_brains()

        recover.assert_not_called()

    def test_background_dream_cycle_rejects_replaced_brain_symlink(self) -> None:
        digest = hashlib.sha256(b"dream-user").hexdigest()
        user_dir = self.runtime / digest
        outside = self.root / "outside-dream"
        user_dir.mkdir()
        outside.mkdir()
        (user_dir / "brain").symlink_to(outside, target_is_directory=True)

        dream = AsyncMock()
        with patch.object(brain_context, "list_user_brain_ids", return_value=[digest]), patch.object(
            main.dream_cycle, "dream_cycle", new=dream
        ), self.assertLogs(main.log, level="ERROR"):
            asyncio.run(main._dream_cycle_all_users())

        dream.assert_not_awaited()

    def test_idempotent_initialization(self) -> None:
        root1 = brain_context.init_user_brain("bob")
        # Mutate user brain after first init
        (root1 / "people" / "custom.md").write_text("secret", encoding="utf-8")
        root2 = brain_context.init_user_brain("bob")
        self.assertEqual(root1, root2)
        # Existing user data must not be overwritten by second init
        self.assertEqual((root2 / "people" / "custom.md").read_text(), "secret")

    def test_concurrent_initialization_publishes_one_complete_brain(self) -> None:
        roots: list[Path] = []
        errors: list[Exception] = []
        barrier = threading.Barrier(8)

        def initialize() -> None:
            try:
                barrier.wait()
                roots.append(brain_context.init_user_brain("same-user"))
            except Exception as exc:  # pragma: no cover - asserted below
                errors.append(exc)

        threads = [threading.Thread(target=initialize) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(set(roots)), 1)
        self.assertEqual(
            {path.name for path in roots[0].iterdir()},
            {"people", "topics", "logs"},
        )
        self.assertFalse(any(roots[0].parent.glob(".brain-init-*")))

    def test_seed_never_copies_populated_private_brain(self) -> None:
        (self.template / "topics" / ".dream-recovery-deep").mkdir()
        (self.template / "topics" / ".dream-recovery-deep" / "secret").write_text("x")
        (self.template / "topics" / ".dream_cycle.lock").write_text("x")
        outside = self.root / "outside-template"
        outside.mkdir()
        (outside / "private.md").write_text("private", encoding="utf-8")
        (self.template / "topics" / "external").symlink_to(outside, target_is_directory=True)
        root = brain_context.init_user_brain("carol")
        self.assertEqual(
            {path.relative_to(root).as_posix() for path in root.rglob("*")},
            {"people", "topics", "logs"},
        )

    def test_template_untouched_by_init(self) -> None:
        before = set(self.template.rglob("*"))
        brain_context.init_user_brain("dave")
        after = set(self.template.rglob("*"))
        self.assertEqual(before, after)

    def test_context_var_isolation(self) -> None:
        alice_root = brain_context.init_user_brain("alice")
        bob_root = brain_context.init_user_brain("bob")
        self.assertNotEqual(alice_root, bob_root)

        results: dict[str, Path] = {}

        def work(name: str, root: Path) -> None:
            with brain_context.set_brain_root(root):
                results[name] = memory._ensure_brain_dir()

        threads = [
            threading.Thread(target=work, args=("alice", alice_root)),
            threading.Thread(target=work, args=("bob", bob_root)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(results["alice"], alice_root)
        self.assertEqual(results["bob"], bob_root)


class BrainMemoryIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.template = self.root / "template"
        self.runtime = self.root / "runtime"
        self.template.mkdir()
        self.runtime.mkdir()
        (self.template / "people").mkdir()
        (self.template / "topics").mkdir()
        (self.template / "logs").mkdir()
        (self.template / "people" / "user.md").write_text(
            "# Профіль користувача\n\n- Імʼя: Тарас\n", encoding="utf-8"
        )
        (self.template / "topics" / "shared.md").write_text(
            "# Shared\n\ncommon keyword alpha\n", encoding="utf-8"
        )
        self.patch_template = patch.object(brain_context, "BRAIN_DIR", self.template)
        self.patch_runtime = patch.object(brain_context, "BRAIN_RUNTIME_DIR", self.runtime)
        self.patch_template.start()
        self.patch_runtime.start()

    def tearDown(self) -> None:
        self.patch_template.stop()
        self.patch_runtime.stop()
        self.temp.cleanup()

    def test_two_users_divergent_notes_profiles_and_logs(self) -> None:
        alice = brain_context.init_user_brain("alice")
        bob = brain_context.init_user_brain("bob")

        with brain_context.set_brain_root(alice):
            memory.save_note("topics/alice-only.md", "# Alice\n\nalice-keyword")
            memory.append_user_profile("Аліса любить каву")
            memory.append_chat_log("привіт", "привіт Алісо", "happy")

        with brain_context.set_brain_root(bob):
            memory.save_note("topics/bob-only.md", "# Bob\n\nbob-keyword")
            memory.append_user_profile("Боб любить чай")
            memory.append_chat_log("хай", "хай Бобе", "cool")

        # Cross-check: Alice cannot see Bob's data and vice versa
        with brain_context.set_brain_root(alice):
            self.assertTrue((alice / "topics/alice-only.md").exists())
            self.assertFalse((alice / "topics/bob-only.md").exists())
            profile = memory.load_user_profile()
            self.assertIn("Аліса", profile)
            self.assertNotIn("Боб", profile)
            logs = " ".join(p.read_text(encoding="utf-8") for p in (alice / "logs").rglob("*.md"))
            self.assertIn("Алісо", logs)
            self.assertNotIn("Бобе", logs)

        with brain_context.set_brain_root(bob):
            self.assertTrue((bob / "topics/bob-only.md").exists())
            self.assertFalse((bob / "topics/alice-only.md").exists())
            profile = memory.load_user_profile()
            self.assertIn("Боб", profile)
            self.assertNotIn("Аліса", profile)
            logs = " ".join(p.read_text(encoding="utf-8") for p in (bob / "logs").rglob("*.md"))
            self.assertIn("Бобе", logs)
            self.assertNotIn("Алісо", logs)

    def test_relevant_notes_and_prompt_isolation(self) -> None:
        alice = brain_context.init_user_brain("alice")
        bob = brain_context.init_user_brain("bob")

        with brain_context.set_brain_root(alice):
            memory.save_note("topics/hobby.md", "# Hobby\n\nАліса любить малювання")

        with brain_context.set_brain_root(bob):
            memory.save_note("topics/hobby.md", "# Hobby\n\nБоб любить футбол")

        with brain_context.set_brain_root(alice):
            notes = memory.find_relevant_notes("малювання", top_n=3)
            self.assertTrue(any("Аліса" in n["snippet"] for n in notes))
            self.assertFalse(any("Боб" in n["snippet"] for n in notes))

        with brain_context.set_brain_root(bob):
            notes = memory.find_relevant_notes("футбол", top_n=3)
            self.assertTrue(any("Боб" in n["snippet"] for n in notes))
            self.assertFalse(any("Аліса" in n["snippet"] for n in notes))

    def test_no_context_uses_template_fallback(self) -> None:
        # Existing direct-call behavior: when no ContextVar is set, functions use
        # the protected template brain (patched to self.template in tests).
        root = memory._ensure_brain_dir()
        self.assertEqual(root.resolve(), self.template.resolve())
        self.assertIn("Тарас", memory.load_user_profile())

    def test_async_to_thread_preserves_context(self) -> None:
        alice = brain_context.init_user_brain("alice")

        async def task() -> str:
            with brain_context.set_brain_root(alice):
                await asyncio.to_thread(memory.save_note, "topics/async.md", "# Async\n")
                return memory.read_note("topics/async.md")

        text = asyncio.run(task())
        self.assertIn("Async", text)
        self.assertTrue((alice / "topics/async.md").exists())

    def test_concurrent_async_users_do_not_leak_through_to_thread(self) -> None:
        alice = brain_context.init_user_brain("alice")
        bob = brain_context.init_user_brain("bob")

        async def write_and_read(root: Path, marker: str) -> tuple[Path, str]:
            with brain_context.set_brain_root(root):
                await asyncio.sleep(0)
                await asyncio.to_thread(
                    memory.save_note,
                    "topics/concurrent.md",
                    f"# Concurrent\n\n{marker}",
                )
                await asyncio.sleep(0)
                return memory._ensure_brain_dir(), await asyncio.to_thread(
                    memory.read_note, "topics/concurrent.md"
                )

        async def run() -> list[tuple[Path, str]]:
            return list(await asyncio.gather(
                write_and_read(alice, "alice-marker"),
                write_and_read(bob, "bob-marker"),
            ))

        alice_result, bob_result = asyncio.run(run())
        self.assertEqual(alice_result[0], alice)
        self.assertIn("alice-marker", alice_result[1])
        self.assertNotIn("bob-marker", alice_result[1])
        self.assertEqual(bob_result[0], bob)
        self.assertIn("bob-marker", bob_result[1])
        self.assertNotIn("alice-marker", bob_result[1])


class BrainApiIsolationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.template = self.root / "template"
        self.runtime = self.root / "runtime"
        self.template.mkdir()
        self.runtime.mkdir()
        (self.template / "people").mkdir()
        (self.template / "topics").mkdir()
        (self.template / "logs").mkdir()
        (self.template / "people" / "user.md").write_text("# User\n", encoding="utf-8")
        self.patch_template = patch.object(brain_context, "BRAIN_DIR", self.template)
        self.patch_runtime = patch.object(brain_context, "BRAIN_RUNTIME_DIR", self.runtime)
        self.patch_template.start()
        self.patch_runtime.start()

    def tearDown(self) -> None:
        self.patch_template.stop()
        self.patch_runtime.stop()
        self.temp.cleanup()

    def test_memory_endpoints_isolate_by_session_id(self) -> None:
        with TestClient(main.app) as client:
            # Alice saves a note
            r = client.post("/api/memory/save", json={
                "path": "topics/note.md",
                "content": "# Alice note",
                "session_id": "alice",
            })
            self.assertEqual(r.status_code, 200)

            # Bob cannot see Alice's note
            r = client.get("/api/memory/file", params={"path": "topics/note.md", "session_id": "bob"})
            self.assertEqual(r.status_code, 404)

            # Alice reads her own note
            r = client.get("/api/memory/file", params={"path": "topics/note.md", "session_id": "alice"})
            self.assertEqual(r.status_code, 200)
            self.assertIn("Alice note", r.json()["content"])

            # Lists are isolated
            alice_files = {f["path"] for f in client.get("/api/memory/list", params={"session_id": "alice"}).json()["files"]}
            bob_files = {f["path"] for f in client.get("/api/memory/list", params={"session_id": "bob"}).json()["files"]}
            self.assertIn("topics/note.md", alice_files)
            self.assertNotIn("topics/note.md", bob_files)

    def test_chat_logs_to_isolated_brain(self) -> None:
        async def fake_chat(message, history, emit=None):
            prompt = main.brains.build_system_prompt(message)
            return f"[емоція:happy] reply\n{prompt}", "happy", "test", []

        with patch.object(main.brains, "chat", side_effect=fake_chat), TestClient(main.app) as client:
            r = client.post("/api/chat", json={
                "message": "Мене звати Аліса",
                "session_id": "alice-api",
            })
            self.assertEqual(r.status_code, 200)
            data = r.json()
            self.assertEqual(data["session_id"], "alice-api")

            alice_root = self.runtime / hashlib.sha256(b"alice-api").hexdigest() / "brain"
            self.assertTrue(alice_root.is_dir())
            owner_root = self.runtime / hashlib.sha256(
                brain_context.DEFAULT_BRAIN_ID.encode()
            ).hexdigest() / "brain"
            profile = (owner_root / "people" / "user.md").read_text(encoding="utf-8")
            self.assertIn("Аліса", profile)
            self.assertFalse((alice_root / "people" / "user.md").exists())

            logs = list((alice_root / "logs").rglob("*.md"))
            self.assertTrue(logs)
            log_text = logs[0].read_text(encoding="utf-8")
            self.assertIn("Аліса", log_text)

    def test_chat_prompt_and_stream_log_are_scoped(self) -> None:
        alice = brain_context.init_user_brain("alice-stream")
        bob = brain_context.init_user_brain("bob-stream")
        with brain_context.set_brain_root(alice):
            memory.save_note("topics/private.md", "# Private\n\nalice-prompt-marker")
        with brain_context.set_brain_root(bob):
            memory.save_note("topics/private.md", "# Private\n\nbob-prompt-marker")

        observed: dict[str, str] = {}

        async def fake_chat(message, history, emit=None):
            observed[message] = main.brains.build_system_prompt(message)
            return f"reply for {message}", "happy", "test", []

        with patch.object(main.brains, "chat", side_effect=fake_chat), TestClient(main.app) as client:
            response = client.post("/api/chat", json={
                "message": "alice-prompt-marker",
                "session_id": "alice-stream",
                "stream": True,
            })
            self.assertEqual(response.status_code, 200)
            self.assertIn("event: done", response.text)

            response = client.post("/api/chat", json={
                "message": "bob-prompt-marker",
                "session_id": "bob-stream",
            })
            self.assertEqual(response.status_code, 200)

        self.assertIn("alice-prompt-marker", observed["alice-prompt-marker"])
        self.assertNotIn("bob-prompt-marker", observed["alice-prompt-marker"])
        self.assertIn("bob-prompt-marker", observed["bob-prompt-marker"])
        self.assertNotIn("alice-prompt-marker", observed["bob-prompt-marker"])
        alice_logs = "".join(path.read_text() for path in (alice / "logs").glob("*.md"))
        bob_logs = "".join(path.read_text() for path in (bob / "logs").glob("*.md"))
        self.assertIn("reply for alice-prompt-marker", alice_logs)
        self.assertNotIn("reply for bob-prompt-marker", alice_logs)
        self.assertIn("reply for bob-prompt-marker", bob_logs)
        self.assertNotIn("reply for alice-prompt-marker", bob_logs)

    def test_memory_endpoint_without_session_id_uses_default_runtime_brain(self) -> None:
        with TestClient(main.app) as client:
            r = client.post("/api/memory/save", json={
                "path": "topics/default.md",
                "content": "# Default note",
            })
            self.assertEqual(r.status_code, 200)

            default_root = self.runtime / hashlib.sha256(b"__default__").hexdigest() / "brain"
            self.assertTrue((default_root / "topics/default.md").is_file())

            # Template must stay untouched
            self.assertFalse((self.template / "topics/default.md").exists())

    def test_memory_tool_api_is_scoped(self) -> None:
        with TestClient(main.app) as client:
            response = client.post("/api/tools/call", json={
                "name": "create_brain_file",
                "args": {"path": "topics/tool.md", "content": "# Alice tool"},
                "session_id": "alice-tool",
            })
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()["result"]["ok"])

        alice_root = self.runtime / hashlib.sha256(b"alice-tool").hexdigest() / "brain"
        self.assertTrue((alice_root / "topics/tool.md").is_file())
        self.assertFalse((self.template / "topics/tool.md").exists())


if __name__ == "__main__":
    unittest.main()
