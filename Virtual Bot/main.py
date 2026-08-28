"""
«Клод Бот» — Virtual Bot: бекенд панелі керування (FastAPI, 127.0.0.1:8100).

Ендпоінти:
- GET  /                       → static/index.html (фронтенд робить інший агент)
- GET  /api/status             → доступність мозків/сервісів + активний режим
- POST /api/chat               → відповідь бота + емоція
- GET  /api/vision/snapshot    → проксі JSON з Vision Agent (8000)
- GET  /api/memory/list|file, POST /api/memory/save → нотатки brain/
- GET  /api/services, POST /api/services/{name}/start|stop → керування сервісами

MJPEG-стрім фронтенд бере НАПРЯМУ з http://127.0.0.1:8000/vision/stream.mjpg
(через 8100 його не проксюємо). Токен OpenClaw фронтенду ніколи не віддається.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from html import escape as html_escape
from pathlib import Path
from threading import Lock
from typing import Any, Optional, Union
from urllib.parse import quote

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    StreamingResponse,
)
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import app_config as cfg
import auth_clerk
import brain_context
import brains
import chat_store
import coding
import coding_api
import console_log
import display_bridge
import dream_cycle
import asr_regolo
import asr_whisper
import emotions
import events
import music
import screen_store
import piper_voice
import memory
import openclaw_store
import profile_store
import services_manager
import setup_suggestions
import tools
import projects
import vision_watcher
import web_browser
import workspace

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("virtual_bot")


# ---------------------------------------------------------- ізольований brain

def _active_brain(session_id: Optional[str] = None, clerk_user_id: Optional[str] = None) -> tuple[str, Path]:
    """Повертає (sid, root) — якщо є Clerk user_id, brain привʼязаний до акаунта."""
    if clerk_user_id:
        key = f"clerk:{clerk_user_id}"
        # окремий неймспейс на акаунт: session_id ігноруємо для brain
        return clerk_user_id, brain_context.init_clerk_user_brain(clerk_user_id)
    sid = (session_id or "").strip()
    if not sid:
        sid = brain_context.DEFAULT_BRAIN_ID
    return sid, brain_context.init_user_brain(sid)


@contextmanager
def _brain_context(session_id: Optional[str] = None, clerk_user_id: Optional[str] = None):
    """
    Активує brain користувача. Якщо є clerk_user_id — це персональний бот
    акаунта (ізоляція по user.sub). Інакше — старий режим по session_id.
    """
    _sid, root = _active_brain(session_id, clerk_user_id)
    with brain_context.set_brain_root(root), brain_context.set_clerk_user(clerk_user_id), workspace.set_session(session_id):
        yield root


# ---------------------------------------------------------- чистий shutdown
#
# КОРІНЬ зависання: uvicorn БЕЗ --timeout-graceful-shutdown чекає закриття всіх
# відкритих з'єднань ПЕРЕД викликом lifespan shutdown. «Вічний» SSE-потік
# /api/events сам не завершується ніколи → shutdown висить, lifespan-очистка
# (vision_watcher та ін.) взагалі не запускається. Тому закривати SSE треба
# В МОМЕНТ СИГНАЛУ: чіпляємось ланцюжком до обробника SIGINT/SIGTERM, який
# uvicorn ставить через signal.signal (див. Server.capture_signals), — спершу
# плануємо events.close_all() у event loop, потім віддаємо сигнал uvicorn'у.

_prev_signal_handlers: dict = {}


def _install_signal_chain() -> None:
    """Обгортає обробники SIGINT/SIGTERM: закриття SSE + попередній обробник."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:  # викликано поза event loop — ланцюжок не потрібен
        return

    def _handler(sig, frame):
        # Сигнальний контекст: нічого не чіпаємо напряму, лише плануємо
        # закриття SSE-потоків у loop (call_soon_threadsafe — сигнало-безпечний)
        try:
            loop.call_soon_threadsafe(events.close_all)
        except RuntimeError:
            pass  # loop уже закритий — закривати нічого
        prev = _prev_signal_handlers.get(sig)
        if callable(prev):
            prev(sig, frame)  # обробник uvicorn (handle_exit) — штатний shutdown
        elif prev == signal.SIG_DFL:
            # Нас запустили без uvicorn-обробника — відтворюємо типову дію
            signal.signal(sig, signal.SIG_DFL)
            signal.raise_signal(sig)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            _prev_signal_handlers[sig] = signal.signal(sig, _handler)
        except (ValueError, OSError):  # не головний потік (напр., TestClient)
            continue


def _recover_all_user_brains() -> None:
    """Відновити перервані транзакції для всіх відомих brain користувачів."""
    for brain_id in brain_context.list_user_brain_ids():
        try:
            root = brain_context.resolve_user_brain_root(brain_id)
            with brain_context.set_brain_root(root):
                dream_cycle.recover_pending_transactions()
        except Exception:  # noqa: BLE001 — одна пошкоджена папка не має блокувати старт
            log.exception("Не вдалося відновити brain %s", brain_id)


async def _dream_cycle_all_users() -> None:
    """Scheduled nightly consolidation over every initialized user brain."""
    for brain_id in brain_context.list_user_brain_ids():
        try:
            root = brain_context.resolve_user_brain_root(brain_id)
            with brain_context.set_brain_root(root):
                await dream_cycle.dream_cycle()
        except Exception:  # noqa: BLE001 — ізоляція між користувачами: помилка одного не ламає інших
            log.exception("Dream cycle failed for brain %s", brain_id)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # На старті лише гарантуємо папку памʼяті; static/ може ще не існувати — це ОК
    cfg.BRAIN_DIR.mkdir(parents=True, exist_ok=True)
    brain_context.BRAIN_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    # Відновлення має завершитися до запуску фонових задач і прийому API-запитів.
    _recover_all_user_brains()
    # Консоль: перехоплюємо логи застосунку/httpx у фронтенд-панель
    console_log.install()
    # Ланцюжок сигналів: SIGINT/SIGTERM закривають SSE-потоки ще ДО того,
    # як uvicorn почне чекати закриття з'єднань (інакше shutdown висів би)
    _install_signal_chain()
    # Фоновий «нагляд за життям»: зір, привітання, сум, дрімота
    vision_watcher.start()
    scheduler = None
    try:
        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            _dream_cycle_all_users,
            "cron",
            hour=4,
            minute=0,
            id="dream_cycle",
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
        scheduler.start()
        yield
    finally:
        if scheduler is not None:
            try:
                scheduler.shutdown(wait=False)
            except Exception:  # noqa: BLE001 — cleanup інших сервісів мусить продовжитися
                log.exception("Не вдалося зупинити dream-cycle scheduler")
        # Порядок очистки: SSE → watcher → display-відправки → дочірні процеси.
        events.close_all()
        try:
            await coding.stop_all()
        except Exception:  # noqa: BLE001 — решта очистки мусить відпрацювати
            log.exception("Не вдалося зупинити кодинг-сесії")
        try:
            await vision_watcher.stop()
        finally:
            try:
                await display_bridge.shutdown()
            finally:
                services_manager.shutdown_all()


app = FastAPI(title="Клод Бот — Virtual Bot", lifespan=lifespan)

# ------------------------------------------------------------------ CORS
# Дебаг-панель роздає сам бекенд, тому їй CORS не потрібен. А застосунок
# (claude-bot-app) — окремий фронтенд: у вебі він живе на іншому порту, в
# Electron — на локальному http, і без цього браузер блокує кожен запит.
# React Native (Expo Go на телефоні) CORS не застосовує взагалі.
#
# Свідомо НЕ "*": авторизація йде Bearer-токеном, і відкривати API будь-якому
# сайту, який користувач відкриє в тому ж браузері, не варто. Список —
# локальні адреси розробки; для іншого хоста задайте CORS_ORIGINS
# (через кому) у .env.
_CORS_DEFAULT = [
    "http://localhost:8081",    # Metro (expo start --web)
    "http://127.0.0.1:8081",
    "http://localhost:8082",    # Electron: локальний статичний сервер
    "http://127.0.0.1:8082",
    "http://localhost:19006",   # історичний порт Expo web
    "http://127.0.0.1:19006",
]
_cors_env = (os.environ.get("CORS_ORIGINS") or "").strip()
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] or _CORS_DEFAULT

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    # allow_credentials=False НАВМИСНО: токен їде заголовком Authorization,
    # cookies не використовуються. З credentials=True браузер вимагав би
    # точного origin і відкривав шлях до крадіжки сесії з чужої вкладки.
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def reject_oversized_asr_request(request: Request, call_next):
    """Відсікає завеликий multipart ASR до запуску парсера UploadFile."""
    if request.method == "POST" and request.url.path == "/api/asr":
        raw_length = request.headers.get("content-length")
        if not raw_length:
            return JSONResponse(status_code=411, content={"detail": "Потрібен Content-Length"})
        try:
            content_length = int(raw_length)
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Некоректний Content-Length"})
        # Multipart додає службові заголовки/межі навколо самого аудіо.
        max_request = cfg.REGOLO_ASR_MAX_UPLOAD_BYTES + 1024 * 1024
        if content_length > max_request:
            return JSONResponse(status_code=413, content={"detail": "Аудіо завелике"})
    return await call_next(request)


# ------------------------------------------------------------------ auth helpers

def _clerk_user_or_none(request: Request) -> Optional[str]:
    """Без токена -> None (пустить без 401), з токеном -> sub або 401."""
    if auth_clerk.is_auth_disabled():
        return None
    # Шукаємо токен у заголовках / query
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = (request.headers.get("x-clerk-token") or request.query_params.get("token") or "").strip()
    if not token:
        return None
    # Є токен — перевіряємо строго
    payload = auth_clerk.verify_clerk_token(token)
    return auth_clerk.user_id_from_payload(payload)


async def _require_user(request: Request) -> str:
    """Strict gate: без валідного Clerk токена — 401. Для всіх /api/chat|memory|workspace|..."""
    if auth_clerk.is_auth_disabled():
        # Дев-режим без Clerk: ПОРОЖНІЙ uid, а не "dev". Будь-який непорожній
        # рядок тут вмикає clerk-гілку в _active_brain/chat_store: усі розмови
        # злипаються в один brain «dev» у user_data/<sha(clerk:dev)>/, посесійна
        # ізоляція (test_user_brain_isolation) мертва, а тести пишуть повз
        # підмінений CHATS_DIR у справжні дані. Порожній uid = стара локальна
        # модель: brain за session_id, чати в user_data/chats.
        return ""
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = (request.headers.get("x-clerk-token") or request.query_params.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Потрібен вхід (Clerk)")
    payload = auth_clerk.verify_clerk_token(token)
    return auth_clerk.user_id_from_payload(payload)


# Вибір моделі кодинг-агента живе в окремому роутері (coding_api.py):
# у main.py уже 1900+ рядків, і кожна нова ручка робить перегляд змін важчим.
app.include_router(coding_api.router)


@app.get("/api/auth/me")
async def api_auth_me(request: Request):
    if auth_clerk.is_auth_disabled():
        return {"user": None, "disabled": True}
    try:
        uid = await _require_user(request)
        return {"user": {"id": uid}, "disabled": False}
    except HTTPException as e:
        if e.status_code == 401:
            return JSONResponse(status_code=401, content={"detail": e.detail})
        raise


@app.get("/api/auth/config")
async def api_auth_config():
    issuer = auth_clerk.get_clerk_issuer()
    return {"issuer": issuer, "disabled": auth_clerk.is_auth_disabled()}


# ------------------------------------------------------------------ моделі

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    stream: bool = False
    session_id: str = Field(default="", max_length=64)
    history: list[dict[str, str]] = Field(default_factory=list)
    reasoning_effort: str = Field(default="none", pattern="^(none|low|medium|high)$")
    attachments: list[dict[str, str]] = Field(default_factory=list, max_length=8)


class MemorySaveRequest(BaseModel):
    path: str = Field(min_length=1, max_length=300)
    content: str = Field(max_length=200_000)
    session_id: str = Field(default="", max_length=64)


class BrainDirectoryRequest(BaseModel):
    path: str = Field(min_length=1, max_length=300)
    session_id: str = Field(default="", max_length=64)


class BrainFileRequest(BaseModel):
    path: str = Field(min_length=1, max_length=300)
    content: str = Field(max_length=200_000)
    overwrite: bool = False
    session_id: str = Field(default="", max_length=64)


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    speaker: Optional[int] = Field(default=None)  # None → активний голос


class VoiceSelectRequest(BaseModel):
    speaker: int = Field(ge=0, le=99)


class EmotionRequest(BaseModel):
    # Емоцію ставить OpenClaw-агент через emotions-MCP (tool set_emotion) —
    # це РЕАЛЬНА активність мозку, що оживляє обличчя краба наживо.
    emotion: str = Field(min_length=1, max_length=40)
    text: str = Field(default="", max_length=400)


class ModelSelectRequest(BaseModel):
    # protected_namespaces=() — щоб поле «model» не конфліктувало з namespace
    # pydantic «model_» (нам потрібне саме таке імʼя за контрактом API)
    model_config = {"protected_namespaces": ()}
    model: str = Field(min_length=1, max_length=200)


class ProfileSaveRequest(BaseModel):
    name: str = Field(default="", max_length=60)
    language: str = Field(default="uk", max_length=8)
    persona: str = Field(default="friendly", max_length=40)
    persona_custom: str = Field(default="", max_length=400)
    greeting: str = Field(default="", max_length=300)


class McpEnableRequest(BaseModel):
    id: str = Field(min_length=1, max_length=60)
    # Реальні значення ключів для MCP (напр. {"BRAVE_API_KEY": "..."}); секрет
    env: dict[str, str] = Field(default_factory=dict)


class SkillInstallRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=128)
    version: str = Field(default="", max_length=64)
    force: bool = False


class StorePackageRequest(BaseModel):
    id: str = Field(min_length=1, max_length=40)


class KeysSaveRequest(BaseModel):
    # Порожнє значення = не міняти. Значення — секрети, у відповідях не світимо.
    omni_key: str = Field(default="", max_length=300)
    openclaw_token: str = Field(default="", max_length=300)


# ------------------------------------------------------------------ статус

async def _http_alive(client: httpx.AsyncClient, url: str) -> bool:
    """Чи відповідає URL 200-кою (для health-ендпоінтів)."""
    try:
        # wait_for — жорстка стеля перевірки: httpx-таймаут по-фазний, і сервіс,
        # що «цідить» відповідь по байту, інакше тримав би /api/status вічно
        resp = await asyncio.wait_for(client.get(url, timeout=1.5), timeout=2.0)
        return resp.status_code == 200
    except Exception:  # noqa: BLE001 — /api/status не має права падати через битий URL у конфігу
        return False


@app.get("/api/status")
async def api_status() -> dict:
    """Доступність мозків і сервісів + активний режим мозку."""
    # trust_env=False: перевіряються ЛОКАЛЬНІ сервіси — системний/env проксі
    # обходимо, інакше відповіді проксі спотворюють статус (див. httpx_trust_env)
    async with httpx.AsyncClient(trust_env=False) as client:
        omni_ok, openclaw_reachable, chat2api_ok, vision_ok, display_ok = await asyncio.gather(
            brains.check_omni_reachable(client),
            brains.check_openclaw_reachable(client),
            brains.check_chat2api_alive(client),
            _http_alive(client, f"{cfg.VISION_BASE_URL}/health"),
            _http_alive(client, f"{cfg.DISPLAY_BASE_URL}/health"),
        )

    # check_omni_reachable уже вимагає наявність ключа, тож omni_ok = «ключ є І живий»
    openclaw_ok = openclaw_reachable and cfg.get_openclaw_token() is not None
    anthropic_ok = cfg.get_anthropic_key() is not None

    # mode = мозок, що РЕАЛЬНО відповів на останній чат (ping може «брехати»:
    # gateway живий, а chatCompletions віддає 500). До першого чату —
    # очікуваний режим за доступністю (за тим самим пріоритетом, що й chat()).
    last_brain = brains.get_last_successful_brain()
    if last_brain is not None:
        mode = last_brain
    elif openclaw_ok:
        mode = "openclaw"
    elif omni_ok:
        mode = "omni"
    elif anthropic_ok:
        mode = "anthropic"
    elif chat2api_ok:
        mode = "chat2api"
    else:
        mode = "demo"

    return {
        "omni": omni_ok,
        "openclaw": openclaw_ok,
        "anthropic": anthropic_ok,
        "chat2api": chat2api_ok,
        "vision": vision_ok,
        "display": display_ok,
        "mode": mode,
    }


# ------------------------------------------------------------------ моделі Omni

@app.get("/api/models")
async def api_models(request: Request) -> dict:
    """
    Список моделей + та, якою РЕАЛЬНО відповіли останній раз.

    Панель показувала «Claude Sonnet 5» із кованого списку, хоча відповідав
    зовсім інший мозок зі своєю моделлю — тому віддаємо ще й active/brain,
    щоб у шапці було видно правду, а не намір.
    """
    await _require_user(request)
    return {
        "models": brains.models_with_capabilities(),
        "selected": brains.get_selected_omni_model(),
        "default": cfg.OMNI_DEFAULT_MODEL,
        "active": brains.get_last_model(),
        "brain": brains.get_last_successful_brain() or "",
    }


@app.post("/api/model")
async def api_model_select(req: ModelSelectRequest, request: Request) -> dict:
    """Ставить активну модель Omni (лише з кованого списку config.yaml)."""
    await _require_user(request)
    if not brains.set_selected_omni_model(req.model):
        raise HTTPException(status_code=400, detail="Невідома або недозволена модель")
    return {"ok": True, "selected": brains.get_selected_omni_model()}


# ------------------------------------------------------------------ майстер налаштування

@app.get("/api/setup")
def api_setup_get() -> dict:
    """Профіль бота + варіанти (мови, характери) + чи вже налаштовано."""
    prof = profile_store.load()
    return {
        "profile": prof,
        "configured": bool(prof.get("configured")),
        "languages": [{"id": k, "label": v["label"]} for k, v in profile_store.LANGUAGES.items()],
        "personas": [{"id": k, "label": v["label"], "icon": v.get("icon", ""), "hint": v.get("hint", "")}
                     for k, v in profile_store.PERSONAS.items()],
        "reply_lengths": [{"id": k, "label": v["label"]} for k, v in profile_store.REPLY_LENGTHS.items()],
        "models": brains.models_with_capabilities(),
        "selected_model": brains.get_selected_omni_model(),
        # Чи задані ключі (лише факт, не значення)
        "keys_set": {
            "omni": cfg.get_omni_key() is not None,
            "openclaw": cfg.get_openclaw_token() is not None,
        },
    }


def _update_env_file(updates: dict[str, str]) -> None:
    """Оновлює Virtual Bot/.env наданими KEY=VALUE (лише непорожні), права 600."""
    env_path = cfg.BASE_DIR / ".env"
    lines: list[str] = []
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        pass
    for key, val in updates.items():
        if not val:
            continue
        lines = [ln for ln in lines if not ln.strip().startswith(f"{key}=")]
        lines.append(f"{key}={val}")
        os.environ[key] = val  # застосувати одразу в поточному процесі
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        env_path.chmod(0o600)
    except OSError:
        pass


@app.post("/api/setup/keys")
def api_setup_keys(req: KeysSaveRequest) -> dict:
    """Зберігає секрети у .env (порожнє = не міняти). Значення не повертаємо."""
    _update_env_file({
        "OMNI_API_KEY": req.omni_key.strip(),
        "OPENCLAW_TOKEN": req.openclaw_token.strip(),
    })
    return {
        "ok": True,
        "keys_set": {
            "omni": cfg.get_omni_key() is not None,
            "openclaw": cfg.get_openclaw_token() is not None,
        },
    }


@app.post("/api/setup")
def api_setup_save(req: ProfileSaveRequest) -> dict:
    """Зберігає профіль (імʼя/мова/характер/привітання) — одразу впливає на промпт."""
    prof = profile_store.save(req.model_dump())
    return {"ok": True, "profile": prof}


@app.get("/api/setup/suggestions")
def api_setup_suggestions() -> dict:
    """Куровані MCP-сервери (+ recommended), пресети й порада щодо скілів."""
    mcp = []
    for item in setup_suggestions.MCP_SUGGESTIONS:
        mcp.append({
            "id": item["id"], "name": item["name"], "desc": item["desc"],
            "category": item["category"], "needs_key": item["needs_key"],
            "recommended": item.get("recommended", False),
            "env": item.get("env", []),  # назви ключів, які треба ввести
            "note": item["note"], "command": setup_suggestions.display_command(item),
        })
    return {"mcp": mcp, "presets": setup_suggestions.PRESETS, "skills_note": setup_suggestions.SKILLS_NOTE}


def _enable_one_mcp(mcp_id: str, env_values: dict | None = None) -> dict:
    """Додає один MCP у OpenClaw (`openclaw mcp add …`). Best-effort → {ok, output}."""
    item = setup_suggestions.by_id(mcp_id)
    if item is None:
        return {"ok": False, "id": mcp_id, "output": "Невідома пропозиція MCP"}
    cmd = setup_suggestions.enable_command(item, env_values)
    # У лог — БЕЗ значень ключів (маскована версія)
    log.info("→ Вмикаю MCP «%s»: %s", mcp_id, setup_suggestions.display_command(item))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        out = (proc.stdout + proc.stderr).strip()
        ok = proc.returncode == 0
        log.info("MCP «%s» %s", mcp_id, "додано" if ok else f"не вдалося (код {proc.returncode})")
        return {"ok": ok, "id": mcp_id, "output": out[-1500:]}
    except subprocess.TimeoutExpired:
        log.warning("MCP «%s»: таймаут проби (120с)", mcp_id)
        return {"ok": False, "id": mcp_id, "output": "Таймаут проби (120с) — можливо, треба ключ або пакет недоступний."}
    except FileNotFoundError:
        return {"ok": False, "id": mcp_id, "output": "Команда openclaw не знайдена у PATH."}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "id": mcp_id, "output": f"Помилка: {type(exc).__name__}: {exc}"}


@app.post("/api/setup/mcp/enable")
def api_setup_mcp_enable(req: McpEnableRequest) -> dict:
    """Реально додає MCP-сервер в OpenClaw (best-effort), з ключами з майстра."""
    if setup_suggestions.by_id(req.id) is None:
        raise HTTPException(status_code=404, detail="Невідома пропозиція MCP")
    return _enable_one_mcp(req.id, req.env)


@app.post("/api/setup/preset/enable")
def api_setup_preset_enable(req: McpEnableRequest) -> dict:
    """Вмикає ВСІ MCP пресету по черзі (best-effort) → зведення результатів."""
    preset = setup_suggestions.preset_by_id(req.id)
    if preset is None:
        raise HTTPException(status_code=404, detail="Невідомий пресет")
    results = [_enable_one_mcp(mid) for mid in preset["mcp"]]
    return {"preset": preset["id"], "results": results,
            "ok_count": sum(1 for r in results if r["ok"]), "total": len(results)}


@app.get("/api/store")
async def api_store(
    request: Request,
    query: str = Query(default="", max_length=160),
    kind: str = Query(default="all", pattern="^(all|skills|mcp)$"),
    limit: int = Query(default=24, ge=1, le=50),
) -> dict:
    """Шукає скіли через OpenClaw, а MCP — у безпечному курованому каталозі."""
    await _require_user(request)
    return await asyncio.to_thread(openclaw_store.catalog, query=query, kind=kind, limit=limit)


@app.post("/api/store/skills/install")
async def api_store_skill_install(req: SkillInstallRequest, request: Request) -> dict:
    """Встановлює ClawHub-скіл виключно командою `openclaw skills install`."""
    await _require_user(request)
    try:
        return await asyncio.to_thread(
            openclaw_store.install_skill,
            req.slug,
            version=req.version,
            force=req.force,
        )
    except openclaw_store.OpenClawStoreError as exc:
        status = 400 if exc.code in {"invalid_slug", "invalid_version"} else 503
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/api/store/mcp/install")
async def api_store_mcp_install(req: McpEnableRequest, request: Request) -> dict:
    """Додає MCP тільки зі списку каталогу через існуючий OpenClaw bridge."""
    await _require_user(request)
    if setup_suggestions.by_id(req.id) is None:
        raise HTTPException(status_code=404, detail="Невідомий MCP у каталозі")
    return await asyncio.to_thread(_enable_one_mcp, req.id, req.env)


# ------------------------------------------------------------------ магазин екрана
#
# На відміну від /api/store (OpenClaw-скіли + MCP), це магазин ПРИСТРОЮ:
# пакети, що встановлюються на сам екран /screen — застосунки та скіни.
# Без Clerk-гейту, як /api/services: пристрій локальний, екран не має токена.

@app.get("/api/screen-store/catalog")
async def api_screen_store_catalog() -> dict:
    """Каталог пакетів екрана (apps, skins) із прапорцем «встановлено»."""
    return await asyncio.to_thread(screen_store.catalog)


@app.get("/api/screen-store/installed")
async def api_screen_store_installed() -> dict:
    """Встановлені пакети: шухляда екрана додає застосунки собі звідси."""
    apps = await asyncio.to_thread(screen_store.installed_apps)
    skins = await asyncio.to_thread(screen_store.installed_skins)
    return {"apps": apps, "skins": skins}


@app.post("/api/screen-store/install")
async def api_screen_store_install(req: StorePackageRequest) -> dict:
    try:
        return await asyncio.to_thread(screen_store.install, req.id)
    except screen_store.StoreError as exc:
        status = 400 if exc.code in {"invalid_id", "too_large"} else 404
        raise HTTPException(status_code=status, detail=str(exc)) from exc


@app.post("/api/screen-store/uninstall")
async def api_screen_store_uninstall(req: StorePackageRequest) -> dict:
    try:
        return await asyncio.to_thread(screen_store.uninstall, req.id)
    except screen_store.StoreError as exc:
        status = 400 if exc.code == "invalid_id" else 404
        raise HTTPException(status_code=status, detail=str(exc)) from exc


# Встановлені застосунки роздаються як звичайна статика: iframe у layer-app
# відкриває /store-apps/<id>/index.html. StaticFiles захищає від path traversal.
app.mount(
    "/store-apps",
    StaticFiles(directory=cfg.STORE_DIR / "installed" / "apps", check_dir=False),
    name="store-apps",
)


# ------------------------------------------------------------------ музика (Now Playing)
#
# Читання/стрім без Clerk-гейту: екран пристрою не має токена, а музика —
# частина пристрою, як /api/services.

@app.get("/api/music/status")
async def api_music_status() -> dict:
    """Що з музики зараз працює (yt-dlp / транскрайб) — екран показує чесно."""
    return music.availability()


@app.get("/api/music/search")
async def api_music_search(q: str = Query(min_length=1, max_length=200), limit: int = Query(default=5, ge=1, le=8)) -> dict:
    tracks = await music.search(q, limit)
    if not tracks:
        detail = "Пошук недоступний: встанови yt-dlp (pip install yt-dlp)" if music.yt_dlp is None \
            else "Нічого не знайшлось або YouTube не відповів"
        raise HTTPException(status_code=503, detail=detail)
    return {"tracks": tracks}


@app.get("/api/music/radio")
async def api_music_radio() -> dict:
    """Каталог радіо: живі потоки, перемотки для них не існує."""
    return {"stations": music.radio_catalog()}


@app.get("/api/music/stream")
async def api_music_stream(request: Request, provider: str = Query(default="youtube", pattern="^(youtube|radio)$"),
                           id: str = Query(min_length=1, max_length=64)):
    """
    Проксі аудіо з підтримкою Range — саме завдяки 206/Content-Range
    перемотка в браузері працює, як у справжньому плеєрі.
    """
    if provider == "radio":
        station = music.radio_station(id)
        if station is None:
            raise HTTPException(status_code=404, detail="Невідома радіостанція")
        upstream_url = station["url"]
    else:
        video_id = music.parse_video_id(id)
        if video_id is None:
            raise HTTPException(status_code=400, detail="Некоректний id відео")
        try:
            upstream_url = await music.audio_stream_url(video_id)
        except Exception as exc:  # noqa: BLE001 — yt-dlp/мережа: віддаємо 503
            log.warning("Стрім %s не вдалося відкрити: %s", video_id, exc)
            raise HTTPException(status_code=503, detail="Не вдалося отримати аудіопотік (див. лог)") from exc

    range_header = request.headers.get("range")
    try:
        status, headers, body = await music.open_stream(upstream_url, range_header)
    except Exception as exc:  # noqa: BLE001 — upstream впав/таймаут
        log.warning("Upstream-стрім недоступний: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=502, detail="Потік недоступний") from exc

    return StreamingResponse(
        body,
        status_code=status,
        headers=headers,
        media_type=headers.get("content-type", "audio/mpeg"),
    )


@app.get("/api/music/transcript")
async def api_music_transcript(id: str = Query(min_length=1, max_length=200), lang: str = Query(default="uk", max_length=8),
                               text: bool = Query(default=False)):
    """Субтитри відео (youtube-transcript-api): сегменти або склеєний текст."""
    video_id = music.parse_video_id(id)
    if video_id is None:
        raise HTTPException(status_code=400, detail="Це не схоже на id/посилання YouTube")
    if music.YouTubeTranscriptApi is None:
        raise HTTPException(status_code=503, detail="Встанови youtube-transcript-api (pip install youtube-transcript-api)")
    try:
        segments = await music.transcript(video_id, [lang, "uk", "en"])
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=f"Субтитри недоступні: {exc}") from exc
    except Exception as exc:  # noqa: BLE001 — мережа/обмеження YouTube
        log.warning("Транскрайб %s не вдався: %s", video_id, exc)
        raise HTTPException(status_code=502, detail="Субтитри не вдалося завантажити") from exc
    if text:
        return {"video_id": video_id, "text": music.transcript_to_text(segments)}
    return {"video_id": video_id, "segments": segments}


# ------------------------------------------------------------------ сесійна памʼять чату

# Максимальна кількість активних сесій і TTL (секунд) для захисту від витоку памʼяті
_MAX_SESSIONS = 1000
_SESSION_TTL_S = 3600

_sessions: dict[str, tuple[list[dict[str, str]], float]] = {}
_sessions_lock = Lock()


def _cleanup_stale_sessions() -> None:
    """Прибирає сесії, що неактивні довше за _SESSION_TTL_S, і обмежує загальну кількість."""
    now = time.monotonic()
    stale = [sid for sid, (_, last) in _sessions.items() if now - last > _SESSION_TTL_S]
    for sid in stale:
        _sessions.pop(sid, None)
    if len(_sessions) > _MAX_SESSIONS:
        sorted_sids = sorted(_sessions, key=lambda s: _sessions[s][1])
        for sid in sorted_sids[: len(_sessions) - _MAX_SESSIONS]:
            _sessions.pop(sid, None)


def _get_or_create_session_id(req: ChatRequest) -> str:
    """Повертає існуючий або новий session_id."""
    sid = (req.session_id or "").strip()
    if sid and len(sid) <= 64:
        return sid
    return uuid.uuid4().hex[:16]


def _get_history(sid: str, req_history: list[dict[str, str]]) -> list[dict[str, str]]:
    """Історія: спершу явно передана, інакше з in-memory сесії."""
    if req_history:
        return [
            {"role": h.get("role", ""), "content": h.get("content", "")}
            for h in req_history
            if isinstance(h, dict) and h.get("role") in ("user", "assistant") and h.get("content")
        ][-cfg.CHAT_HISTORY_LIMIT:]
    with _sessions_lock:
        entry = _sessions.get(sid)
        if entry is not None:
            return list(entry[0])[-cfg.CHAT_HISTORY_LIMIT:]
    # Памʼять процесу порожня (рестарт панелі або TTL) — беремо з диска,
    # інакше бот забував розмову після кожного перезапуску.
    return chat_store.history(sid, cfg.CHAT_HISTORY_LIMIT)


def _save_history(
    sid: str,
    history: list[dict[str, str]],
    user: str,
    assistant: str,
    steps: list | None = None,
    attachments: list[dict] | None = None,
) -> None:
    """Дописує обмін до історії сесії: у памʼять процесу і на диск."""
    history.append({"role": "user", "content": user})
    history.append({"role": "assistant", "content": assistant})
    with _sessions_lock:
        _cleanup_stale_sessions()
        _sessions[sid] = (history[-cfg.CHAT_HISTORY_LIMIT:], time.monotonic())
    try:
        chat_store.append(sid, user, assistant, steps, attachments)
    except Exception:  # noqa: BLE001 — збереження історії не має валити відповідь
        log.exception("Не вдалося зберегти чат на диск")


async def _autoname_chat(sid: str, user_message: str, reply: str) -> None:
    """
    Просить мозок придумати коротку назву чату після першого обміну.

    Робимо це у фоні й лише один раз на сесію: назва — дрібниця, вона не має
    ні затримувати відповідь, ні коштувати зайвий виклик на кожне повідомлення.
    Якщо мозок не відповів — лишається запасна назва з першого повідомлення.
    """
    if not chat_store.needs_title(sid):
        return
    prompt = (
        "Придумай коротку назву цієї розмови — 2-4 слова, без лапок, без крапки в кінці, "
        "тією ж мовою, що й розмова. У відповідь напиши ЛИШЕ назву.\n\n"
        f"Користувач: {user_message[:400]}\nТи: {reply[:400]}"
    )
    try:
        title, _emotion, _mode, _tools = await asyncio.wait_for(
            brains.chat(prompt, []), timeout=30
        )
    except Exception:  # noqa: BLE001 — назва не варта того, щоб щось ламати
        log.debug("Не вдалося згенерувати назву чату", exc_info=True)
        return
    finally:
        chat_store.mark_titled(sid)
    # Мозок любить додати пояснення — беремо лише перший рядок
    first_line = (title or "").strip().splitlines()[0] if title else ""
    if first_line:
        chat_store.set_title(sid, first_line.strip(' "«».'))


def _extract_and_save_facts(message: str) -> None:
    """Витягує факти у спільний профіль власника, доступний у нових чатах."""
    facts = brains.extract_user_facts(message)
    # Автоматично витягнуті факти мають одне канонічне місце: brain власника.
    # Ручні нотатки та memory API активного чату лишаються сесійно ізольованими.
    owner_root = brain_context.init_user_brain(None)
    with brain_context.set_brain_root(owner_root):
        for fact in facts:
            try:
                memory.append_user_profile(fact)
            except Exception:  # noqa: BLE001
                log.exception("Не вдалося зберегти факт у профіль користувача")


def _chat_reasoning_kwargs(reasoning_effort: str) -> dict[str, str]:
    """Не змінює старий виклик brains.chat для типового вимкненого reasoning."""
    return {"reasoning_effort": reasoning_effort} if reasoning_effort != "none" else {}


def _chat_image_kwargs(images: list[dict[str, str]]) -> dict[str, list[dict[str, str]]]:
    """Не передає зайвий kwarg старим мозкам/тестовим адаптерам без зображень."""
    return {"images": images} if images else {}


def _asr_backend() -> tuple[str, Any]:
    """Повертає активний ASR-бекенд: локальний Whisper або Regolo fallback."""
    provider = cfg.ASR_PROVIDER
    if provider in {"whisper", "whisper_local", "local"}:
        return "whisper_local", asr_whisper
    if provider in {"regolo", "cloud"}:
        return "regolo", asr_regolo
    if provider in {"auto", ""}:
        # Якщо Regolo вже налаштований, лишаємо стару поведінку й не
        # перехоплюємо його локальним модулем (це важливо і для live-сесій).
        if asr_regolo.is_available():
            return "regolo", asr_regolo
        if asr_whisper.is_available():
            return "whisper_local", asr_whisper
        return "regolo", asr_regolo
    log.warning("Невідомий ASR provider=%s — використовую auto", provider)
    if asr_regolo.is_available():
        return "regolo", asr_regolo
    if asr_whisper.is_available():
        return "whisper_local", asr_whisper
    return "regolo", asr_regolo


_VISION_MIME = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_VISION_MAX_BYTES = 10 * 1024 * 1024
_VISION_SUFFIXES = {
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/webp": {".webp"},
    "image/gif": {".gif"},
}


def _matches_image_signature(data: bytes, mime: str) -> bool:
    """Не довіряємо лише MIME із браузера: перевіряємо сигнатуру файла."""
    if mime == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime == "image/gif":
        return data.startswith((b"GIF87a", b"GIF89a"))
    if mime == "image/webp":
        return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return False


def _load_chat_images(attachments: list[dict[str, str]]) -> list[dict[str, str]]:
    """Читає лише зображення, які вже безпечно завантажені в uploads/."""
    root = cfg.UPLOADS_DIR.resolve()
    images: list[dict[str, str]] = []
    for attachment in attachments[:8]:
        url = str(attachment.get("url") or "")
        mime = str(attachment.get("type") or "").lower()
        if not url.startswith("/uploads/") or mime not in _VISION_MIME:
            continue
        filename = url.removeprefix("/uploads/")
        if not filename or "/" in filename or "\\" in filename:
            continue
        candidate = root / filename
        if candidate.is_symlink():
            continue
        path = candidate.resolve()
        try:
            path.relative_to(root)
        except ValueError:
            continue
        if (
            not path.is_file()
            or path.stat().st_size > _VISION_MAX_BYTES
            or path.suffix.lower() not in _VISION_SUFFIXES[mime]
        ):
            continue
        data = path.read_bytes()
        if not _matches_image_signature(data, mime):
            continue
        images.append({
            "mime": mime,
            "data": base64.b64encode(data).decode("ascii"),
        })
    return images


# ------------------------------------------------------------------ чат

@app.post("/api/chat")
async def api_chat(request: Request, req: ChatRequest):
    """Повідомлення користувача → відповідь бота + емоція (мозок за пріоритетом)."""
    clerk_uid = await _require_user(request)
    message = req.message.strip()
    images = await asyncio.to_thread(_load_chat_images, req.attachments)
    sid = _get_or_create_session_id(req)
    log.info("→ Запит у чат: session=%s user=%s %s", sid, clerk_uid[:8], message[:120])
    try:
        vision_watcher.note_interaction()  # будить бота з дрімоти
    except Exception:  # noqa: BLE001 — інтеграція не має права зламати чат
        log.exception("note_interaction не спрацював")

    with _brain_context(sid, clerk_uid):
        history = _get_history(sid, req.history)
        # Зберігаємо факти з цього повідомлення ДО відповіді (незалежно від мозку)
        await asyncio.to_thread(_extract_and_save_facts, message)

        if not req.stream:
            reply, emotion, mode, tool_results = await brains.chat(
                message, history, **_chat_image_kwargs(images),
                **_chat_reasoning_kwargs(req.reasoning_effort),
            )
            final_emotion = emotions.settled_emotion(emotion)
            log.info("Чат (режим=%s, емоція=%s, tools=%d)", mode, emotion, len(tool_results))
            _save_history(sid, history, message, reply, attachments=req.attachments)
            # Назву чату генеруємо у фоні — відповідь на неї не чекає
            asyncio.create_task(_autoname_chat(sid, message, reply))

            # Інтеграційний шар: SSE-подія, міст до дисплея, автожурнал.
            # Помилка будь-якої з цих дій НЕ ламає відповідь клієнту.
            try:
                events.publish_emotion(final_emotion)
            except Exception:  # noqa: BLE001
                log.exception("Не вдалося опублікувати SSE-подію емоції")
            try:
                display_bridge.send_chat_exchange_bg(message, reply, final_emotion)
                events.publish_reply(reply, final_emotion)
            except Exception:  # noqa: BLE001
                log.exception("Не вдалося запустити відправку на дисплей")
            try:
                await asyncio.to_thread(memory.append_chat_log, message, reply, emotion)
            except Exception:  # noqa: BLE001
                log.exception("Не вдалося дописати автожурнал")

            return {
                "reply": reply,
                "emotion": final_emotion,
                "session_id": sid,
                "mode": mode,
                "model": brains.get_last_model(),
                "tool_results": tool_results,
            }

    async def stream_response():
        # Стрімінг виконується в окремому життєвому циклі запиту: перевстановлюємо
        # ізольований brain користувача, бо ContextVar у FastAPI-генераторі може
        # не успадковуватися автоматично.
        with _brain_context(sid, clerk_uid):
            event_queue: asyncio.Queue[dict] = asyncio.Queue()

            # Скільки тексту вже віддали СПРАВЖНІМ стрімом токенів (brains шле delta).
            # Якщо мозок стрімить — НЕ ріжемо готову відповідь на слова вдруге.
            streamed = {"text": ""}
            # Тег [емоція:…] моделі не має світитись у чаті: ріжемо його прямо в
            # потоці, а знайдену емоцію показуємо на обличчі ОДРАЗУ, а не в кінці.
            tag_filter = emotions.StreamTagFilter()

            async def emit(event: dict) -> None:
                if event.get("type") == "delta":
                    visible, found = tag_filter.feed(event.get("chunk") or "")
                    if found:
                        try:
                            events.publish_emotion(found)
                        except Exception:  # noqa: BLE001 — обличчя не має валити чат
                            log.exception("Не вдалося опублікувати ранню емоцію")
                        await event_queue.put({"type": "emotion", "emotion": found})
                    if not streamed["text"]:
                        # Після вирізаного тега лишається пробіл на початку —
                        # у фінальній відповіді його немає (extract_emotion робить
                        # strip), а розбіжність зламала б звірку нижче.
                        visible = visible.lstrip()
                    if not visible:
                        return  # чанк був цілком тегом (або чекає в буфері)
                    streamed["text"] += visible
                    event = {**event, "chunk": visible}
                await event_queue.put(event)

            chat_task = asyncio.create_task(brains.chat(
                message, history, emit=emit, **_chat_image_kwargs(images),
                **_chat_reasoning_kwargs(req.reasoning_effort),
            ))

            try:
                # Читаємо події від тулзів, поки чат виконується
                while not chat_task.done() or not event_queue.empty():
                    try:
                        event = await asyncio.wait_for(event_queue.get(), timeout=0.1)
                        yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        if chat_task.done():
                            break
                        continue

                reply, emotion, mode, tool_results = chat_task.result()
                final_emotion = emotions.settled_emotion(emotion)
                log.info("Чат stream (режим=%s, емоція=%s, tools=%d)", mode, emotion, len(tool_results))
                _save_history(sid, history, message, reply, attachments=req.attachments)
                asyncio.create_task(_autoname_chat(sid, message, reply))

                # Хвіст, який фільтр тримав «про всяк випадок» (виявився не тегом)
                tail = tag_filter.flush()
                if tail:
                    streamed["text"] += tail
                    yield f"event: delta\ndata: {json.dumps({'chunk': tail})}\n\n"

                # Якщо мозок віддав токени справжнім стрімом — текст уже на екрані.
                # Досилаємо лише те, чого бракує (напр. після вирізання тега емоції).
                already = streamed["text"]
                if already and reply.startswith(already):
                    rest = reply[len(already):]
                    if rest:
                        yield f"event: delta\ndata: {json.dumps({'chunk': rest})}\n\n"
                elif already:
                    # Текст розішовся (напр. вирізано тег емоції всередині) —
                    # просимо фронтенд замінити текст ціліком (done нижче все одно це зробить).
                    log.debug("Стрімовий текст відрізняється від фінального — заміню на done")
                else:
                    # Мозок не стрімить (демо, тулзи, Anthropic) — імітуємо пословно,
                    # щоб усе одно було видно появу тексту, а не стіну відразу.
                    words = reply.split(" ")
                    for i, word in enumerate(words):
                        chunk = word + (" " if i < len(words) - 1 else "")
                        yield f"event: delta\ndata: {json.dumps({'chunk': chunk})}\n\n"
                        await asyncio.sleep(0.02)

                yield f"event: emotion\ndata: {json.dumps({'emotion': final_emotion})}\n\n"
                yield f"event: done\ndata: {json.dumps({'reply': reply, 'emotion': final_emotion, 'session_id': sid, 'mode': mode, 'model': brains.get_last_model(), 'tool_results': tool_results})}\n\n"

                # Інтеграційний шар після стрімінгу
                try:
                    events.publish_emotion(final_emotion)
                except Exception:  # noqa: BLE001
                    log.exception("Не вдалося опублікувати SSE-подію емоції")
                try:
                    display_bridge.send_chat_exchange_bg(message, reply, final_emotion)
                    events.publish_reply(reply, final_emotion)
                except Exception:  # noqa: BLE001
                    log.exception("Не вдалося запустити відправку на дисплей")
                try:
                    await asyncio.to_thread(memory.append_chat_log, message, reply, emotion)
                except Exception:  # noqa: BLE001
                    log.exception("Не вдалося дописати автожурнал")
            except Exception as exc:  # noqa: BLE001
                log.exception("Помилка стрімінгу чату")
                try:
                    events.publish_emotion("idle")
                except Exception:  # noqa: BLE001
                    pass
                yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(stream_response(), media_type="text/event-stream")


# ------------------------------------------------------------------ історія чатів

def _chat_kind(kind: str) -> str:
    """
    Простір розмов із запиту. Чат і кодинг мають РІЗНІ списки: у кодингу свої
    задачі, свої назви й свій життєвий цикл, тож панель питає той простір,
    який зараз відкрито, а не фільтрує спільний список на клієнті.
    """
    return chat_store.KIND_CODE if (kind or "").strip() == chat_store.KIND_CODE else chat_store.KIND_CHAT


@app.get("/api/sessions")
async def api_sessions_list(request: Request, kind: str = Query(default="")) -> dict:
    """Список збережених розмов обраного простору, найсвіжіші першими."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        return {"sessions": chat_store.list_sessions(), "kind": _chat_kind(kind)}


@app.get("/api/sessions/{session_id}")
async def api_session_get(session_id: str, request: Request, kind: str = Query(default="")) -> dict:
    """Повна розмова: панель відновлює її при поверненні до чату."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        if not chat_store.is_valid_id(session_id):
            raise HTTPException(status_code=400, detail="Некоректний id сесії")
        return chat_store.load(session_id)


class SessionStepsRequest(BaseModel):
    steps: list[dict[str, Any]] = Field(default_factory=list)


class SessionPinRequest(BaseModel):
    pinned: bool


class SessionProjectRequest(BaseModel):
    project: str = Field(default="", max_length=50)


@app.post("/api/sessions/{session_id}/steps")
async def api_session_steps(session_id: str, request: Request, req: SessionStepsRequest, kind: str = Query(default="")) -> dict:
    """Панель докладає кроки інструментів до останньої відповіді бота."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        if not chat_store.is_valid_id(session_id):
            raise HTTPException(status_code=400, detail="Некоректний id сесії")
        chat_store.set_last_steps(session_id, req.steps)
        return {"ok": True}


@app.post("/api/sessions/{session_id}/pin")
async def api_session_pin(session_id: str, request: Request, req: SessionPinRequest, kind: str = Query(default="")) -> dict:
    """Зірочка чату: закріплені розмови повертаються першими у списку."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        if not chat_store.is_valid_id(session_id):
            raise HTTPException(status_code=400, detail="Некоректний id сесії")
        if not chat_store.set_pinned(session_id, req.pinned):
            raise HTTPException(status_code=404, detail="Чат не знайдено")
        return {"ok": True, "pinned": req.pinned}


@app.post("/api/sessions/{session_id}/project")
async def api_session_project(session_id: str, request: Request, req: SessionProjectRequest, kind: str = Query(default="")) -> dict:
    """Привʼязує чат до проєкту (папка вгорі списку) або знімає привʼязку."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        if not chat_store.is_valid_id(session_id):
            raise HTTPException(status_code=400, detail="Некоректний id сесії")
        project = req.project.strip()
        if project and not projects.exists(project):
            raise HTTPException(status_code=404, detail="Немає такого проєкту")
        if not chat_store.set_project(session_id, project):
            raise HTTPException(status_code=404, detail="Чат не знайдено")
        return {"ok": True, "project": project}


@app.delete("/api/sessions/{session_id}")
async def api_session_delete(session_id: str, request: Request, kind: str = Query(default="")) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid), chat_store.set_kind(_chat_kind(kind)):
        if not chat_store.is_valid_id(session_id):
            raise HTTPException(status_code=400, detail="Некоректний id сесії")
        return {"ok": chat_store.delete(session_id)}


# ------------------------------------------------------------------ завантаження файлів у чат

_UPLOAD_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]")


def _safe_upload_filename(name: Optional[str]) -> str:
    """Безпечне ім'я файлу для uploads/ (без traversal, із заміною небезпечних символів)."""
    base = os.path.basename(name or "upload")
    base = _UPLOAD_NAME_RE.sub("_", base).strip("._")
    if not base:
        base = "upload"
    return base


@app.post("/api/chat/upload")
async def api_chat_upload(file: UploadFile = File(...)) -> dict:
    """Завантажує файл із чату в uploads/ і повертає публічний URL."""
    cfg.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    filename = _safe_upload_filename(file.filename)
    target = cfg.UPLOADS_DIR / filename
    stem = target.stem
    suffix = target.suffix
    counter = 1
    while target.exists():
        filename = f"{stem}_{counter}{suffix}"
        target = cfg.UPLOADS_DIR / filename
        counter += 1

    try:
        with open(target, "wb") as f:
            shutil.copyfileobj(file.file, f)
    finally:
        await file.close()

    return {
        "url": f"/uploads/{filename}",
        "name": filename,
        "type": file.content_type or "application/octet-stream",
        "size": target.stat().st_size,
    }


# ------------------------------------------------------------------ живі події (SSE)

class _SSEResponse(StreamingResponse):
    """
    StreamingResponse для нескінченного SSE-потоку. При graceful shutdown
    uvicorn форс-скасовує «вічні» запити (timeout_graceful_shutdown) — це
    ОЧІКУВАНЕ завершення потоку, а не збій, тож CancelledError тут гасимо,
    щоб shutdown не смітив у лог трейсбеками «Exception in ASGI application».
    Підписка клієнта все одно прибирається у finally генератора events.
    """

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[override]
        try:
            await super().__call__(scope, receive, send)
        except asyncio.CancelledError:
            # Коректно закриваємо HTTP-відповідь, щоб uvicorn не скаржився
            # «ASGI callable returned without completing response»
            try:
                await send({"type": "http.response.body", "body": b"", "more_body": False})
            except Exception:  # noqa: BLE001 — з'єднання могло вже закритись
                pass


@app.post("/api/emotion")
def api_emotion(req: EmotionRequest) -> dict:
    """
    Ставить емоцію обличчя ззовні — головний споживач це emotions-MCP OpenClaw
    (агент викликає tool set_emotion під час роботи: searching/web/working/…),
    тож краб реагує на РЕАЛЬНУ активність мозку наживо. Невідома емоція → idle.
    Якщо передано text — публікуємо ще й say-подію (агент сам щось каже).
    """
    emotion = req.emotion.strip().lower()
    if emotion not in emotions.ALLOWED_EMOTIONS:
        # мапимо укр. синоніми (питаю→asking тощо), інакше idle
        emotion = emotions._UA_EMOTION_MAP.get(emotion, "idle")
        if emotion not in emotions.ALLOWED_EMOTIONS:
            emotion = "idle"
    log.info("set_emotion (MCP): %s", emotion)
    try:
        events.publish_emotion(emotion)
        if req.text.strip():
            events.publish_say(req.text.strip(), emotion)
    except Exception:  # noqa: BLE001 — подія не має права зламати ендпоінт
        log.exception("Не вдалося опублікувати подію емоції")
    return {"ok": True, "emotion": emotion}


@app.get("/api/tts/status")
def api_tts_status() -> dict:
    """Доступність укр. голосу Piper + список голосів і активний (для вибору у панелі)."""
    return {
        "enabled": piper_voice.is_available(),
        "provider": "piper",
        "streaming": False,
        "interruptible": True,
        "voices": piper_voice.VOICES,
        "selected": piper_voice.get_speaker(),
    }


@app.post("/api/tts/voice")
def api_tts_voice(req: VoiceSelectRequest) -> dict:
    """Ставить активний голос Piper (усі наступні озвучки — ним)."""
    if not piper_voice.set_speaker(req.speaker):
        raise HTTPException(status_code=400, detail="Невідомий голос")
    return {"ok": True, "selected": piper_voice.get_speaker()}


@app.post("/api/tts")
async def api_tts(req: TTSRequest):
    """
    Озвучує текст живим НЕЙРОННИМ українським голосом Piper (WAV, локально).
    speaker — тимчасовий голос для прослуховування (None → активний).
    Мозок — OpenClaw, Piper лише голос. 503, якщо недоступний.
    """
    try:
        audio = await asyncio.to_thread(piper_voice.synthesize, req.text, req.speaker)
    except Exception as exc:  # noqa: BLE001 — голос не критичний; кажемо 503, фронтенд впорається
        log.warning("Piper TTS не впорався (%s)", type(exc).__name__)
        return JSONResponse(status_code=503, content={"error": "TTS недоступний"})
    return StreamingResponse(iter([audio]), media_type="audio/wav",
                             headers={"Cache-Control": "no-store"})


@app.get("/api/asr/status")
async def api_asr_status(request: Request) -> dict:
    """Статус активного розпізнавача української мови."""
    await _require_user(request)
    provider, backend = _asr_backend()
    # Не розширюємо старий контракт: фронтенди й інтеграції очікують лише цей ключ.
    return {"enabled": backend.is_available()}


@app.post("/api/asr")
async def api_asr(request: Request, audio: UploadFile = File(...)) -> dict:
    """
    Розпізнає українську локальним faster-whisper або Regolo, залежно від
    `asr.provider`. Повертає {"text": ...}.
    """
    await _require_user(request)
    provider, backend = _asr_backend()
    if not backend.is_available():
        return JSONResponse(status_code=503, content={"error": "ASR недоступний"})
    data = await audio.read(cfg.REGOLO_ASR_MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="Порожнє аудіо")
    if len(data) > cfg.REGOLO_ASR_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Аудіо завелике")
    try:
        if provider == "whisper_local":
            text = await asyncio.to_thread(
                asr_whisper.transcribe,
                data,
                Path(audio.filename or "voice.webm").suffix or ".webm",
            )
        else:
            text = await asr_regolo.transcribe(
                data,
                audio.filename or "voice.webm",
                audio.content_type,
            )
    except Exception as exc:  # noqa: BLE001 — розпізнавання не має валити сервер
        log.warning("ASR (%s) не впорався (%s)", provider, type(exc).__name__)
        return JSONResponse(status_code=503, content={"error": "ASR помилка"})
    log.info("ASR (%s): %s", provider, (text or "")[:80])
    return {"text": text}


@app.get("/api/console")
def api_console() -> dict:
    """Останні рядки консолі (історія для початкового завантаження панелі)."""
    return {"logs": events.recent_logs()}


@app.get("/api/events")
async def api_events() -> StreamingResponse:
    """
    SSE-стрічка живих подій бота (нативний EventSource, без CDN):
    emotion / say / vision за спільним контрактом; keep-alive ~15 с.
    """
    return _SSEResponse(
        events.sse_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )


# ------------------------------------------------------------------ тулзи публічних API

@app.get("/api/tools")
def api_tools_list() -> dict:
    """Список доступних тулзів із JSON-схемами для LLM."""
    return {"tools": tools.list_tools()}


class ToolCallRequest(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    args: dict[str, Any] = Field(default_factory=dict)
    session_id: str = Field(default="", max_length=64)


# Ці тули публікують власну SSE-подію "ui" (картка question/todo/choice) —
# генеричний рядок "tool" для них зайвий, див. api_tools_call нижче.
_UI_TOOL_NAMES = {"ask_question", "todo_list", "show_choice"}


def _tool_detail(args: dict) -> str:
    """Найінформативніший аргумент виклику — те, що показуємо в панелі."""
    for key in ("query", "city", "path", "base"):
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


@app.post("/api/tools/call")
async def api_tools_call(request: Request, req: ToolCallRequest) -> dict:
    """
    Синхронний виклик одного тулзу. Через цей же ендпоінт ходить зовнішній
    мозок (OpenClaw → tools_mcp/workspace_mcp), тому шлемо SSE-події: інакше
    в панелі не було б видно, що бот саме зараз щось шукає чи пише у файл.
    """
    clerk_uid = await _require_user(request)
    detail = _tool_detail(req.args)
    # ask_question/todo_list/show_choice малюють себе самі карткою (подія
    # "ui" — публікує сам тул), тому дублювати їх згорнутим рядком не треба.
    show_generic = req.name not in _UI_TOOL_NAMES
    if show_generic:
        try:
            events.publish_tool(req.name, detail, "start")
        except Exception:  # noqa: BLE001 — індикація не має валити виклик тулзу
            log.exception("Не вдалося опублікувати подію початку тулзу")

    # Частина тулзів працює з памʼяттю, тому навіть загальний API-виклик не має
    # права впасти назад у спільний шаблон brain/.
    with _brain_context(req.session_id, clerk_uid):
        result = await tools.execute_tool(req.name, req.args)

    if show_generic:
        try:
            events.publish_tool(req.name, detail, "done")
        except Exception:  # noqa: BLE001
            log.exception("Не вдалося опублікувати подію завершення тулзу")
    return {"tool": req.name, "args": req.args, "result": result}


# ------------------------------------------------------------------ зір

@app.get("/api/vision/snapshot")
async def api_vision_snapshot():
    """Проксі JSON-снапшота з Vision Agent; 503 якщо Vision офлайн."""
    try:
        # Vision — локальний сервіс: проксі оточення/системи не використовуємо
        async with httpx.AsyncClient(timeout=8.0, trust_env=cfg.httpx_trust_env(cfg.VISION_BASE_URL)) as client:
            resp = await client.get(f"{cfg.VISION_BASE_URL}/vision/snapshot")
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=503,
            content={"error": f"Vision Agent недоступний ({type(exc).__name__}). "
                              "Запустіть його у вкладці «Сервіси»."},
        )
    if resp.status_code != 200:
        # Vision живий, але сам повернув помилку (наприклад, ще нема кадру) —
        # віддаємо його JSON як є, щоб фронтенд бачив причину
        try:
            detail = resp.json()
        except ValueError:
            detail = {"error": f"Vision Agent відповів помилкою HTTP {resp.status_code}"}
        if not isinstance(detail, dict) or "error" not in detail:
            detail = {"error": str(detail.get("detail", detail) if isinstance(detail, dict) else detail)}
        return JSONResponse(status_code=503, content=detail)
    try:
        return resp.json()
    except ValueError:
        return JSONResponse(status_code=503, content={"error": "Vision Agent повернув не-JSON відповідь"})


# ------------------------------------------------------------------ памʼять

@app.get("/api/memory/list")
async def api_memory_list(request: Request, session_id: str = Query(default="", max_length=64)) -> dict:
    """Список markdown-нотаток у brain/ поточної сесії."""
    clerk_uid = await _require_user(request)
    with _brain_context(session_id, clerk_uid):
        return {"files": memory.list_notes()}


@app.get("/api/memory/file")
async def api_memory_file(
    request: Request,
    path: str = Query(min_length=1, max_length=300),
    session_id: str = Query(default="", max_length=64),
) -> dict:
    """Вміст однієї нотатки (шлях відносно brain/, з валідацією)."""
    clerk_uid = await _require_user(request)
    with _brain_context(session_id, clerk_uid):
        try:
            content = memory.read_note(path)
        except memory.BrainPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="Нотатку не знайдено") from exc
    return {"path": path, "content": content}


@app.post("/api/memory/save")
async def api_memory_save(req: MemorySaveRequest, request: Request) -> dict:
    """Зберігає нотатку в brain/ (тільки .md, без виходу за межі папки)."""
    clerk_uid = await _require_user(request)
    with _brain_context(req.session_id, clerk_uid):
        try:
            memory.save_note(req.path, req.content)
        except memory.BrainPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Не вдалося зберегти: {exc}") from exc
    return {"ok": True, "path": req.path}


@app.post("/api/brain/directory")
async def api_brain_directory(req: BrainDirectoryRequest, request: Request) -> dict:
    """Create a brain-only directory; this is the bot-safe filesystem hook."""
    clerk_uid = await _require_user(request)
    with _brain_context(req.session_id, clerk_uid):
        try:
            path = memory.create_brain_directory(req.path)
        except memory.BrainPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Не вдалося створити папку: {exc}") from exc
    return {"ok": True, "path": path}


@app.post("/api/brain/file")
async def api_brain_file(req: BrainFileRequest, request: Request) -> dict:
    """Create an atomic .md/.txt brain file (Claude Bot tool/API integration)."""
    clerk_uid = await _require_user(request)
    with _brain_context(req.session_id, clerk_uid):
        try:
            path = memory.create_brain_file(req.path, req.content, overwrite=req.overwrite)
        except memory.BrainPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileExistsError as exc:
            raise HTTPException(status_code=409, detail="Файл уже існує; вкажіть overwrite=true") from exc
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Не вдалося створити файл: {exc}") from exc
    return {"ok": True, "path": path}


@app.post("/api/brain/navigation")
async def api_brain_navigation(request: Request, session_id: str = Query(default="", max_length=64)) -> dict:
    """Regenerate brain/_navigation.md for the current session brain."""
    clerk_uid = await _require_user(request)
    with _brain_context(session_id, clerk_uid):
        try:
            memory.regenerate_brain_navigation()
        except OSError as exc:
            raise HTTPException(status_code=500, detail=f"Не вдалося оновити навігацію: {exc}") from exc
    return {"ok": True, "path": "_navigation.md"}


# ------------------------------------------------------------------ сервіси

def _service_spec_or_404(name: str) -> None:
    if name not in services_manager.SERVICES:
        raise HTTPException(status_code=404, detail=f"Невідомий сервіс: {name}")


@app.get("/api/services")
def api_services() -> dict:
    """Статуси керованих сервісів (Vision, Display)."""
    return services_manager.get_all_statuses()


@app.post("/api/services/{name}/start")
def api_service_start(name: str) -> dict:
    """Запускає сервіс (ідемпотентно: повторний start не плодить процеси)."""
    _service_spec_or_404(name)
    return services_manager.start_service(name)


@app.post("/api/services/{name}/stop")
def api_service_stop(name: str) -> dict:
    """Зупиняє сервіс, якщо його запустили ми; чужі процеси не чіпає."""
    _service_spec_or_404(name)
    return services_manager.stop_service(name)


# ------------------------------------------------------------------ робоча тека бота

class WorkspacePathRequest(BaseModel):
    path: str = Field(default="", max_length=1024)
    session_id: str = Field(default="", max_length=64)


class WorkspaceWriteRequest(WorkspacePathRequest):
    content: str = Field(default="", max_length=workspace.MAX_WRITE_BYTES)
    append: bool = False


class WorkspaceRenameRequest(WorkspacePathRequest):
    new_name: str = Field(min_length=1, max_length=255)


# Ім'я функції workspace → назва тулзу для індикації в панелі
_WORKSPACE_TOOL_NAMES = {
    "list_dir": "workspace_list",
    "read_file": "workspace_read",
    "write_file": "workspace_write",
    "make_dir": "workspace_mkdir",
    "delete": "workspace_delete",
    "rename": "workspace_rename",
    "info": "workspace_info",
}


def _workspace_call(session_id: str, fn, *args, **kwargs):
    """
    Спільна обгортка: активна сесія + переклад помилок у HTTP-коди.

    Заразом шле SSE-подію про тул: цими ж ендпоінтами ходить зовнішній мозок
    (OpenClaw → workspace_mcp), і без події в панелі не було б видно, що бот
    щойно щось записав у свою теку.
    """
    tool = _WORKSPACE_TOOL_NAMES.get(getattr(fn, "__name__", ""), "workspace")
    detail = next((a for a in args if isinstance(a, str) and a.strip()), "")
    try:
        events.publish_tool(tool, detail, "start")
    except Exception:  # noqa: BLE001 — індикація не має валити операцію
        log.exception("Не вдалося опублікувати подію тулзу робочої теки")
    try:
        with workspace.set_session(session_id):
            result = fn(*args, **kwargs)
            try:
                events.publish_tool(tool, detail, "done")
            except Exception:  # noqa: BLE001
                log.exception("Не вдалося опублікувати завершення тулзу робочої теки")
            return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except (ValueError, FileExistsError, NotADirectoryError, IsADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Помилка файлової системи: {type(exc).__name__}")


@app.get("/api/workspace/info")
async def api_workspace_info(request: Request, session_id: str = Query(default="", max_length=64)) -> dict:
    """Де тека лежить на диску, які розділи, яка тека в цієї сесії."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(session_id, workspace.info)


@app.get("/api/workspace/list")
async def api_workspace_list(
    request: Request,
    path: str = Query(default="", max_length=1024),
    session_id: str = Query(default="", max_length=64),
) -> dict:
    """Вміст однієї теки (дерево вантажиться лінькувато, по кліку)."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(session_id, workspace.list_dir, path)


@app.get("/api/workspace/file")
async def api_workspace_file(
    request: Request,
    path: str = Query(min_length=1, max_length=1024),
    session_id: str = Query(default="", max_length=64),
) -> dict:
    """Вміст файлу для вбудованого редактора."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(session_id, workspace.read_file, path)


@app.post("/api/workspace/file")
async def api_workspace_save(req: WorkspaceWriteRequest, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, workspace.write_file, req.path, req.content, append=req.append)


@app.post("/api/workspace/mkdir")
async def api_workspace_mkdir(req: WorkspacePathRequest, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, workspace.make_dir, req.path)


@app.post("/api/workspace/delete")
async def api_workspace_delete(req: WorkspacePathRequest, request: Request) -> dict:
    """Видалення = переїзд у .trash/, назавжди нічого не стирається."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, workspace.delete, req.path)


class WorkspaceSaveUrlRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    session_id: str = Field(default="", max_length=64)
    # За замовчуванням — бібліотека сесії; якщо чат привʼязаний до проєкту,
    # фронтенд шле сюди "projects/<slug>/library" — тому суворо звіряємо
    # форму рядка, а не даємо довільний шлях із клієнта.
    subdir: str = Field(default="session/library", max_length=120)


_PROJECT_LIBRARY_RE = re.compile(r"^projects/[A-Za-z0-9_-]{1,50}/library$")


@app.post("/api/workspace/save-url")
async def api_workspace_save_url(req: WorkspaceSaveUrlRequest, request: Request) -> dict:
    """Зберігає картинку з чату в бібліотеку сесії або проєкту (кнопка в каруселі)."""
    clerk_uid = await _require_user(request)
    subdir = req.subdir.strip() or "session/library"
    if subdir != "session/library" and not _PROJECT_LIBRARY_RE.match(subdir):
        raise HTTPException(status_code=400, detail="Некоректна бібліотека")
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, workspace.save_url, req.url, subdir)


@app.post("/api/workspace/show")
async def api_workspace_show(req: WorkspacePathRequest, request: Request) -> dict:
    """Бот просить показати файл — панель відкриє його у великому прев'ю."""
    clerk_uid = await _require_user(request)

    def _show(path: str) -> dict:
        resolved = workspace._resolve(path, must_exist=True)
        rel = workspace.rel_path(resolved)
        events.publish_preview(rel)
        return {"ok": True, "shown": rel}

    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, _show, req.path)


@app.post("/api/workspace/rename")
async def api_workspace_rename(req: WorkspaceRenameRequest, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _workspace_call(req.session_id, workspace.rename, req.path, req.new_name)


# ------------------------------------------------------------------ проєкти

class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=projects.MAX_NAME)


class ProjectRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=projects.MAX_NAME)


def _project_call(fn, *args, **kwargs):
    """Та сама обгортка помилок, що й у _workspace_call, без SSE-подій —
    проєктами керує людина в панелі, це не тул бота."""
    try:
        return fn(*args, **kwargs)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Помилка файлової системи: {type(exc).__name__}")


# ---------------------------------------------------------------- кодинг-режим
#
# Код пише omp (oh-my-pi), а не мозок чату: у нього власний цикл інструментів,
# хеш-якірний edit і LSP. Ми лише даємо йому теку коду й перекладаємо його
# події у ТУ САМУ мову SSE, якою вже говорить /api/chat — тому фронтенду
# достатньо змінити адресу запиту, а не логіку рендеру.
#
# Ключ сесії — користувач + проєкт: у кожного проєкту свій живий omp, і
# чужий користувач не може дістатись до чужого процесу.


class CodeChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    session_id: str = Field(default="", max_length=64)
    project: str = Field(default="", max_length=64)


def _code_session_key(clerk_uid: str, session_id: str) -> str:
    """
    Ключ живого процесу omp — користувач + КОНКРЕТНА розмова.

    Не проєкт: два кодингові чати про один проєкт мають різні задачі й різний
    контекст, і склеювати їх в один процес означало б, що omp тягне в другу
    розмову все, що напрацював у першій.
    """
    return f"{clerk_uid}::{session_id}"


def _code_cwd(project: str) -> str:
    """Тека, яку отримає omp. Порожній проєкт — корінь code/ користувача."""
    base = workspace.code_root()
    slug = (project or "").strip()
    if not slug:
        return str(base)
    if not projects.exists(slug):
        raise HTTPException(status_code=404, detail="Немає такого проєкту")
    return str(base / slug)


def _code_title(message: str) -> str:
    """
    Назва кодингового чату — з першого повідомлення, без виклику моделі.

    У звичайному чаті назву генерує мозок, але кодинг-режим працює на моделі
    для КОДУ: витрачати її виклик на вигадування заголовка безглуздо, та й
    задача тут і так формулюється як назва («додай темну тему»).
    """
    return chat_store.make_title(message)


@app.get("/api/code/status")
async def api_code_status(request: Request):
    """Чи доступний кодинг-режим (фронт вирішує, чи показувати перемикач)."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        root = str(workspace.code_root())
    return {
        "available": coding.is_available(),
        # Модель, якою кодинг працює ЗАРАЗ (вибір у панелі, не лише конфіг).
        "model": coding.get_selected_model(),
        # Кований список для пікера: без нього панель показувала модель
        # текстом, і змінити її з інтерфейсу не було чим.
        "models": coding.available_models(),
        "default_model": cfg.CODING_MODEL,
        "profile": cfg.CODING_PROFILE,
        # Реальна тека на диску: панель показує її у підказці, щоб було видно,
        # КУДИ саме пише агент, а не лише як називається проєкт.
        "root": root,
    }


@app.post("/api/code/stop")
async def api_code_stop(request: Request, req: CodeChatRequest):
    """Зупиняє процес omp цієї розмови (історія на диску лишається)."""
    clerk_uid = await _require_user(request)
    sid = (req.session_id or "").strip()
    stopped = await coding.stop_session(_code_session_key(clerk_uid, sid))
    return {"ok": True, "stopped": stopped}


@app.post("/api/code/chat")
async def api_code_chat(request: Request, req: CodeChatRequest):
    """Задача для omp; відповідь — SSE тим самим контрактом, що й /api/chat."""
    clerk_uid = await _require_user(request)
    if not coding.is_available():
        raise HTTPException(status_code=503, detail="omp не встановлено — кодинг-режим недоступний")
    message = req.message.strip()
    sid = (req.session_id or "").strip() or uuid.uuid4().hex[:16]
    if not chat_store.is_valid_id(sid):
        raise HTTPException(status_code=400, detail="Некоректний id сесії")

    with _brain_context(sid, clerk_uid):
        cwd = _code_cwd(req.project)
    key = _code_session_key(clerk_uid, sid)
    log.info("→ Кодинг: user=%s проєкт=%s %s", clerk_uid[:8], req.project or "(корінь)", message[:120])

    async def stream_response():
        # Контекст перевстановлюємо ВСЕРЕДИНІ генератора (ContextVar у нього не
        # успадковується), і одразу перемикаємо простір розмов на кодинговий —
        # інакше задача лягла б у список звичайних чатів.
        with _brain_context(sid, clerk_uid), chat_store.set_kind(chat_store.KIND_CODE):
            queue: asyncio.Queue[dict] = asyncio.Queue()

            async def emit(event: dict) -> None:
                await queue.put(event)

            try:
                session = await coding.get_session(key, cwd)
            except coding.CodingError as exc:
                yield f"event: error\ndata: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n"
                return

            task = asyncio.create_task(session.prompt(message, emit))
            try:
                while not task.done() or not queue.empty():
                    try:
                        event = await asyncio.wait_for(queue.get(), timeout=0.1)
                        yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                    except asyncio.TimeoutError:
                        if task.done():
                            break
                        continue

                result = task.result()
                reply = result["reply"] or "(без тексту)"
                steps = result["steps"]

                # Розмова має пережити перезавантаження сторінки так само, як
                # звичайний чат — інакше «режим» був би просто вікном у нікуди.
                try:
                    chat_store.append(sid, message, reply, steps)
                    if chat_store.needs_title(sid):
                        chat_store.set_title(sid, _code_title(message))
                        chat_store.mark_titled(sid)
                    if req.project:
                        chat_store.set_project(sid, req.project)
                except Exception:  # noqa: BLE001 — збереження не валить відповідь
                    log.exception("Не вдалося зберегти кодингову розмову")

                done = {
                    "reply": reply,
                    "emotion": "working",
                    # Модель ВИБРАНА, а не типова з конфіга: інакше панель
                    # писала б одне, а код писала інша модель.
                    "mode": f"omp · {coding.get_selected_model()}",
                    "model": coding.get_selected_model(),
                    "session_id": sid,
                    "tool_results": [],
                    "files": result["files"],
                    "steps": steps,
                }
                yield f"event: done\ndata: {json.dumps(done, ensure_ascii=False)}\n\n"
            except coding.CodingError as exc:
                yield f"event: error\ndata: {json.dumps({'error': str(exc)}, ensure_ascii=False)}\n\n"
            except Exception:  # noqa: BLE001 — деталь у лог, користувачу коротко
                log.exception("Кодинг-сесія впала")
                yield f"event: error\ndata: {json.dumps({'error': 'Кодинг-сесія впала'})}\n\n"
            finally:
                if not task.done():
                    task.cancel()

    return StreamingResponse(stream_response(), media_type="text/event-stream")


@app.get("/api/projects")
async def api_projects_list(request: Request) -> dict:
    """Проєкти — папка, яка завжди зверху списку чатів, найактивніші першими."""
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return {"projects": _project_call(projects.list_projects)}


@app.post("/api/projects")
async def api_projects_create(req: ProjectCreateRequest, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _project_call(projects.create_project, req.name)


@app.post("/api/projects/{slug}/rename")
async def api_projects_rename(slug: str, req: ProjectRenameRequest, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        return _project_call(projects.rename_project, slug, req.name)


@app.delete("/api/projects/{slug}")
async def api_projects_delete(slug: str, request: Request) -> dict:
    clerk_uid = await _require_user(request)
    with brain_context.set_clerk_user(clerk_uid):
        result = _project_call(projects.delete_project, slug)
        # Чати, які були привʼязані до цього проєкту, лишаються — просто більше
    # не показуються під ним (проєкт трохи «пожив» у .trash/, а не зник миттю).
        chat_store.clear_project(slug)
        return result


# ------------------------------------------------------------------ вбудований браузер

@app.get("/api/browser/page", include_in_schema=False)
async def api_browser_page(url: str = Query(min_length=1, max_length=2048)):
    """
    Сторінка для <iframe> вбудованого браузера. Сторінку тягне сервер, бо
    напряму більшість сайтів вбудовуватись забороняє (X-Frame-Options/CSP).
    """
    try:
        # Не адреса, а запит → малюємо власну сторінку результатів
        # (пошуковики віддають проксі капчу, а не видачу).
        if not web_browser.looks_like_url(url):
            return HTMLResponse(await web_browser.search_page(url))
        page = await web_browser.load(url)
    except web_browser.BrowserError as exc:
        return HTMLResponse(
            f"<!doctype html><meta charset='utf-8'>"
            f"<body style=\"font:14px -apple-system,sans-serif;padding:24px;color:#2B2A26\">"
            f"<b>Не вдалося відкрити</b><br>{html_escape(str(exc))}</body>",
            status_code=200,
        )

    if page["kind"] == "html":
        return HTMLResponse(
            page["html"],
            headers={
                "X-Claudebot-Url": quote(page["url"], safe=""),
                "X-Claudebot-Title": quote(page.get("title") or "", safe=""),
            },
        )
    return Response(content=page["content"], media_type=page["content_type"])


# ------------------------------------------------------------------ прев'ю того, що зробив бот

_PREVIEW_TYPES = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
}


@app.get("/preview/{file_path:path}", include_in_schema=False)
def serve_workspace_preview(file_path: str, session_id: str = Query(default="", max_length=64)):
    """
    Віддає файл із робочої теки, щоб сайт, який щойно зробив бот, можна було
    відкрити прямо в панелі — а не «клацни двічі у Finder». Шлях перевіряє
    workspace._resolve, тож вийти за корінь теки неможливо.
    """
    try:
        with workspace.set_session(session_id):
            target = workspace._resolve(file_path, must_exist=True)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Немає такого файлу")
    if target.is_dir():
        index = target / "index.html"
        if not index.is_file():
            raise HTTPException(status_code=404, detail="У теці немає index.html")
        target = index
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Немає такого файлу")
    media = _PREVIEW_TYPES.get(target.suffix.lower(), "application/octet-stream")
    return FileResponse(target, media_type=media)


def _markdown_to_html(text: str) -> str:
    """
    Мінімальний markdown → HTML для сторінки файлу.

    Повноцінний парсер тут зайвий: нотатки бота — це заголовки, списки, код і
    посилання. Усе, що не розпізнали, лишається екранованим текстом, тож
    вставити розмітку через файл неможливо.
    """
    out: list[str] = []
    in_code = False
    in_list = False
    for raw in text.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            out.append("</pre>" if in_code else "<pre>")
            in_code = not in_code
            continue
        if in_code:
            out.append(html_escape(line))
            continue
        if not line.strip():
            if in_list:
                out.append("</ul>")
                in_list = False
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            if in_list:
                out.append("</ul>")
                in_list = False
            level = len(heading.group(1))
            out.append(f"<h{level}>{_md_inline(heading.group(2))}</h{level}>")
            continue
        bullet = re.match(r"^\s*[-*+]\s+(.*)$", line)
        if bullet:
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{_md_inline(bullet.group(1))}</li>")
            continue
        if in_list:
            out.append("</ul>")
            in_list = False
        out.append(f"<p>{_md_inline(line)}</p>")
    if in_list:
        out.append("</ul>")
    if in_code:
        out.append("</pre>")
    return "\n".join(out)


def _md_inline(text: str) -> str:
    """Жирний/курсив/код/посилання всередині рядка — після екранування."""
    safe = html_escape(text)
    safe = re.sub(r"`([^`]+)`", r"<code>\1</code>", safe)
    safe = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", safe)
    safe = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", safe)
    safe = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r'<a href="\2" target="_blank" rel="noreferrer">\1</a>',
        safe,
    )
    return safe


_FILE_PAGE_CSS = """
  :root { color-scheme: light; }
  body { margin: 0; padding: 40px 24px; background: #F0EEE6;
         font: 16px/1.65 -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif;
         color: #2B2A26; }
  main { max-width: 780px; margin: 0 auto; background: #FBFAF7; border: 1px solid #E4E1D6;
         border-radius: 18px; padding: 36px 40px; box-shadow: 0 8px 28px rgba(43,42,38,.06); }
  h1, h2, h3 { line-height: 1.25; margin: 1.4em 0 .5em; }
  h1:first-child { margin-top: 0; }
  a { color: #C96442; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em;
         background: #E9E7DD; padding: 2px 5px; border-radius: 4px; }
  pre { background: #E9E7DD; padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 0 0 1em; padding-left: 14px; border-left: 3px solid #C96442; color: #83817A; }
  img { max-width: 100%; border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #E4E1D6; padding: 8px 10px; text-align: left; }
  th { background: #E9E7DD; }
  .path { max-width: 780px; margin: 0 auto 10px; font-size: 12px; color: #83817A;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
"""


@app.get("/file/{file_path:path}", include_in_schema=False)
def serve_workspace_file_page(file_path: str, session_id: str = Query(default="", max_length=64)):
    """
    Сторінка файлу «через нас»: markdown і текст показуємо оформленою
    сторінкою, а не сирим завантаженням, як робив /preview. Саме сюди веде
    «відкрити в новому вікні» — щоб нотатка виглядала нотаткою.
    """
    try:
        with workspace.set_session(session_id):
            target = workspace._resolve(file_path, must_exist=True)
            rel = workspace.rel_path(target)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Немає такого файлу")

    suffix = target.suffix.lower()
    # Сайти, картинки й решта — це вже вміє /preview, дублювати не треба
    if suffix not in {".md", ".markdown", ".txt", ""}:
        return RedirectResponse(url=f"/preview/{quote(rel)}")

    try:
        text = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        raise HTTPException(status_code=415, detail="Файл не текстовий")

    # Рендер markdown робить сам браузер (marked з CDN тут недоступний), тож
    # віддаємо вміст у <script type="text/markdown"> і мінімальний конвертер
    # не тягнемо: для .md показуємо моноширинно з тим самим оформленням.
    body = f"<pre>{html_escape(text)}</pre>" if suffix in {".txt", ""} else _markdown_to_html(text)
    return HTMLResponse(
        f"<!doctype html><html lang='uk'><head><meta charset='utf-8'>"
        f"<meta name='viewport' content='width=device-width, initial-scale=1'>"
        f"<title>{html_escape(rel)}</title><style>{_FILE_PAGE_CSS}</style></head>"
        f"<body><div class='path'>{html_escape(rel)}</div><main>{body}</main></body></html>"
    )


# ------------------------------------------------------------------ роздача завантажених файлів
# Має бути ДО catch-all статики, інакше `/{asset_path:path}` перехопить /uploads/...

@app.get("/uploads/{file_path:path}", include_in_schema=False)
def serve_upload(file_path: str):
    """Віддає файли, завантажені через /api/chat/upload."""
    if not cfg.UPLOADS_DIR.is_dir():
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    try:
        target = (cfg.UPLOADS_DIR / file_path).resolve()
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    root_resolved = cfg.UPLOADS_DIR.resolve()
    if not (target == root_resolved or target.is_relative_to(root_resolved)):
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    return FileResponse(target)


# ------------------------------------------------------------------ статика
# ВАЖЛИВО: ці маршрути оголошені ОСТАННІМИ, щоб не перекривати /api/*.
# static/ робить інший агент — якщо папки ще нема, показуємо заглушку і не падаємо.

_PLACEHOLDER_HTML = """<!-- Заглушка, поки фронтенд не зібрано -->
<h1>Клод Бот — Virtual Bot</h1>
<p>Бекенд працює, але папки <code>static/</code> з фронтендом ще нема.</p>
<p>API живе тут: <a href="/api/status">/api/status</a>, <a href="/docs">/docs</a></p>
"""

# Статику віддаємо з no-cache: браузер щоразу РЕВАЛІДУЄ файл (через ETag/
# Last-Modified від FileResponse → 304, якщо не змінився). Без цього браузер
# евристично кешує JS/CSS і не підхоплює правок фронтенду без hard-refresh.
_STATIC_HEADERS = {"Cache-Control": "no-cache"}


def _resolve_static(asset_path: str):
    """Безпечно розвʼязує шлях у static/ (без traversal); None якщо нема файлу."""
    static_root = cfg.STATIC_DIR
    if not static_root.is_dir():
        return None
    try:
        target = (static_root / asset_path).resolve()
    except (OSError, ValueError):
        return None
    root_resolved = static_root.resolve()
    if not (target == root_resolved or target.is_relative_to(root_resolved)):
        return None
    if target.is_dir():
        target = target / "index.html"
    return target if target.is_file() else None


@app.get("/", include_in_schema=False)
def index():
    """Головна сторінка панелі: static/index.html або заглушка."""
    target = _resolve_static("index.html")
    if target is not None:
        return FileResponse(target, headers=_STATIC_HEADERS)
    return HTMLResponse(_PLACEHOLDER_HTML, status_code=200)


@app.get("/{asset_path:path}", include_in_schema=False)
def static_asset(asset_path: str):
    """
    Роздача файлів фронтенду. Працює і для /app.js, і для /static/app.js
    (на випадок різних узгоджень шляхів у фронтенд-агента).
    """
    if asset_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Невідомий API-шлях")
    if asset_path.startswith("static/"):
        asset_path = asset_path[len("static/"):]
    target = _resolve_static(asset_path)
    if target is None:
        raise HTTPException(status_code=404, detail="Файл не знайдено")
    return FileResponse(target, headers=_STATIC_HEADERS)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=str(cfg.cfg("server", "host", default="127.0.0.1")),
        port=int(cfg.cfg("server", "port", default=8100)),
        # Відкриті SSE-стріми (/api/events) нескінченні — без цього ліміту
        # graceful shutdown чекав би на них вічно
        timeout_graceful_shutdown=3,
    )
