"""
Тести youtube-MCP: протокол (initialize/tools/list/tools/call) і те, що
кожен інструмент справді шле запит на бекенд, а не вигадує відповідь.

Сервер запускаємо ОКРЕМИМ ПРОЦЕСОМ через stdio — так, як його запускає
OpenClaw. Бекенд підміняємо крихітним HTTP-сервером: тест мусить перевіряти
контракт, а не те, чи піднятий зараз Virtual Bot.
"""

from __future__ import annotations

import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

MCP = Path(__file__).resolve().parent.parent / "youtube_mcp.py"


class _Handler(BaseHTTPRequestHandler):
    """Мінімальний фейк бекенда: віддає заготовки і пише, що спитали."""

    calls: list = []

    def log_message(self, *args):      # тиша в логах тесту
        pass

    def _json(self, payload, code=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        type(self).calls.append(("GET", self.path, None))
        if self.path.startswith("/api/video/state"):
            self._json({"video_id": "dQw4w9WgXcQ", "title": "Тест", "playing": True,
                        "position_human": "1:00", "duration_human": "3:33",
                        "left_human": "2:33", "rate": 1.5, "muted": False,
                        "skipped_count": 2, "skipped_seconds": 45})
        elif self.path.startswith("/api/video/segments"):
            self._json({"enabled": True, "skipped_seconds": 45.0,
                        "segments": [{"category": "sponsor", "label": "Реклама спонсора",
                                      "start": 0, "end": 45}]})
        elif self.path.startswith("/api/video/settings"):
            self._json({"settings": {"sponsorblock": True, "categories": ["sponsor"],
                                     "proxy_thumbnails": True, "notify_skips": True},
                        "categories": {"sponsor": "Реклама спонсора"}})
        else:
            self._json({"detail": "не знаю такого"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8") if length else ""
        payload = json.loads(raw) if raw else {}
        type(self).calls.append(("POST", self.path, payload))
        if self.path == "/api/video/play":
            self._json({"ok": True, "track": {"id": "dQw4w9WgXcQ", "title": "Знайдене",
                                              "uploader": "Канал", "duration": 213}})
        elif self.path == "/api/video/control":
            if payload.get("action") == "телепортуй":
                self._json({"detail": "Невідома дія"}, 400)
            else:
                self._json({"ok": True, "done": "Вперед на 45 с"})
        elif self.path == "/api/video/settings":
            self._json({"settings": {"sponsorblock": False, "categories": [],
                                     "proxy_thumbnails": True, "notify_skips": True},
                        "categories": {"sponsor": "Реклама спонсора"}})
        else:
            self._json({"detail": "не знаю такого"}, 404)


@pytest.fixture()
def backend():
    _Handler.calls = []
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}", _Handler
    server.shutdown()
    server.server_close()


def _talk(url: str, requests: list[dict]) -> list[dict]:
    """Шле рядки JSON-RPC у stdin сервера і збирає відповіді зі stdout."""
    lines = "".join(json.dumps(r) + "\n" for r in requests)
    proc = subprocess.run(
        [sys.executable, str(MCP)],
        input=lines, capture_output=True, text=True, timeout=30,
        env={"VBOT_URL": url, "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0, proc.stderr
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def test_initialize_and_tools_list(backend):
    url, _ = backend
    replies = _talk(url, [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 3, "method": "ping"},
    ])
    # Нотифікація без id відповіді не отримує — інакше клієнт побачив би сміття
    assert [r["id"] for r in replies] == [1, 2, 3]
    assert replies[0]["result"]["serverInfo"]["name"] == "klod-bot-youtube"
    names = {t["name"] for t in replies[1]["result"]["tools"]}
    assert names == {"play_video", "video_control", "video_status", "video_settings"}
    for tool in replies[1]["result"]["tools"]:
        assert tool["description"] and tool["inputSchema"]["type"] == "object"


def _call(url, name, args=None):
    replies = _talk(url, [{"jsonrpc": "2.0", "id": 7, "method": "tools/call",
                           "params": {"name": name, "arguments": args or {}}}])
    return replies[0]["result"]


def test_play_video_hits_backend(backend):
    url, handler = backend
    result = _call(url, "play_video", {"query": "котики"})
    assert result["isError"] is False
    text = result["content"][0]["text"]
    assert "Знайдене" in text and "Канал" in text
    # Про пропуск реклами каже одразу — саме за це його й беруть
    assert "45" in text
    posts = [c for c in handler.calls if c[0] == "POST"]
    assert posts[0][1] == "/api/video/play"
    assert posts[0][2]["query"] == "котики"


def test_play_video_passes_url_as_id(backend):
    url, handler = backend
    _call(url, "play_video", {"url": "https://youtu.be/dQw4w9WgXcQ", "start": "2:30"})
    post = next(c for c in handler.calls if c[0] == "POST")
    assert post[2]["id"] == "https://youtu.be/dQw4w9WgXcQ"
    assert post[2]["start"] == "2:30"


def test_play_video_without_target_asks(backend):
    url, handler = backend
    result = _call(url, "play_video", {})
    assert "посилання" in result["content"][0]["text"]
    # Порожній запит на бекенд не шлемо
    assert not [c for c in handler.calls if c[0] == "POST"]


def test_control_reports_state_after(backend):
    url, _ = backend
    text = _call(url, "video_control", {"action": "forward", "seconds": "45"})["content"][0]["text"]
    assert "Вперед на 45 с" in text
    assert "1:00" in text          # де ми зараз — з реального стану, не з голови


def test_control_rejects_unknown_action(backend):
    url, _ = backend
    result = _call(url, "video_control", {"action": "телепортуй"})
    assert result["isError"] is True
    assert "Невідома дія" in result["content"][0]["text"]


def test_status_reads_state(backend):
    url, _ = backend
    text = _call(url, "video_status")["content"][0]["text"]
    assert "грає" in text and "1:00 з 3:33" in text
    assert "1.5×" in text
    assert "пропущено рекламу: 2" in text


def test_settings_show_and_patch(backend):
    url, handler = backend
    text = _call(url, "video_settings")["content"][0]["text"]
    assert "увімкнено" in text
    text = _call(url, "video_settings", {"sponsorblock": False})["content"][0]["text"]
    assert "вимкнено" in text
    post = next(c for c in handler.calls if c[0] == "POST")
    assert post[2] == {"sponsorblock": False}


def test_unknown_tool_is_protocol_error(backend):
    url, _ = backend
    replies = _talk(url, [{"jsonrpc": "2.0", "id": 9, "method": "tools/call",
                           "params": {"name": "hack", "arguments": {}}}])
    assert replies[0]["error"]["code"] == -32602


def test_backend_offline_is_told_not_crashed():
    """Бот вимкнений — агент мусить це почути, а не втратити зʼєднання."""
    # Порт, на якому нічого немає
    result = _call("http://127.0.0.1:9", "video_status")
    assert result["isError"] is True
    assert "недосяжний" in result["content"][0]["text"]


def test_broken_line_does_not_kill_server(backend):
    url, _ = backend
    replies = _talk(url, [
        {"jsonrpc": "2.0", "id": 1, "method": "ping"},
    ])
    assert replies[0]["id"] == 1
    # Битий рядок посеред потоку не мусить обривати сесію
    proc = subprocess.run(
        [sys.executable, str(MCP)],
        input='{зламано\n{"jsonrpc":"2.0","id":5,"method":"ping"}\n',
        capture_output=True, text=True, timeout=30,
        env={"VBOT_URL": url, "PATH": "/usr/bin:/bin"},
    )
    assert proc.returncode == 0
    assert json.loads(proc.stdout.splitlines()[0])["id"] == 5
