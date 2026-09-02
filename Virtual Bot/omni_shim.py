"""
«Клод Бот» — Omni-шим: OpenAI-сумісний роутер поверх opencode.

ЗАЧИМ ЦЕ ІСНУЄ
--------------
`config.yaml` бота очікує Omni-роутер на 127.0.0.1:20128/v1 з моделями
виду `opencode-go/kimi-k3`. Того роутера на машині немає, тому мозок падав
по ланцюжку до демо-режиму. Водночас CLI `opencode` має авторизований
провайдер OpenCode Go з тими самими моделями — але його HTTP-API сесійне
(`POST /session` → `POST /session/{id}/message`), а не OpenAI-сумісне.

Шим закриває саме цей розрив: він говорить OpenAI-мовою назовні й
сесійною — усередину. Бот при цьому не змінюється жодним рядком.

ОКРЕМА БАЗА
-----------
Особиста база opencode користувача (~1.5 ГБ) відстала від бінарника на
кілька міграцій: `no such column: replacement_seq`, далі `revision`. Тому
шим тримає ВЛАСНУ базу opencode і лише симлінкує auth.json — ключі
лишаються в одному місці, а історія користувача не чіпається й не
змішується з ботовою.

Шлях бази — без пробілів НАВМИСНО: opencode ламається на XDG_DATA_HOME
із пробілом (а проєкт живе в «claude bot/Virtual Bot»).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Optional, Union

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Імпорт заради двох речей: .env підвантажується самим app_config (start_brain.sh
# його НЕ читає) і звідти ж беремо ключ Regolo для прямого провайдера нижче.
import app_config as cfg

log = logging.getLogger("omni_shim")

PORT = int(os.environ.get("OMNI_SHIM_PORT", "20128"))
OPENCODE_PORT = int(os.environ.get("OMNI_SHIM_OPENCODE_PORT", "20131"))
OPENCODE_URL = f"http://127.0.0.1:{OPENCODE_PORT}"

# Без пробілів у шляху — див. коментар у шапці модуля.
DATA_HOME = Path(os.environ.get("OMNI_SHIM_DATA", str(Path.home() / ".local/share/claude-bot-brain")))
REAL_AUTH = Path.home() / ".local/share/opencode/auth.json"

# Скільки чекати на відповідь моделі. opencode-go відповідає за 3–10с,
# але великі задачі бувають довшими.
REPLY_TIMEOUT_S = float(os.environ.get("OMNI_SHIM_TIMEOUT_S", "180"))

# --- прямий провайдер `regolo` (повз opencode) -------------------------------
# opencode про Regolo не знає, а нам звідти потрібні ШВИДКІ моделі: gpt-oss-20b
# відповідає за ~0.9с проти ~5с у будь-якої моделі через сесійне API opencode
# (там на кожен запит створюється сесія й крутиться власний агентний цикл).
# Regolo говорить чистою OpenAI-мовою, тож проксі тут — прямий і короткий.
# Ключ той самий, що й для ASR: env REGOLO_ASR_API_KEY (один акаунт Regolo).
REGOLO_PROVIDER = "regolo"
REGOLO_BASE_URL = os.environ.get("REGOLO_BASE_URL", "https://api.regolo.ai/v1").rstrip("/")
# Лише текстові моделі — картинок вони не приймають (див. _ask_regolo).
REGOLO_MODELS = ("gpt-oss-20b", "gpt-oss-120b")
REGOLO_TIMEOUT_S = float(os.environ.get("OMNI_SHIM_REGOLO_TIMEOUT_S", "60"))

app = FastAPI(title="Omni shim (opencode)", docs_url=None, redoc_url=None)

_proc: Optional[subprocess.Popen] = None


# ---------------------------------------------------------------- запуск opencode

def _prepare_data_home() -> None:
    """Своя тека даних opencode із симлінком на справжні ключі."""
    (DATA_HOME / "opencode").mkdir(parents=True, exist_ok=True)
    (DATA_HOME / "work").mkdir(parents=True, exist_ok=True)
    link = DATA_HOME / "opencode" / "auth.json"
    if not link.exists() and REAL_AUTH.exists():
        # Симлінк, а не копія: ключі лишаються в одному місці, і повторна
        # авторизація в opencode одразу діє і тут.
        link.symlink_to(REAL_AUTH)


async def _opencode_alive(client: httpx.AsyncClient) -> bool:
    try:
        r = await client.get(f"{OPENCODE_URL}/config/providers", timeout=4)
        return r.status_code == 200
    except Exception:  # noqa: BLE001 — будь-яка мережева невдача = не живий
        return False


async def _ensure_opencode() -> None:
    """Піднімає `opencode serve`, якщо його ще немає. Ідемпотентно."""
    global _proc
    async with httpx.AsyncClient() as client:
        if await _opencode_alive(client):
            return
        _prepare_data_home()
        env = {**os.environ, "XDG_DATA_HOME": str(DATA_HOME)}
        log.info("Піднімаю opencode serve на %s (база: %s)", OPENCODE_PORT, DATA_HOME)
        _proc = subprocess.Popen(
            ["opencode", "serve", "--port", str(OPENCODE_PORT), "--hostname", "127.0.0.1"],
            cwd=str(DATA_HOME / "work"),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for _ in range(40):
            await asyncio.sleep(0.5)
            if await _opencode_alive(client):
                log.info("opencode serve готовий")
                return
        raise RuntimeError("opencode serve не піднявся за 20с")


@app.on_event("startup")
async def _startup() -> None:
    try:
        await _ensure_opencode()
    except Exception as exc:  # noqa: BLE001 — шим має піднятися й повідомити 503
        log.error("opencode недоступний: %s", exc)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _proc and _proc.poll() is None:
        _proc.terminate()


# ---------------------------------------------------------------- моделі

@app.get("/v1/models")
async def models() -> dict:
    """Список у форматі OpenAI: id = «провайдер/модель», як чекає config.yaml."""
    await _ensure_opencode()
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{OPENCODE_URL}/config/providers", timeout=15)
        r.raise_for_status()
        payload = r.json()

    now = int(time.time())
    out: list[dict] = []
    for prov in payload.get("providers", []):
        pid = prov.get("id")
        if not pid:
            continue
        raw = prov.get("models") or {}
        ids = raw.keys() if isinstance(raw, dict) else [m.get("id") for m in raw]
        for mid in ids:
            if mid:
                out.append({"id": f"{pid}/{mid}", "object": "model", "created": now, "owned_by": pid})

    # Regolo йде повз opencode, тому в його списку провайдерів не значиться —
    # дописуємо самі, і лише коли ключ реально є (мертвий пункт у списку
    # гірший за його відсутність).
    if cfg.get_regolo_asr_key():
        for mid in REGOLO_MODELS:
            out.append({
                "id": f"{REGOLO_PROVIDER}/{mid}", "object": "model",
                "created": now, "owned_by": REGOLO_PROVIDER,
            })
    return {"object": "list", "data": out}


# ---------------------------------------------------------------- чат

class Msg(BaseModel):
    role: str
    # Vision-запити приходять списком частин — тоді беремо лише текст.
    # Синтаксис через typing, а не «str | list»: venv на Python 3.9, і
    # pydantic обчислює анотації полів у рантаймі (from __future__ не
    # допомагає саме тут).
    content: Optional[Union[str, list]] = None


class ChatReq(BaseModel):
    model: str
    messages: list[Msg]
    stream: bool = False
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    # Решту полів OpenAI приймаємо й ігноруємо: opencode ними не керує.
    model_config = {"extra": "ignore"}


def _text_of(content) -> str:
    """Текст повідомлення. Частини-картинки тут не змішуємо з текстом:
    вони їдуть окремими file-частинами opencode (див. _file_parts_of)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            str(p.get("text", "")) for p in content
            if isinstance(p, dict) and p.get("type") == "text"
        )
    return ""


def _file_parts_of(content) -> list[dict]:
    """
    OpenAI-стиль image_url → file-частини сесійного API opencode.

    Бот шле картинки data:-URL (base64), і саме їх opencode вміє віддати
    моделі як вкладення. Сторонні http(s)-посилання свідомо пропускаємо:
    качати чуже за роутер — не робота шима. Без цієї конвертації картинки
    мовчки губились, і текстова модель «чесно» відповідала «не бачу».
    """
    parts: list[dict] = []
    if not isinstance(content, list):
        return parts
    for p in content:
        if not (isinstance(p, dict) and p.get("type") == "image_url"):
            continue
        url = str((p.get("image_url") or {}).get("url") or "").strip()
        if not url.startswith("data:"):
            continue
        head = url[5:url.find(",")] if "," in url else ""
        mime = head.split(";", 1)[0].strip() or "image/png"
        parts.append({
            "type": "file",
            "mime": mime,
            "filename": f"image-{len(parts) + 1}.{mime.rsplit('/', 1)[-1] or 'png'}",
            "url": url,
        })
    return parts


def _split(messages: list[Msg]) -> tuple[str, str, list[dict]]:
    """Системний промпт окремо, розмова — транскриптом, картинки — file-частинами.

    Сесію створюємо НОВУ на кожен запит: бот і так надсилає всю історію,
    а reuse сесії означав би подвійний контекст (свій і ботів) і розсинхрон.
    Картинки беремо лише з ОСТАННЬОГО повідомлення: історію бот шле текстом.
    """
    system = "\n\n".join(_text_of(m.content) for m in messages if m.role == "system").strip()
    convo = [m for m in messages if m.role != "system"]
    files = _file_parts_of(convo[-1].content) if convo else []

    if len(convo) <= 1:
        return system, _text_of(convo[0].content) if convo else "", files

    lines = []
    for m in convo[:-1]:
        who = "Користувач" if m.role == "user" else "Ти"
        text = _text_of(m.content).strip()
        if text:
            lines.append(f"{who}: {text}")
    last = _text_of(convo[-1].content).strip()
    if lines:
        return system, "Попередня розмова:\n" + "\n".join(lines) + f"\n\nКористувач: {last}", files
    return system, last, files


async def _ask_regolo(model_id: str, system: str, text: str, files: list[dict] | None = None) -> str:
    """Прямий OpenAI-виклик до Regolo (без opencode) — заради швидкості."""
    key = cfg.get_regolo_asr_key()
    if not key:
        raise HTTPException(502, "немає ключа Regolo (env REGOLO_ASR_API_KEY)")
    if files:
        # Ці моделі текстові. Чесна помилка краща за мовчазно проігноровану
        # картинку: бот побачить невдачу і піде до vision-моделі далі по ланцюгу.
        raise HTTPException(400, f"модель {model_id} не приймає картинки")

    messages = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": text}]
    async with httpx.AsyncClient(timeout=REGOLO_TIMEOUT_S) as client:
        r = await client.post(
            f"{REGOLO_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": model_id, "messages": messages},
        )
    if r.status_code != 200:
        raise HTTPException(502, f"Regolo відмовив ({r.status_code}): {r.text[:200]}")
    try:
        reply = (r.json()["choices"][0]["message"].get("content") or "").strip()
    except (KeyError, IndexError, ValueError) as exc:
        raise HTTPException(502, "Regolo повернув несподівану відповідь") from exc
    if not reply:
        raise HTTPException(502, "модель повернула порожню відповідь")
    return reply


async def _ask(model: str, system: str, text: str, files: list[dict] | None = None) -> str:
    """Один запит до opencode: нова сесія → повідомлення → текст відповіді."""
    if "/" not in model:
        raise HTTPException(400, f"Модель має бути «провайдер/модель», отримано: {model}")
    provider_id, _, model_id = model.partition("/")
    if provider_id == REGOLO_PROVIDER:
        return await _ask_regolo(model_id, system, text, files)

    async with httpx.AsyncClient(timeout=REPLY_TIMEOUT_S) as client:
        r = await client.post(f"{OPENCODE_URL}/session", json={"title": "claude-bot"})
        if r.status_code != 200:
            raise HTTPException(502, f"opencode не створив сесію ({r.status_code})")
        sid = r.json()["id"]

        body: dict = {
            "model": {"providerID": provider_id, "modelID": model_id},
            "parts": [{"type": "text", "text": text}, *(files or [])],
        }
        if system:
            body["system"] = system

        r = await client.post(f"{OPENCODE_URL}/session/{sid}/message", json=body)
        if r.status_code != 200:
            raise HTTPException(502, f"opencode відмовив ({r.status_code}): {r.text[:200]}")
        data = r.json()

    err = (data.get("info") or {}).get("error")
    if err:
        raise HTTPException(502, f"модель повернула помилку: {str(err)[:200]}")
    parts = data.get("parts") or []
    reply = "\n".join(
        p.get("text", "") for p in parts
        if p.get("type") == "text" and p.get("text")
    ).strip()
    if not reply:
        raise HTTPException(502, "модель повернула порожню відповідь")
    return reply


def _openai_response(model: str, reply: str) -> dict:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {"role": "assistant", "content": reply},
            "finish_reason": "stop",
        }],
        # opencode не віддає лічильники токенів у цьому виклику; нулі чесніші
        # за вигадані числа, які потім потрапили б у статистику.
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatReq):
    # Regolo ходить повз opencode — не піднімаємо його заради такого запиту
    # (інакше найшвидша модель платила б за чужий холодний старт).
    if not req.model.startswith(f"{REGOLO_PROVIDER}/"):
        await _ensure_opencode()
    system, text, files = _split(req.messages)
    if not text and not files:
        raise HTTPException(400, "Порожнє повідомлення")
    reply = await _ask(req.model, system, text or "Опиши зображення.", files)

    if not req.stream:
        return _openai_response(req.model, reply)

    # Стрімінг «одним куском»: сесійне API opencode віддає відповідь цілком,
    # тому справжніх токенів у нас немає. Але формат SSE тримаємо — інакше
    # бот витрачав би одну невдалу спробу стріму на кожен запит.
    async def sse():
        base = {
            "id": f"chatcmpl-{uuid.uuid4().hex[:24]}",
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": req.model,
        }
        first = {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": reply}, "finish_reason": None}]}
        yield f"data: {json.dumps(first, ensure_ascii=False)}\n\n"
        done = {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        yield f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse(), media_type="text/event-stream")


@app.get("/health")
async def health() -> dict:
    async with httpx.AsyncClient() as client:
        return {"ok": await _opencode_alive(client), "opencode": OPENCODE_URL, "data": str(DATA_HOME)}
