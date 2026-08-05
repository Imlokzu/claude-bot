from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import web_browser
import workspace


class WorkspacePathSafetyTests(unittest.TestCase):
    """Робоча тека — це запис на диск, тож вихід за корінь має бути неможливий."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspace"
        self.patch = patch.object(workspace, "WORKSPACE_DIR", self.root)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_creates_default_layout(self) -> None:
        root = workspace.root()
        for name in workspace.DEFAULT_FOLDERS:
            self.assertTrue((root / name).is_dir(), name)
        self.assertTrue((root / "README.md").is_file())

    def test_rejects_traversal(self) -> None:
        for path in ("../escape.md", "a/../../escape.md", "notes/../../escape.md"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                workspace.write_file(path, "x")

    def test_absolute_path_stays_inside_root(self) -> None:
        # '/etc/passwd' трактуємо як шлях ВІД кореня теки, а не від кореня диска
        result = workspace.write_file("/etc/passwd", "не системний файл")
        self.assertEqual(result["path"], "etc/passwd")
        self.assertTrue((workspace.root() / "etc" / "passwd").is_file())

    def test_symlink_outside_root_is_rejected(self) -> None:
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        os.symlink(outside, workspace.root() / "link")
        with self.assertRaises(ValueError):
            workspace.write_file("link/secret.md", "x")

    def test_session_prefix_maps_to_session_folder(self) -> None:
        with workspace.set_session("abc123"):
            written = workspace.write_file("session/plan.md", "план")
            self.assertEqual(written["path"], "sessions/abc123/plan.md")
            self.assertEqual(workspace.read_file("session/plan.md")["content"], "план")

    def test_unsafe_session_id_becomes_digest(self) -> None:
        slug = workspace.session_slug("../../evil")
        self.assertNotIn("/", slug)
        self.assertNotIn(".", slug)

    def test_delete_moves_to_trash(self) -> None:
        workspace.write_file("notes/x.md", "текст")
        result = workspace.delete("notes/x.md")
        self.assertTrue(result["trashed"].startswith(".trash/"))
        self.assertFalse((workspace.root() / "notes" / "x.md").exists())
        self.assertTrue((workspace.root() / result["trashed"]).is_file())

    def test_binary_file_is_not_returned_as_text(self) -> None:
        (workspace.root() / "bin.dat").write_bytes(b"\x00\xff\xfe")
        self.assertTrue(workspace.read_file("bin.dat")["binary"])


class BrowserUrlTests(unittest.TestCase):
    """Проксі не має ставати вікном у локальну мережу користувача."""

    def test_looks_like_url(self) -> None:
        self.assertTrue(web_browser.looks_like_url("example.com"))
        self.assertTrue(web_browser.looks_like_url("https://uk.wikipedia.org/wiki/Краби"))
        self.assertFalse(web_browser.looks_like_url("хто такий краб"))
        self.assertFalse(web_browser.looks_like_url(""))

    def test_blocks_local_and_private_hosts(self) -> None:
        for url in ("http://127.0.0.1:8100", "http://localhost/x", "http://192.168.0.1"):
            with self.subTest(url=url), self.assertRaises(web_browser.BrowserError):
                web_browser._check_public(url)

    def test_blocks_non_http_schemes(self) -> None:
        for url in ("file:///etc/passwd", "ftp://example.com"):
            with self.subTest(url=url), self.assertRaises(web_browser.BrowserError):
                web_browser._check_public(url)


if __name__ == "__main__":
    unittest.main()
