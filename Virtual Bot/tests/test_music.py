"""
Тести музики (Now Playing): усе ОФЛАЙН — мережеві шляхи підмінені,
перевіряємо парсинг id, радіо-каталог, кеш ссилок і захист ендпоінтів.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import music


# ---------------------------------------------------------------- id відео

@pytest.mark.parametrize("raw,expected", [
    ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=42", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("  dQw4w9WgXcQ  ", "dQw4w9WgXcQ"),
])
def test_parse_video_id_ok(raw, expected):
    assert music.parse_video_id(raw) == expected


@pytest.mark.parametrize("raw", ["", "короткий", "https://vimeo.com/123456", "a" * 12, None])
def test_parse_video_id_garbage(raw):
    if raw is None:
        assert music.parse_video_id(raw) is None
    else:
        assert music.parse_video_id(raw) is None


# ---------------------------------------------------------------- радіо

def test_radio_catalog_shape():
    stations = music.radio_catalog()
    assert len(stations) >= 5
    ids = [s["id"] for s in stations]
    assert len(ids) == len(set(ids))
    for station in stations:
        assert station["url"].startswith("https://")
        assert station["title"] and station["genre"]


def test_radio_station_lookup():
    assert music.radio_station("groovesalad")["url"].endswith("-mp3")
    assert music.radio_station("hacker-fm") is None


# ---------------------------------------------------------------- текст транскрайбу

def test_transcript_to_text_joins_and_limits():
    segments = [{"start": 0, "text": "перший"}, {"start": 1.5, "text": "другий"}, {"start": 3, "text": ""}]
    assert music.transcript_to_text(segments) == "перший другий"
    long = [{"start": i, "text": "x" * 50} for i in range(200)]
    assert len(music.transcript_to_text(long, max_chars=100)) <= 100


# ---------------------------------------------------------------- пошук/ссилки з моками

def run_async(coro):
    """asyncio.run() закриває цикл і прибирає його з потоку — а TestClient
    в наступних тестах очікує робочий get_event_loop(). Тому крутимо цикл
    вручну й після закриття лишаємо новий поточним."""
    import asyncio

    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        asyncio.set_event_loop(asyncio.new_event_loop())


def test_search_without_ytdlp_returns_empty(monkeypatch):
    monkeypatch.setattr(music, "yt_dlp", None)
    assert run_async(music.search("lofi")) == []


def test_audio_url_cached(monkeypatch):
    calls = {"n": 0}

    def fake_extract(video_id):
        calls["n"] += 1
        return "https://example.com/audio"

    monkeypatch.setattr(music, "_extract_sync", fake_extract)
    music._URL_CACHE.clear()

    first = run_async(music.audio_stream_url("dQw4w9WgXcQ"))
    second = run_async(music.audio_stream_url("dQw4w9WgXcQ"))
    assert first == second == "https://example.com/audio"
    assert calls["n"] == 1


# ---------------------------------------------------------------- ендпоінти

def test_music_api_guards():
    from main import app

    with TestClient(app) as client:
        status = client.get("/api/music/status")
        assert status.status_code == 200
        body = status.json()
        assert isinstance(body["youtube"], bool)
        assert isinstance(body["transcript"], bool)

        radio = client.get("/api/music/radio")
        assert radio.status_code == 200
        assert radio.json()["stations"]

        # Невідоме id відео → 400 (не 500)
        assert client.get("/api/music/stream", params={"provider": "youtube", "id": "!!"}).status_code == 400
        # Невідома станція → 404
        assert client.get("/api/music/stream", params={"provider": "radio", "id": "nope"}).status_code == 404
        # Транскрайб для сміття → 400
        assert client.get("/api/music/transcript", params={"id": "smalls"}).status_code == 400


def test_search_endpoint_without_ytdlp(monkeypatch):
    from main import app

    monkeypatch.setattr(music, "yt_dlp", None)
    with TestClient(app) as client:
        response = client.get("/api/music/search", params={"q": "lofi"})
        assert response.status_code == 503
        assert "yt-dlp" in response.json()["detail"]
