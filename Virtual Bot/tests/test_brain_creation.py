from __future__ import annotations

import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import brain_context
import memory
import main


class BrainCreationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        # memory.BRAIN_DIR re-exports brain_context.BRAIN_DIR; patch the canonical root
        self.patch = patch.object(brain_context, "BRAIN_DIR", self.root)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_rejects_unsafe_and_reserved_paths(self) -> None:
        invalid = ("../x.md", "/x.md", "a\\b.md", ".hidden/x.md", "logs/x.md",
                   "x.tmp", "_navigation.md", "a/../x.md", "a\0b.md", "temp/x.md")
        for path in invalid:
            with self.subTest(path=path), self.assertRaises(memory.BrainPathError):
                memory.create_brain_file(path, "x")

    def test_nested_creation_overwrite_and_navigation(self) -> None:
        self.assertEqual(memory.create_brain_directory("Projects/Alpha"), "Projects/Alpha")
        self.assertEqual(memory.create_brain_file("Projects/Alpha/my note.md", "# Useful Heading\nSECRET"),
                         "Projects/Alpha/my note.md")
        with self.assertRaises(FileExistsError):
            memory.create_brain_file("Projects/Alpha/my note.md", "changed")
        memory.create_brain_file("Projects/Alpha/my note.md", "First meaningful line", overwrite=True)
        self.assertEqual((self.root / "Projects/Alpha/my note.md").read_text(), "First meaningful line")
        nav = (self.root / "_navigation.md").read_text()
        self.assertIn("- **Projects/**", nav)
        self.assertIn("  - **Alpha/**", nav)
        self.assertIn("[my note.md](Projects/Alpha/my%20note.md) — First meaningful line", nav)

    def test_navigation_is_deterministic_and_excludes_internal_content(self) -> None:
        (self.root / "z").mkdir()
        (self.root / "z/b.txt").write_text("**Brief description**\nprivate body")
        (self.root / "z/a.md").write_text("# A title\nprivate secret")
        (self.root / "logs").mkdir()
        (self.root / "logs/chat.md").write_text("leak")
        (self.root / ".hidden.md").write_text("leak")
        (self.root / "_index.md").write_text("leak")
        first = memory.regenerate_brain_navigation()
        second = memory.regenerate_brain_navigation()
        self.assertEqual(first, second)
        self.assertLess(first.index("a.md"), first.index("b.txt"))
        self.assertIn("A title", first)
        self.assertIn("Brief description", first)
        self.assertNotIn("private", first)
        self.assertNotIn("chat.md", first)
        self.assertNotIn("hidden", first)

    def test_rejects_symlink_and_type_mismatch(self) -> None:
        outside = Path(self.temp.name).parent / "brain-outside-test"
        outside.mkdir(exist_ok=True)
        try:
            (self.root / "link").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(memory.BrainPathError):
                memory.create_brain_file("link/x.md", "x")
            (self.root / "plain").write_text("x")
            with self.assertRaises(memory.BrainPathError):
                memory.create_brain_directory("plain")
            (self.root / "folder.md").mkdir()
            with self.assertRaises(memory.BrainPathError):
                memory.create_brain_file("folder.md", "x")
        finally:
            outside.rmdir()

    def test_concurrent_creates_keep_all_navigation_entries(self) -> None:
        errors: list[Exception] = []
        def create(index: int) -> None:
            try: memory.create_brain_file(f"notes/{index}.md", f"# Note {index}")
            except Exception as exc: errors.append(exc)
        threads = [threading.Thread(target=create, args=(i,)) for i in range(8)]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(errors, [])
        nav = (self.root / "_navigation.md").read_text()
        for i in range(8): self.assertIn(f"notes/{i}.md", nav)

    def test_navigation_failure_rolls_back_new_file_and_directories(self) -> None:
        with patch.object(memory, "_regenerate_brain_navigation_locked", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                memory.create_brain_file("new/deep/file.md", "x")
        self.assertFalse((self.root / "new").exists())

    def test_legacy_writers_remove_new_parents_when_navigation_fails(self) -> None:
        with patch.object(memory, "_regenerate_brain_navigation_locked", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                memory.save_note("new/deep/note.md", "x")
        self.assertFalse((self.root / "new").exists())

        with patch.object(memory, "_regenerate_brain_navigation_locked", side_effect=OSError("boom")):
            with self.assertRaises(OSError):
                memory.append_user_profile("new fact")
        self.assertFalse((self.root / "people").exists())

    def test_tool_call_request_accepts_json_boolean_and_validates_args_object(self) -> None:
        request = main.ToolCallRequest(
            name="create_brain_file",
            args={"path": "people/user.md", "content": "x", "overwrite": True},
        )
        self.assertIs(request.args["overwrite"], True)
        with self.assertRaises(ValueError):
            main.ToolCallRequest(name="create_brain_file", args=["not", "an", "object"])


if __name__ == "__main__":
    unittest.main()
