"""
«Клод Бот» — кодинг-режим через oh-my-pi (omp).

ЧОМУ ОКРЕМИЙ ХАРНЕС, А НЕ ЩЕ ОДИН МОЗОК
---------------------------------------
Мозки в brains.py — це «питання → відповідь»: цикл інструментів веде наш
Python. omp влаштований інакше: він САМ володіє циклом (edit з хеш-якорями,
LSP, bash, сабагенти), і вкладати його в наш цикл означало б дві компакції
контексту, два системні промпти й неможливість зрозуміти, хто зафейлив.

Тому omp тут — окремий процес, з яким ми говоримо по NDJSON (`--mode rpc`),
а його події перекладаємо у ТУ САМУ мову SSE, якою вже говорить /api/chat
(delta / tool_start / tool_done). Завдяки цьому фронтенду не треба нічого
знати про omp — міняється лише адреса запиту.

МЕЖІ
----
- cwd — тека коду користувача (workspace.code_root()), НЕ brain і не workspace:
  памʼять, профіль і журнали розмов лишаються поза полем зору кодера;
- профіль omp ізольований (`--profile`), тож особистий omp користувача
  зі своїми ключами, сесіями й налаштуваннями не зачіпається;
- УВАГА: у omp власний bash. cwd — це зручність, а не пісочниця; вийти за
  межі теки він технічно може. Справжня ізоляція — контейнер, і доки її
  немає, кодинг-режим не можна відкривати недовіреним користувачам.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import app_config as cfg
from opencode_keys import opencode_keys

log = logging.getLogger("virtual_bot.coding")

Emit = Callable[[dict], Awaitable[None]]

# Скільки чекати на стартовий кадр `ready`, перш ніж вважати запуск невдалим.
_READY_TIMEOUT_S = 30.0
# Запобіжник проти «вічного» кадру: одна прочитана лінія не може бути довшою.
_MAX_FRAME_BYTES = 8 * 1024 * 1024


class CodingError(RuntimeError):
    """Помилка запуску або роботи кодинг-сесії (текст безпечний для показу)."""


def omp_binary() -> str:
    """Шлях до omp: env OMP_BIN → PATH → голе імʼя (щоб помилка була зрозумілою)."""
    configured = os.environ.get("OMP_BIN", "").strip()
    if configured:
        return configured
    return shutil.which("omp") or "omp"


def is_available() -> bool:
    """Чи є сенс пропонувати кодинг-режим (без цього — не показуємо кнопку)."""
    return bool(shutil.which(omp_binary()) or os.path.isfile(omp_binary()))


def _subprocess_env() -> dict[str, str]:
    """
    Середовище для omp.

    ANTHROPIC_BASE_URL/ANTHROPIC_CUSTOM_HEADERS навмисно ВИРІЗАЄМО: якщо бота
    запустили з термінала, де ці змінні вказують на чужий локальний проксі,
    omp мовчки зависає на першому ж запиті до моделі (перевірено на живому).
    Ключ Regolo кладемо під тим імʼям, яке чекає профіль omp.
    """
    env = dict(os.environ)
    for noisy in ("ANTHROPIC_BASE_URL", "ANTHROPIC_CUSTOM_HEADERS", "ANTHROPIC_API_KEY"):
        env.pop(noisy, None)
    key = cfg.get_regolo_asr_key()
    if key:
        env["REGOLO_ASR_API_KEY"] = key
    # Моделі OpenCode Zen/Go (muse-spark та інші) — прямо, без Omni-шима:
    # кодинг-агенту потрібен tool-calling, а шим віддає лише текст.
    env.update(opencode_keys())
    return env


class CodingSession:
    """Один живий процес omp над однією текою коду."""

    def __init__(self, cwd: str, *, model: str = "", profile: str = "") -> None:
        self.cwd = cwd
        self.model = model or cfg.CODING_MODEL
        self.profile = profile or cfg.CODING_PROFILE
        self._proc: asyncio.subprocess.Process | None = None
        self._lock = asyncio.Lock()
        self._req = 0
        # True, поки тур не дійшов до термінального agent_end. Якщо клієнт
        # відвалився посеред роботи, недочитані кадри лишаються в трубі й
        # отруїли б НАСТУПНИЙ запит — тому перед новим туром їх зливаємо.
        self._dirty = False
        self.started_at = 0.0

    # ------------------------------------------------------------ життєвий цикл

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def start(self) -> None:
        """Піднімає omp і чекає на кадр `ready` (повторний виклик — no-op)."""
        if self.alive:
            return
        args = [
            omp_binary(),
            "--profile", self.profile,
            "--model", self.model,
            "--mode", "rpc",
            "--cwd", self.cwd,
            "--approval-mode", "yolo",
            "--max-time", str(int(cfg.CODING_MAX_TIME_S)),
        ]
        log.info("Запуск omp: cwd=%s model=%s", self.cwd, self.model)
        try:
            self._proc = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self.cwd,
                env=_subprocess_env(),
                limit=_MAX_FRAME_BYTES,
            )
        except FileNotFoundError as exc:
            raise CodingError("omp не знайдено — кодинг-режим недоступний.") from exc

        try:
            await asyncio.wait_for(self._await_ready(), timeout=_READY_TIMEOUT_S)
        except asyncio.TimeoutError as exc:
            await self.stop()
            raise CodingError("omp не відповів на старті.") from exc
        self.started_at = time.time()

    async def _await_ready(self) -> None:
        while True:
            frame = await self._read_frame()
            if frame is None:
                raise CodingError("omp завершився, не піднявшись.")
            if frame.get("type") == "ready":
                return

    async def stop(self) -> None:
        proc, self._proc = self._proc, None
        if proc is None or proc.returncode is not None:
            return
        try:
            if proc.stdin and not proc.stdin.is_closing():
                proc.stdin.close()
            await asyncio.wait_for(proc.wait(), timeout=5)
        except (asyncio.TimeoutError, ProcessLookupError, BrokenPipeError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    # ------------------------------------------------------------ транспорт

    async def _read_frame(self) -> dict | None:
        """Один NDJSON-кадр зі stdout; None — потік закінчився."""
        proc = self._proc
        if proc is None or proc.stdout is None:
            return None
        while True:
            try:
                raw = await proc.stdout.readline()
            except (asyncio.LimitOverrunError, ValueError):
                # Кадр більший за ліміт — пропускаємо, але не валимо сесію.
                log.warning("Завеликий кадр від omp — пропущено")
                continue
            if not raw:
                return None
            line = raw.decode("utf-8", "replace").strip()
            if not line:
                continue
            try:
                frame = json.loads(line)
            except json.JSONDecodeError:
                log.debug("Невалідний JSON від omp: %.120s", line)
                continue
            if isinstance(frame, dict):
                return frame

    async def _send(self, command: dict) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise CodingError("Кодинг-сесія не запущена.")
        proc.stdin.write((json.dumps(command, ensure_ascii=False) + "\n").encode("utf-8"))
        await proc.stdin.drain()

    # ------------------------------------------------------------ основний виклик

    async def _drain_stale(self, timeout: float = 20.0) -> None:
        """Дочитує хвіст обірваного туру, щоб він не потрапив у наступний."""
        log.warning("Кодинг-сесія лишилась посеред туру — зливаю хвіст")
        deadline = asyncio.get_running_loop().time() + timeout
        while asyncio.get_running_loop().time() < deadline:
            remaining = deadline - asyncio.get_running_loop().time()
            try:
                frame = await asyncio.wait_for(self._read_frame(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            if frame is None:
                break
            if frame.get("type") == "agent_end" and frame.get("isTerminal") is not False:
                self._dirty = False
                return
        # Хвіст не добіг — процес уже не можна вважати чистим, підіймемо новий.
        log.warning("Хвіст не дочитано — перезапускаю omp")
        await self.stop()
        self._dirty = False

    def _relative(self, path: Any) -> str:
        """Абсолютний шлях від omp → відносний до теки коду (для показу в чаті)."""
        if not isinstance(path, str) or not path:
            return ""
        try:
            resolved = Path(path)
            if not resolved.is_absolute():
                return path
            return str(resolved.relative_to(Path(self.cwd).resolve()))
        except (ValueError, OSError):
            # Шлях поза текою коду — показуємо саме імʼя, не розкриваючи дерево.
            return Path(path).name

    async def prompt(self, message: str, emit: Emit | None = None) -> dict:
        """
        Дає omp задачу і транслює його роботу подіями `emit`.

        Повертає СТИСЛИЙ результат, а не транскрипт: текст відповіді, перелік
        зачеплених файлів і кроки. Сирий діалог омпа в чат не потрапляє —
        інакше контекст чату розпухне за пару делегувань.
        """
        async with self._lock:
            if self._dirty:
                await self._drain_stale()
            await self.start()
            self._req += 1
            req_id = f"bot-{self._req}"
            await self._send({"id": req_id, "type": "prompt", "message": message})
            self._dirty = True

            text_parts: list[str] = []
            # Кроки складаємо ОДРАЗУ у схемі, яку читає панель
            # ({type, tool, input, id, at, result}). Інакше збережена розмова
            # відкривалася б із кроком, що вічно «працює»: фронт дивиться на
            # step.type, а його в записі не було.
            steps: list[dict] = []
            step_by_call: dict[str, dict] = {}
            files: list[str] = []
            failed: list[str] = []
            # Події до підтвердження нашої команди належать чужому туру.
            accepted = False

            while True:
                frame = await self._read_frame()
                if frame is None:
                    raise CodingError("omp обірвав звʼязок під час роботи.")

                kind = frame.get("type")

                if not accepted:
                    if kind == "response" and frame.get("id") == req_id:
                        if not frame.get("success", True):
                            self._dirty = False
                            raise CodingError("omp відхилив задачу.")
                        accepted = True
                    continue

                if kind == "message_update":
                    event = frame.get("assistantMessageEvent") or {}
                    if event.get("type") == "text_delta":
                        chunk = event.get("delta") or ""
                        if chunk:
                            text_parts.append(chunk)
                            if emit:
                                await emit({"type": "delta", "chunk": chunk})

                elif kind == "tool_execution_start":
                    tool = str(frame.get("toolName") or "tool")
                    args = frame.get("args") or {}
                    path = self._relative(args.get("path"))
                    if path and path not in files:
                        files.append(path)
                    short = _short_args(args, path)
                    step = {
                        "type": "start",
                        "tool": tool,
                        "input": short,
                        "id": f"{tool}-{len(steps)}",
                        "at": sum(len(part) for part in text_parts),
                        "intent": frame.get("intent") or "",
                    }
                    steps.append(step)
                    call_id = frame.get("toolCallId")
                    if isinstance(call_id, str) and call_id:
                        step_by_call[call_id] = step
                    if emit:
                        await emit({"type": "tool_start", "tool": tool, "input": short})

                elif kind == "tool_execution_end":
                    tool = str(frame.get("toolName") or "tool")
                    short_result = _short_result(frame.get("result"))
                    if frame.get("isError"):
                        failed.append(tool)
                    # Закриваємо саме СВІЙ крок за toolCallId: за іменем тулзи
                    # не можна — паралельні виклики write закрили б чужий.
                    call_id = frame.get("toolCallId")
                    step = step_by_call.pop(call_id, None) if isinstance(call_id, str) else None
                    if step is not None:
                        step["type"] = "done"
                        step["result"] = short_result
                        if frame.get("isError"):
                            step["error"] = True
                    if emit:
                        await emit({"type": "tool_done", "tool": tool, "result": short_result})

                elif kind == "agent_end":
                    # isTerminal=false означає, що omp ще має роботу — чекаємо далі.
                    if frame.get("isTerminal") is not False:
                        self._dirty = False
                        break

            for stale in step_by_call.values():
                stale["type"] = "done"
                stale.setdefault("result", {})

            return {
                "reply": "".join(text_parts).strip(),
                "files": files,
                "steps": steps,
                "failed_tools": failed,
            }


def _short_args(args: Any, path: str) -> dict:
    """
    Те, що показуємо в картці тулзи.

    Повний `content` запису сюди не кладемо: у чат полетів би весь файл, а
    користувачу треба знати ЩО зробили, не БАЙТИ. Довгі рядки підрізаємо.
    """
    if not isinstance(args, dict):
        return {}
    out: dict[str, Any] = {}
    if path:
        out["path"] = path
    for key, value in args.items():
        if key == "path":
            continue
        if isinstance(value, str):
            out[key] = value[:200] + ("…" if len(value) > 200 else "")
        elif isinstance(value, (int, float, bool)):
            out[key] = value
    return out


def _short_result(result: Any) -> dict:
    """Витягує з результату тулзи короткий текст — без сирих деталей у чат."""
    if not isinstance(result, dict):
        return {}
    parts = result.get("content")
    if isinstance(parts, list):
        for part in parts:
            if isinstance(part, dict) and part.get("type") == "text":
                text = str(part.get("text") or "").strip()
                if text:
                    return {"text": text[:400]}
    return {}


# ------------------------------------------------------------------ реєстр сесій

_SESSIONS: dict[str, CodingSession] = {}
_SESSIONS_LOCK = asyncio.Lock()


# ------------------------------------------------------------------ вибір моделі

# Обрана в панелі модель кодингу (None → cfg.CODING_MODEL). Тримаємо в памʼяті
# процесу — так само, як brains тримає вибір моделі чату. Дозволяємо лише
# моделі з кованого списку config.yaml: довільний рядок пішов би прямо в
# аргумент --model чужого процесу.
_selected_model: str | None = None


def available_models() -> list[dict]:
    """Кований список моделей кодингу з config.yaml (id + підпис для UI)."""
    raw = cfg.cfg("coding", "models", default=[]) or []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        out.append({"id": model_id, "label": str(item.get("label") or model_id)})
    return out


def _model_ids() -> set[str]:
    return {m["id"] for m in available_models()}


def get_selected_model() -> str:
    """Активна модель кодингу: обрана в панелі (якщо валідна) або типова."""
    if _selected_model and _selected_model in _model_ids():
        return _selected_model
    return cfg.CODING_MODEL


async def set_selected_model(model: str) -> bool:
    """
    Ставить модель кодингу. False — якщо її немає в кованому списку.

    Живі процеси omp ГАСИМО: модель передається аргументом --model під час
    запуску, тож уже піднятий процес далі працював би старою — і панель
    показувала б одне, а код писало інше.
    """
    global _selected_model
    if model not in _model_ids():
        return False
    if model == get_selected_model():
        _selected_model = model
        return True
    _selected_model = model
    async with _SESSIONS_LOCK:
        sessions = list(_SESSIONS.values())
        _SESSIONS.clear()
    for session in sessions:
        await session.stop()
    log.info("Модель кодингу → %s (перезапущено сесій: %d)", model, len(sessions))
    return True


async def get_session(key: str, cwd: str) -> CodingSession:
    """Сесія на ключ (користувач+проєкт); мертву — перестворюємо."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(key)
        if session is not None and session.alive and session.cwd == cwd:
            return session
        if session is not None:
            await session.stop()
        # Модель беремо з ВИБОРУ, а не з конфіга напряму — інакше
        # перемикання в панелі не діяло б на нові сесії.
        session = CodingSession(cwd, model=get_selected_model())
        _SESSIONS[key] = session
        return session


async def stop_session(key: str) -> bool:
    """Зупиняє сесію; True — якщо було що зупиняти."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.pop(key, None)
    if session is None:
        return False
    await session.stop()
    return True


async def stop_all() -> None:
    """Гасить усі сесії (виклик на зупинці застосунку)."""
    async with _SESSIONS_LOCK:
        sessions = list(_SESSIONS.values())
        _SESSIONS.clear()
    for session in sessions:
        await session.stop()
