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


def test_audio_url_invidious_first_then_cached(monkeypatch):
    calls = {"probe": 0, "extract": 0}

    def fake_probe(url):
        calls["probe"] += 1
        return calls["probe"] > 1      # інстанс «мертвий», yt-dlp «живий»

    def fake_extract(video_id):
        calls["extract"] += 1
        return "https://ytdlp.example/audio"

    monkeypatch.setattr(music, "invidious_instances", lambda: ["https://inv.test"])
    monkeypatch.setattr(music, "_probe_stream", fake_probe)
    monkeypatch.setattr(music, "_extract_sync", fake_extract)
    music._URL_CACHE.clear()

    import asyncio

    def run(coro):
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(coro)
        finally:
            loop.close()
            asyncio.set_event_loop(asyncio.new_event_loop())

    first = run(music.audio_stream_url("dQw4w9WgXcQ"))
    second = run(music.audio_stream_url("dQw4w9WgXcQ"))
    assert first == second == "https://ytdlp.example/audio"
    assert calls["extract"] == 1        # кеш: другий виклик без витягу
    assert calls["probe"] == 2


def test_invidious_vtt_parsing():
    vtt = (
        "WEBVTT\nKind: captions\n\n"
        "00:00:01.239 --> 00:00:03.400\nпривіт світе\n"
        "00:00:03.400 --> 00:00:05.000\nдругий рядок\n"
    )
    segments = music._vtt_to_segments(vtt)
    assert segments == [
        {"start": 1.24, "text": "привіт світе"},
        {"start": 3.4, "text": "другий рядок"},
    ]


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


# ---------------------------------------------------------------- місток до Now Playing

def test_music_play_publishes_event(monkeypatch):
    import asyncio

    import events
    from main import app

    published = []
    monkeypatch.setattr(events, "publish_music", lambda track, action="play": published.append((dict(track), action)))

    async def fake_search(query, limit=1):
        return [{"provider": "youtube", "id": "aaaaaaaaaaa", "title": "З пошуку", "uploader": "Хтось", "duration": 99}]

    monkeypatch.setattr(music, "search", fake_search)

    with TestClient(app) as client:
        # id + метадані з результатів пошуку застосунка
        r = client.post("/api/music/play", json={"id": "dQw4w9WgXcQ", "title": "Трек", "uploader": "Хтось", "duration": 213})
        assert r.status_code == 200
        assert r.json()["track"]["id"] == "dQw4w9WgXcQ"
        assert published[-1][1] == "play"

        # варіант «тільки запит»: бекенд шукає сам
        r2 = client.post("/api/music/play", json={"query": "lofi"})
        assert r2.status_code == 200
        assert r2.json()["track"]["title"] == "З пошуку"

        # сміття і порожнеча — керовані 400
        assert client.post("/api/music/play", json={"id": "!!"}).status_code == 400
        assert client.post("/api/music/play", json={}).status_code == 400

        # stop
        assert client.post("/api/music/stop").status_code == 200
        assert published[-1][1] == "stop"
        # play(id) + play(query) + stop; невдалі 400 публікацій не створюють
        assert len(published) == 3


# ------------------------------------------------------------------ transcript chain
#
# The panel source exists because the timedtext endpoint gets blocked per IP.
# These tests pin the two things that make it useful: it parses the panel's
# real shape, and a failure anywhere falls through to the next source instead
# of ending the attempt.

import asyncio


def _panel_payload(*rows):
    """The nesting youtube.com actually returns, trimmed to what matters."""
    return {"content": {"engagementPanelSectionListRenderer": {"content": {"sectionListRenderer": {"contents": [
        {"itemSectionRenderer": {"contents": [
            {"macroMarkersPanelItemViewModel": {"item": {"timelineItemViewModel": {"contentItems": [
                {"transcriptSegmentViewModel": {"simpleText": text, "timestamp": stamp}}
            ]}}}}
            for stamp, text in rows
        ]}}
    ]}}}}}


def test_panel_params_encode_video_id():
    # Known-good value captured from youtube.com for dQw4w9WgXcQ
    assert music._panel_params("dQw4w9WgXcQ") == "qgkPCgtkUXc0dzlXZ1hjURgC"


def test_panel_segments_parse_timestamps():
    data = _panel_payload(("0:01", "hello"), ("1:02:03", "later\nline"), ("0:05", "  "))
    assert music._panel_segments(data) == [
        {"start": 1.0, "text": "hello"},
        {"start": 3723.0, "text": "later line"},
    ]


class _Resp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_panel_empty_means_no_transcript(monkeypatch):
    monkeypatch.setattr(music.httpx, "post", lambda *a, **k: _Resp(200, {}))
    with pytest.raises(RuntimeError, match="NoTranscriptFound"):
        music._panel_transcript_sync("dQw4w9WgXcQ", ["en"])


def test_panel_retries_with_live_client_version(monkeypatch):
    seen = []

    def fake_post(url, json=None, **_):
        seen.append(json["context"]["client"]["clientVersion"])
        return _Resp(400) if len(seen) == 1 else _Resp(200, _panel_payload(("0:00", "ok")))

    monkeypatch.setattr(music.httpx, "post", fake_post)
    monkeypatch.setattr(music, "_innertube_version_sync", lambda: "2.29990101.00.00")
    assert music._panel_transcript_sync("dQw4w9WgXcQ", ["en"])[0]["text"] == "ok"
    assert seen == [music._INNERTUBE_WEB_VERSION, "2.29990101.00.00"]


def test_chain_falls_through_to_next_source(monkeypatch):
    """Panel blocked -> the library answers; the caller never sees the first failure."""
    def panel(*_):
        raise RuntimeError("TooManyRequests: panel")

    monkeypatch.setattr(music, "_panel_transcript_sync", panel)
    monkeypatch.setattr(music, "YouTubeTranscriptApi", object())
    monkeypatch.setattr(music, "_transcript_sync", lambda *_: [{"start": 0.0, "text": "from library"}])
    segments = asyncio.run(music.transcript("dQw4w9WgXcQ", ["en"]))
    assert segments[0]["text"] == "from library"


def test_chain_reports_block_honestly(monkeypatch):
    """All sources down with a 429 somewhere: the message blames the address, not the video."""
    def blocked(*_):
        raise RuntimeError("TooManyRequests")

    for name in ("_panel_transcript_sync", "_transcript_sync", "_ytdlp_captions_sync"):
        monkeypatch.setattr(music, name, blocked)
    monkeypatch.setattr(music, "YouTubeTranscriptApi", object())
    monkeypatch.delenv("SUPADATA_API_KEY", raising=False)
    monkeypatch.delenv("TRANSCRIPTAPI_KEY", raising=False)
    with pytest.raises(RuntimeError, match="нашої адреси"):
        asyncio.run(music.transcript("dQw4w9WgXcQ", ["en"]))


def test_hosted_sources_need_keys(monkeypatch):
    monkeypatch.delenv("SUPADATA_API_KEY", raising=False)
    monkeypatch.delenv("TRANSCRIPTAPI_KEY", raising=False)
    assert "supadata" not in music.transcript_sources()
    monkeypatch.setenv("SUPADATA_API_KEY", "k")
    assert "supadata" in music.transcript_sources()

    def fake_get(url, params=None, headers=None, **_):
        assert headers == {"x-api-key": "k"} and params["mode"] == "native"
        return _Resp(200, {"content": [{"text": "hi", "offset": 1500, "duration": 900}]})

    monkeypatch.setattr(music.httpx, "get", fake_get)
    assert music._supadata_sync("dQw4w9WgXcQ", ["uk"]) == [{"start": 1.5, "text": "hi"}]
