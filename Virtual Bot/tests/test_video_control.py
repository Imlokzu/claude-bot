"""
Тести відео на екрані: розбір команд, стан плеєра з TTL, налаштування
адблоку, парсинг сегментів SponsorBlock і самі ендпоінти.

Усе ОФЛАЙН: мережу до sponsor.ajay.app і yt-dlp підмінюємо — тест мусить
падати від регресії, а не від того, що публічний сервіс сьогодні лежить.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import events
import sponsorblock
import video_control as vc


def _collect_video(monkeypatch) -> list:
    """Ловить лише події відео.

    На шину подій сипляться ще й рядки консолі (console_log → publish_log),
    тож у повному прогоні sent[-1] виявлявся лог-рядком, а не командою."""
    sent: list = []
    original = events.publish

    def spy(payload):
        if isinstance(payload, dict) and payload.get("type") == "video":
            sent.append(payload)

    monkeypatch.setattr(events, "publish", spy)
    return sent


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """Налаштування в тимчасовій теці: справжній runtime/ тести не чіпають."""
    monkeypatch.setattr(vc.app_config, "BASE_DIR", tmp_path)
    vc.clear_state()
    yield
    vc.clear_state()


# ------------------------------------------------------------------ час і позиції

@pytest.mark.parametrize("raw,expected", [
    ("2:30", 150.0),
    ("0:07", 7.0),
    ("1:05:00", 3900.0),
    ("90", 90.0),
    ("90 сек", 90.0),
    (150, 150.0),
    (0, 0.0),
])
def test_parse_position_ok(raw, expected):
    assert vc.parse_position(raw) == expected


@pytest.mark.parametrize("raw", ["", None, "хвилина", "2:99", "-5", "1:2:3:4", "99999999"])
def test_parse_position_garbage(raw):
    assert vc.parse_position(raw) is None


@pytest.mark.parametrize("secs,text", [(7, "0:07"), (150, "2:30"), (3900, "1:05:00"), (0, "0:00")])
def test_human_time(secs, text):
    assert vc.human_time(secs) == text


# ------------------------------------------------------------------ команди

def test_build_command_aliases():
    # Мозок цілком може сказати «стоп» або "play" замість канонічної дії
    assert vc.build_command("стоп")["action"] == "stop"
    assert vc.build_command("play")["action"] == "resume"
    assert vc.build_command("кінець")["action"] == "end"


def test_build_command_default_steps_are_symmetric():
    """Крок однаковий в обидві сторони — і той самий, що на кнопках плеєра.

    Асиметрія дала б пару однакових на вигляд кнопок, які роблять різне."""
    assert vc.build_command("forward")["seconds"] == float(vc.DEFAULT_STEP_S)
    assert vc.build_command("back")["seconds"] == float(vc.DEFAULT_STEP_S)


def test_seek_step_matches_player_buttons():
    """Кнопка й голос мусять давати однаковий стрибок."""
    from pathlib import Path
    import re

    import app_config

    pkg = (Path(app_config.STORE_DIR) / "packages" / "youtube" / "index.html").read_text("utf-8")
    match = re.search(r"const SEEK_STEP_S = (\d+);", pkg)
    assert match, "у пакеті немає SEEK_STEP_S"
    assert int(match.group(1)) == vc.DEFAULT_STEP_S


def test_build_command_seek_accepts_clock():
    assert vc.build_command("seek", position="2:30")["position"] == 150.0
    # seconds теж приймаємо: мозок плутає поля частіше, ніж хотілося б
    assert vc.build_command("seek", seconds="90")["position"] == 90.0


def test_build_command_speed_snaps_to_supported():
    # Плеєр має фіксований набір швидкостей — просити 1.6 можна, показати ні
    assert vc.build_command("speed", rate="1.6")["rate"] == 1.5
    assert vc.build_command("speed", rate="3")["rate"] == 2.0


def test_build_command_rejects_unknown_action():
    with pytest.raises(vc.VideoError):
        vc.build_command("зроби гарно")


def test_build_command_rejects_seek_without_target():
    with pytest.raises(vc.VideoError):
        vc.build_command("seek")


def test_describe_is_human():
    assert vc.describe(vc.build_command("forward", seconds="45")) == "Вперед на 45 с"
    assert vc.describe(vc.build_command("seek", position="1:00")) == "Перемотано на 1:00"


# ------------------------------------------------------------------ стан плеєра

def test_state_empty_by_default():
    assert vc.state()["playing"] is False
    assert "не грає" in vc.state()["note"]


def test_state_roundtrip():
    vc.update_state({
        "video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 90.0,
        "duration": 213.0, "paused": False, "rate": 1.5,
        "skipped_count": 2, "skipped_seconds": 41.5, "segments": 3,
    })
    state = vc.state()
    assert state["playing"] is True
    assert state["position_human"] == "1:30"
    assert state["duration_human"] == "3:33"
    assert state["left_human"] == "2:03"
    assert state["skipped_count"] == 2


def test_state_expires(monkeypatch):
    """Екран міг заснути — і «грає» стало б брехнею. TTL гасить стан сам."""
    vc.update_state({"video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 1.0})
    fake_now = [1000.0]
    monkeypatch.setattr(vc.time, "monotonic", lambda: fake_now[0])
    vc.update_state({"video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 1.0})
    fake_now[0] += vc.STATE_TTL_S + 1
    assert vc.state()["playing"] is False


def test_state_clamps_garbage():
    """Стан приходить від сторонього пакета — довіряти йому не можна."""
    clean = vc.update_state({
        "video_id": "x" * 99, "title": "т" * 999, "position": -50,
        "duration": float("nan"), "rate": 99, "skipped_count": 10 ** 9,
    })
    assert len(clean["video_id"]) <= 16
    assert len(clean["title"]) <= 300
    assert clean["position"] == 0.0
    assert clean["duration"] == 0.0
    assert clean["rate"] <= 4.0


# ------------------------------------------------------------------ налаштування

def test_settings_defaults():
    settings = vc.load_settings()
    assert settings["sponsorblock"] is True
    assert "sponsor" in settings["categories"]
    # Заставки/титри типово НЕ пропускаємо: люди хочуть бачити інтро каналу
    assert "intro" not in settings["categories"]
    assert settings["proxy_thumbnails"] is True


def test_settings_persist_partial_patch():
    vc.save_settings({"proxy_thumbnails": False})
    settings = vc.load_settings()
    assert settings["proxy_thumbnails"] is False
    # Патч частковий — решта мусила лишитись
    assert settings["sponsorblock"] is True
    assert settings["categories"]


def test_settings_drop_unknown_categories():
    settings = vc.save_settings({"categories": ["sponsor", "вигадана", "intro"]})
    assert settings["categories"] == ["sponsor", "intro"]


def test_settings_empty_categories_disable_adblock():
    """Порожній список = «пропускати нічого», тобто вимкнений адблок.
    Лишати перемикач «увімкнено» в такому стані — брехати людині."""
    settings = vc.save_settings({"categories": []})
    assert settings["sponsorblock"] is False
    assert vc.active_categories() == []


def test_settings_survive_corrupt_file(tmp_path):
    """Обрив живлення Pi посеред записи не мусить нічого валити."""
    path = vc._settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{зламаний json", "utf-8")
    assert vc.load_settings()["sponsorblock"] is True


def test_active_categories_respect_switch():
    vc.save_settings({"sponsorblock": False})
    assert vc.active_categories() == []
    vc.save_settings({"sponsorblock": True})
    assert "sponsor" in vc.active_categories()


# ------------------------------------------------------------------ SponsorBlock

def test_hash_prefix_hides_video_id():
    """Приватний шлях: сервер бачить 4 символи хеша, а не id відео."""
    prefix = sponsorblock.video_hash_prefix("dQw4w9WgXcQ")
    assert len(prefix) == 4
    assert prefix == "5f6b"          # sha256 стабільний — фіксуємо контракт
    assert "dQw4" not in prefix


def test_parse_picks_only_our_video():
    """Відповідь на префікс — це СОТНІ чужих відео; своє вибираємо локально."""
    payload = [
        {"videoID": "інше_відео", "segments": [
            {"category": "sponsor", "actionType": "skip", "segment": [0, 30], "votes": 5}]},
        {"videoID": "наше", "segments": [
            {"category": "sponsor", "actionType": "skip", "segment": [10, 40], "votes": 3}]},
    ]
    found = sponsorblock._parse(payload, "наше", ["sponsor"])
    assert len(found) == 1
    assert found[0]["start"] == 10.0 and found[0]["end"] == 40.0


def test_parse_filters_categories_actions_and_votes():
    payload = [{"videoID": "v", "segments": [
        {"category": "sponsor", "actionType": "skip", "segment": [10, 40], "votes": 3},
        {"category": "intro", "actionType": "skip", "segment": [50, 60], "votes": 3},
        # mute/poi/full автоматично стрибати не можна — плеєр вилітав би в кінець
        {"category": "sponsor", "actionType": "mute", "segment": [70, 80], "votes": 3},
        {"category": "sponsor", "actionType": "full", "segment": [0, 999], "votes": 3},
        # спірний сегмент: пропуск по ньому вирізав би зміст
        {"category": "sponsor", "actionType": "skip", "segment": [90, 120], "votes": -2},
        # надто короткий: стрибок читається як заїкання плеєра
        {"category": "sponsor", "actionType": "skip", "segment": [130, 130.5], "votes": 4},
    ]}]
    found = sponsorblock._parse(payload, "v", ["sponsor"])
    assert [(s["start"], s["end"]) for s in found] == [(10.0, 40.0)]


def test_parse_merges_overlaps():
    """Два стрибки на тому самому місці — це смикання, а не пропуск."""
    payload = [{"videoID": "v", "segments": [
        {"category": "sponsor", "actionType": "skip", "segment": [10, 40], "votes": 1},
        {"category": "selfpromo", "actionType": "skip", "segment": [35, 60], "votes": 1},
    ]}]
    found = sponsorblock._parse(payload, "v", ["sponsor", "selfpromo"])
    assert len(found) == 1
    assert found[0]["end"] == 60.0


def test_parse_survives_garbage():
    assert sponsorblock._parse("не список", "v", ["sponsor"]) == []
    assert sponsorblock._parse([{"videoID": "v", "segments": [
        {"category": "sponsor", "actionType": "skip", "segment": "зламано"},
        {"category": "sponsor", "actionType": "skip", "segment": [5]},
        {"category": "sponsor", "actionType": "skip", "segment": [40, 10]},
    ]}], "v", ["sponsor"]) == []


def test_total_skipped():
    assert sponsorblock.total_skipped([
        {"start": 0.0, "end": 21.8}, {"start": 100.0, "end": 130.0},
    ]) == 51.8


# ------------------------------------------------------------------ ендпоінти

@pytest.fixture()
def client():
    import main
    return TestClient(main.app)


def test_play_requires_target(client):
    assert client.post("/api/video/play", json={}).status_code == 400


def test_play_rejects_bad_id(client):
    assert client.post("/api/video/play", json={"id": "не-відео"}).status_code == 400


def test_play_publishes_event(client, monkeypatch):
    """Подія — єдине, що доходить до екрана; без неї тул «працює» в порожнечу."""
    sent = _collect_video(monkeypatch)
    r = client.post("/api/video/play", json={
        "id": "https://youtu.be/dQw4w9WgXcQ", "title": "Тест", "duration": 213, "start": "1:00",
    })
    assert r.status_code == 200
    assert r.json()["track"]["id"] == "dQw4w9WgXcQ"
    assert sent and sent[-1]["type"] == "video"
    assert sent[-1]["action"] == "play"
    assert sent[-1]["position"] == 60.0


def test_control_publishes_and_validates(client, monkeypatch):
    sent = _collect_video(monkeypatch)
    r = client.post("/api/video/control", json={"action": "forward", "seconds": "45"})
    assert r.status_code == 200
    assert sent[-1] == {"type": "video", "action": "forward", "seconds": 45.0}

    assert client.post("/api/video/control", json={"action": "телепортуй"}).status_code == 400


def test_state_push_and_read(client):
    client.post("/api/video/state", json={
        "video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 30, "duration": 213,
    })
    state = client.get("/api/video/state").json()
    assert state["title"] == "Тест"
    assert state["position_human"] == "0:30"

    client.post("/api/video/state", json={"closed": True})
    assert client.get("/api/video/state").json()["playing"] is False


def test_stop_clears_state(client, monkeypatch):
    monkeypatch.setattr(events, "publish", lambda payload: None)
    client.post("/api/video/state", json={"video_id": "dQw4w9WgXcQ", "title": "Тест"})
    client.post("/api/video/control", json={"action": "stop"})
    assert client.get("/api/video/state").json()["playing"] is False


def test_settings_endpoint_roundtrip(client):
    r = client.get("/api/video/settings")
    assert r.status_code == 200
    assert "sponsor" in r.json()["categories"]

    r = client.post("/api/video/settings", json={"sponsorblock": False})
    assert r.json()["settings"]["sponsorblock"] is False
    # Порожній патч нічого не міняє (застосунок шле лише торкнуте)
    r = client.post("/api/video/settings", json={})
    assert r.json()["settings"]["sponsorblock"] is False


def test_segments_endpoint_offline(client, monkeypatch):
    """Мережевий збій = порожній список і 200, а не 502: плеєр грає далі.

    Підміняємо саму МЕРЕЖУ, а не sponsorblock.segments: підміняти той код,
    який і мусить ловити збої, означало б тестувати заглушку."""
    class DeadClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **kw): raise RuntimeError("сервіс лежить")

    monkeypatch.setattr(sponsorblock.httpx, "AsyncClient", DeadClient)
    sponsorblock._cache.clear()
    r = client.get("/api/video/segments?id=dQw4w9WgXcQ")
    assert r.status_code == 200
    assert r.json()["segments"] == []
    assert r.json()["enabled"] is True


def test_segments_endpoint_disabled(client):
    vc.save_settings({"sponsorblock": False})
    data = client.get("/api/video/segments?id=dQw4w9WgXcQ").json()
    assert data["enabled"] is False
    assert data["segments"] == []


def test_segments_rejects_bad_id(client):
    assert client.get("/api/video/segments?id=абракадабра").status_code == 400


def test_thumb_rejects_bad_id(client):
    assert client.get("/api/video/thumb?id=не-відео").status_code == 400


# ------------------------------------------------------------------ тули мозку

@pytest.fixture()
def tools(monkeypatch):
    """Тули з підміненим пошуком: yt-dlp у тестах не запускаємо."""
    from tools import video_tools

    async def fake_search(query, limit=5):
        if query == "порожньо":
            return []
        if query == "ефір":
            return [{"provider": "youtube", "id": "aaaaaaaaaaa", "title": "Live", "uploader": "TV",
                     "duration": 0, "live": True}]
        return [{"provider": "youtube", "id": "dQw4w9WgXcQ", "title": "Знайдене",
                 "uploader": "Канал", "duration": 213}]

    monkeypatch.setattr(video_tools.music, "search", fake_search)
    monkeypatch.setattr(video_tools.screen_store, "is_installed", lambda pkg: True)

    async def no_segments(video_id, categories):
        return []
    monkeypatch.setattr(video_tools.sponsorblock, "segments", no_segments)
    return video_tools


def test_tool_play_video_needs_target(tools, monkeypatch):
    monkeypatch.setattr(events, "publish", lambda p: None)
    assert "error" in asyncio.run(tools.play_video())


def test_tool_play_video_publishes(tools, monkeypatch):
    sent = _collect_video(monkeypatch)
    result = asyncio.run(
        tools.play_video(query="котики", start="2:30"))
    assert result["ok"] is True
    assert result["video_id"] == "dQw4w9WgXcQ"
    assert result["started_at"] == "2:30"
    assert sent[-1]["type"] == "video" and sent[-1]["position"] == 150.0
    # Про адблок бот мусить сказати чесно: сегментів немає — так і кажемо
    assert "не знайдено" in result["adblock"]


def test_tool_play_video_refuses_live_without_fallback(tools, monkeypatch):
    monkeypatch.setattr(events, "publish", lambda p: None)
    result = asyncio.run(tools.play_video(query="ефір"))
    assert "ефір" in result.get("error", "")


def test_tool_play_video_rejects_foreign_link(tools):
    result = asyncio.run(
        tools.play_video(url="https://vimeo.com/123456"))
    assert "error" in result


def test_tool_control_warns_when_nothing_plays(tools, monkeypatch):
    monkeypatch.setattr(events, "publish", lambda p: None)
    result = asyncio.run(tools.video_control("forward"))
    assert result["ok"] is True
    # Команду відправили в порожнечу — бот не має звітувати «перемотав»
    assert "warning" in result


def test_tool_control_reports_position(tools, monkeypatch):
    monkeypatch.setattr(events, "publish", lambda p: None)
    vc.update_state({"video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 60, "duration": 213})
    result = asyncio.run(
        tools.video_control("seek", position="1:30"))
    assert result["done"] == "Перемотано на 1:30"
    assert result["position_before"] == "1:00"
    assert "warning" not in result


def test_tool_status(tools):
    run = asyncio.run
    assert run(tools.video_status())["playing"] is False
    vc.update_state({"video_id": "dQw4w9WgXcQ", "title": "Тест", "position": 60,
                     "duration": 213, "skipped_count": 2, "skipped_seconds": 45})
    status = run(tools.video_status())
    assert status["position"] == "1:00" and status["left"] == "2:33"
    assert "2 рекламних" in status["adblock_skipped"]


def test_tool_settings_words_to_switch(tools):
    run = asyncio.run
    assert run(tools.video_settings(sponsorblock_enabled="вимкни"))["adblock"] == "вимкнено"
    assert run(tools.video_settings(sponsorblock_enabled="on"))["adblock"] == "увімкнено"
    # Показ без змін нічого не псує
    assert run(tools.video_settings())["changed"] is False


def test_tool_settings_categories_imply_on(tools):
    run = asyncio.run
    run(tools.video_settings(sponsorblock_enabled="off"))
    result = run(tools.video_settings(categories="intro, outro"))
    # Назвати, ЩО пропускати, і лишити адблок вимкненим — суперечність
    assert result["adblock"] == "увімкнено"
    assert "Заставка без змісту" in result["skipping"]


def test_tool_settings_rejects_nonsense_categories(tools):
    result = asyncio.run(
        tools.video_settings(categories="щось своє"))
    assert "error" in result


def test_tool_installs_app_when_missing(monkeypatch):
    """«Покажи відео» не мусить впиратись у «зайди в магазин і встанови»."""
    from tools import video_tools
    installed = []
    monkeypatch.setattr(video_tools.screen_store, "is_installed", lambda pkg: False)
    monkeypatch.setattr(video_tools.screen_store, "install", lambda pkg: installed.append(pkg))
    note = video_tools._ensure_app_installed()
    assert installed == ["youtube"]
    assert "встановлено" in note


# ------------------------------------------------------------------ вигляд пакета

def _package_markup() -> str:
    """Розмітка застосунку БЕЗ коментарів: у них emoji доречні (вони саме
    про те, чому emoji не годяться), а в UI — ні."""
    from pathlib import Path
    import re

    import app_config

    raw = (Path(app_config.STORE_DIR) / "packages" / "youtube" / "index.html").read_text("utf-8")
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)     # HTML-коментарі
    raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)      # блокові CSS/JS
    raw = re.sub(r"^\s*//.*$", "", raw, flags=re.M)      # рядкові JS
    return raw


def test_no_emoji_icons_in_ui():
    """Emoji замість іконок — регресія вигляду, а не дрібниця.

    Браузер малює ⏸/⚙/⏪ КОЛЬОРОВИМИ растровими наліпками: вони не
    успадковують колір теми (у світлій темі лишаються темними), не тоншають
    разом зі stroke-width і не масштабуються під розмір кнопки. Решта
    пакетів екрана їх не використовує — цей теж не має."""
    markup = _package_markup()
    found = {ch for ch in "⏸▶⏪⏩⚙♪⏭●←→✕✓⏯🔇🔊" if ch in markup}
    assert not found, f"emoji в UI застосунку: {found}"


def test_icons_match_screen_icon_set():
    """Іконки — ті самі, що в static/screen/icons.js.

    Інакше на екрані живуть дві схожі-але-різні іконки одного й того ж:
    одна в шухляді, інша в застосунку."""
    from pathlib import Path
    import re

    import app_config

    pkg = (Path(app_config.STORE_DIR) / "packages" / "youtube" / "index.html").read_text("utf-8")
    core = (Path(app_config.STATIC_DIR) / "screen" / "icons.js").read_text("utf-8")

    def paths(text: str, block: str) -> set:
        match = re.search(r"^ {2,4}%s:(.*?)(?=^ {2,4}[a-z_]+:|^ {0,2}\};)" % block,
                          text, re.M | re.S)
        assert match, f"немає іконки {block}"
        return set(re.findall(r'd="([^"]+)"', match.group(1)))

    for name in ("play", "pause", "settings", "music"):
        assert paths(pkg, name) == paths(core, name), f"іконка {name} розійшлася з набором екрана"


def test_package_supports_light_theme():
    """Батько шле тему в botSkin — застосунок мусить її застосовувати.

    Без цього він лишався темним на світлому екрані, а іконки на
    currentColor ставали світлими на світлому."""
    markup = _package_markup()
    assert ':root[data-theme="light"]' in markup
    assert "dataset.theme" in markup


def test_captions_commands_resolve():
    """«увімкни субтитри» must reach the player as a command it knows."""
    from pathlib import Path

    import app_config

    assert vc.build_command("увімкни субтитри") == {"action": "captions_on"}
    assert vc.build_command("вимкни субтитри") == {"action": "captions_off"}
    pkg = (Path(app_config.STORE_DIR) / "packages" / "youtube" / "index.html").read_text("utf-8")
    assert '"captions_on"' in pkg and '"captions_off"' in pkg
