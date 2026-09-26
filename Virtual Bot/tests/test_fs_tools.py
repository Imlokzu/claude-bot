from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import fs_tools


class FsToolsTests(unittest.TestCase):
    """Перегляд довільних тек на диску: потрібен дозвіл, деякі теки — ніколи."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "project").mkdir()
        (self.root / "project" / "readme.md").write_text("hello", encoding="utf-8")
        self.access_path = self.root / "fs_access.json"
        self.patches = [
            patch.object(fs_tools, "ACCESS_PATH", self.access_path),
            patch.object(fs_tools, "DENY_PREFIXES", [self.root / "secrets"]),
        ]
        for p in self.patches:
            p.start()
        (self.root / "secrets").mkdir()
        (self.root / "secrets" / "id_rsa").write_text("nope", encoding="utf-8")

    def tearDown(self) -> None:
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def _run(self, coro):
        return asyncio.run(coro)

    def test_unapproved_path_needs_approval(self) -> None:
        result = self._run(fs_tools.fs_list(str(self.root / "project")))
        self.assertTrue(result.get("needs_approval"))
        self.assertNotIn("entries", result)

    def test_approve_then_list_and_read(self) -> None:
        target = str(self.root / "project")
        approved = self._run(fs_tools.fs_approve(target))
        self.assertTrue(approved.get("ok"))

        listing = self._run(fs_tools.fs_list(target))
        names = {e["name"] for e in listing["entries"]}
        self.assertIn("readme.md", names)

        content = self._run(fs_tools.fs_read(str(self.root / "project" / "readme.md")))
        self.assertEqual(content["content"], "hello")

    def test_subpath_of_approved_dir_is_approved_too(self) -> None:
        self._run(fs_tools.fs_approve(str(self.root)))
        listing = self._run(fs_tools.fs_list(str(self.root / "project")))
        self.assertIn("entries", listing)

    def test_denied_path_never_approvable(self) -> None:
        target = str(self.root / "secrets")
        approve_result = self._run(fs_tools.fs_approve(target))
        self.assertIn("error", approve_result)

        listing = self._run(fs_tools.fs_list(target))
        self.assertIn("error", listing)
        self.assertNotIn("needs_approval", listing)

    def test_denied_wins_even_if_parent_approved(self) -> None:
        self._run(fs_tools.fs_approve(str(self.root)))
        listing = self._run(fs_tools.fs_list(str(self.root / "secrets")))
        self.assertIn("error", listing)

    def test_missing_path_is_a_clean_error(self) -> None:
        result = self._run(fs_tools.fs_list(str(self.root / "nope")))
        self.assertIn("error", result)

    def test_relative_path_rejected(self) -> None:
        result = self._run(fs_tools.fs_list("project"))
        self.assertIn("error", result)

    def test_file_uri_is_accepted(self) -> None:
        self._run(fs_tools.fs_approve(str(self.root / "project")))
        result = self._run(fs_tools.fs_read(f"file://{self.root}/project/readme.md"))
        self.assertEqual(result["content"], "hello")


if __name__ == "__main__":
    unittest.main()
