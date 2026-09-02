from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import brain_context
import chat_store
import main
import projects
import workspace
from fastapi.testclient import TestClient


class ProjectsRegistryTests(unittest.TestCase):
    """Проєкт — тека під code/<slug>/ з метаданими в .project.json.

    Корінь коду навмисно окремий від workspace/ і brain/, щоб кодинг-агент
    не бачив памʼяті й особистих файлів користувача.
    """

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "code"
        self.ws_patch = patch.object(workspace, "CODE_DIR", self.root)
        self.ws_patch.start()

    def tearDown(self) -> None:
        self.ws_patch.stop()
        self.temp.cleanup()

    def test_create_and_list(self) -> None:
        created = projects.create_project("Мій сайт")
        self.assertEqual(created["name"], "Мій сайт")
        self.assertTrue(created["id"])  # слаг згенеровано

        listed = projects.list_projects()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["id"], created["id"])
        self.assertEqual(listed[0]["name"], "Мій сайт")

    def test_cyrillic_name_gets_transliterated_slug(self) -> None:
        created = projects.create_project("Сайт котиків")
        self.assertEqual(created["id"], "sait-kotykiv")

    def test_duplicate_names_get_unique_slugs(self) -> None:
        first = projects.create_project("Гра")
        second = projects.create_project("Гра")
        self.assertNotEqual(first["id"], second["id"])

    def test_rename_keeps_slug_stable(self) -> None:
        created = projects.create_project("Стара назва")
        slug = created["id"]
        renamed = projects.rename_project(slug, "Нова назва")
        self.assertEqual(renamed["id"], slug)
        self.assertEqual(renamed["name"], "Нова назва")
        # Список теж бачить нову назву під тим самим id
        listed = {p["id"]: p["name"] for p in projects.list_projects()}
        self.assertEqual(listed[slug], "Нова назва")

    def test_delete_moves_to_trash_and_removes_from_list(self) -> None:
        created = projects.create_project("Тимчасовий")
        projects.delete_project(created["id"])
        self.assertEqual(projects.list_projects(), [])
        self.assertFalse(projects.exists(created["id"]))

    def test_rename_unknown_project_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            projects.rename_project("does-not-exist", "х")

    def test_rejects_path_traversal_in_slug(self) -> None:
        for bad in ("../escape", "a/b", "..", ""):
            with self.subTest(bad=bad):
                with self.assertRaises((ValueError, FileNotFoundError)):
                    projects.delete_project(bad)


class ChatProjectLinkTests(unittest.TestCase):
    """Чат прив'язується до проєкту (slug) і його можна відв'язати/зняти масово."""

    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.chats = Path(self.temp.name)
        self.patch = patch.object(chat_store, "CHATS_DIR", self.chats)
        self.patch.start()

    def tearDown(self) -> None:
        self.patch.stop()
        self.temp.cleanup()

    def test_set_and_read_project(self) -> None:
        chat_store.append("chat-a", "Привіт", "Вітаю")
        self.assertTrue(chat_store.set_project("chat-a", "my-site"))
        sessions = {s["id"]: s["project"] for s in chat_store.list_sessions()}
        self.assertEqual(sessions["chat-a"], "my-site")

    def test_empty_project_clears_link(self) -> None:
        chat_store.append("chat-b", "Привіт", "Вітаю")
        chat_store.set_project("chat-b", "my-site")
        chat_store.set_project("chat-b", "")
        sessions = {s["id"]: s["project"] for s in chat_store.list_sessions()}
        self.assertEqual(sessions["chat-b"], "")

    def test_clear_project_unlinks_all_matching_chats(self) -> None:
        chat_store.append("chat-c", "1", "1")
        chat_store.append("chat-d", "2", "2")
        chat_store.set_project("chat-c", "proj-x")
        chat_store.set_project("chat-d", "proj-x")
        chat_store.clear_project("proj-x")
        sessions = {s["id"]: s["project"] for s in chat_store.list_sessions()}
        self.assertEqual(sessions["chat-c"], "")
        self.assertEqual(sessions["chat-d"], "")

    def test_unknown_chat_cannot_be_linked(self) -> None:
        self.assertFalse(chat_store.set_project("missing", "proj-x"))


class ProjectsApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "code"
        self.chats = Path(self.temp.name) / "chats"
        self.ws_patch = patch.object(workspace, "CODE_DIR", self.root)
        self.chat_patch = patch.object(chat_store, "CHATS_DIR", self.chats)
        # Запити через TestClient ідуть від користувача (у dev-режимі — "dev"),
        # а тоді workspace бере гілку user_data/<хеш>/code і патч CODE_DIR
        # ОМИНАЄТЬСЯ. Без цього тести створювали й видаляли проєкти у
        # СПРАВЖНІЙ теці користувача. Тому підміняємо і корінь user_data.
        self.user_data = Path(self.temp.name) / "user_data"
        self.ud_patches = [
            patch.object(workspace, "USER_DATA_DIR", self.user_data),
            patch.object(chat_store, "USER_DATA_DIR", self.user_data),
        ]
        self.ws_patch.start()
        self.chat_patch.start()
        for patcher in self.ud_patches:
            patcher.start()

    def tearDown(self) -> None:
        for patcher in self.ud_patches:
            patcher.stop()
        self.ws_patch.stop()
        self.chat_patch.stop()
        self.temp.cleanup()

    def _seed_chat(self, chat_id: str, user: str = "Привіт", bot: str = "Вітаю") -> None:
        """Чат у тому самому просторі, куди піде запит: у dev-режимі uid
        порожній (див. _require_user), тож і API, і цей сідер працюють із
        підміненим CHATS_DIR — без clerk-контексту."""
        chat_store.append(chat_id, user, bot)

    def test_create_list_and_assign_via_api(self) -> None:
        self._seed_chat("chat-e")
        with TestClient(main.app) as client:
            created = client.post("/api/projects", json={"name": "Сайт котиків"})
            self.assertEqual(created.status_code, 200)
            slug = created.json()["id"]

            listed = client.get("/api/projects")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual([p["id"] for p in listed.json()["projects"]], [slug])

            linked = client.post(f"/api/sessions/chat-e/project", json={"project": slug})
            self.assertEqual(linked.status_code, 200)

            sessions = client.get("/api/sessions").json()["sessions"]
            self.assertEqual(sessions[0]["project"], slug)

    def test_assign_to_unknown_project_is_404(self) -> None:
        self._seed_chat("chat-f")
        with TestClient(main.app) as client:
            resp = client.post("/api/sessions/chat-f/project", json={"project": "ghost"})
        self.assertEqual(resp.status_code, 404)

    def test_delete_project_unlinks_chats(self) -> None:
        self._seed_chat("chat-g")
        with TestClient(main.app) as client:
            created = client.post("/api/projects", json={"name": "Тимчасовий"}).json()
            slug = created["id"]
            client.post("/api/sessions/chat-g/project", json={"project": slug})

            deleted = client.delete(f"/api/projects/{slug}")
            self.assertEqual(deleted.status_code, 200)

            sessions = client.get("/api/sessions").json()["sessions"]
            self.assertEqual(sessions[0]["project"], "")


if __name__ == "__main__":
    unittest.main()
