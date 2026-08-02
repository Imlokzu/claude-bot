"""
«Клод Бот» — Virtual Bot: фоновий «нагляд за життям» бота.

Одна asyncio-задача (start() у startup, stop() у shutdown), яка:
- коли Vision (8000) живий — раз на ~2 с опитує GET /vision/snapshot і реагує:
  * обличчя з'явилось (0→N): SSE vision face_appeared + емоція surprised→happy
    + коротке укр. привітання (варіюється, кулдаун ≥60 с) + емоція на display;
  * обличчя зникло (N→0 стабільно ≥10 с): емоція sad на ~5 с → idle;
  * рух без облич: SSE vision motion (емоцію не смикаємо);
- Vision офлайн/помилки → тихо пробує раз на ~10 с, без спаму в логи;
- дрімота: без взаємодій (чат/події зору) ≥10 хв → емоція sleepy;
  перша ж взаємодія (note_interaction) будить.
- спонтанні емоції: коли бот спокійний (без взаємодій ≥mood_calm_s, не дрімає
  й не сумує) — зрідка САМ ставить випадкову «живу» емоцію на кілька секунд,
  потім повертається в idle. Працює й без Vision (щоб бот сам міняв емоції).

Усі кулдауни/інтервали — в config.yaml (секція liveliness).
"""

from __future__ import annotations

import asyncio
import logging
import random
import time

import httpx

import app_config as cfg
import display_bridge
import events
import profile_store

log = logging.getLogger("virtual_bot.vision_watcher")

# ------------------------------------------------------------------ конфіг

POLL_S = float(cfg.cfg("liveliness", "vision_poll_s", default=2.0))
OFFLINE_POLL_S = float(cfg.cfg("liveliness", "vision_offline_poll_s", default=10.0))
GREET_COOLDOWN_S = float(cfg.cfg("liveliness", "greet_cooldown_s", default=60.0))
FACE_GONE_STABLE_S = float(cfg.cfg("liveliness", "face_gone_stable_s", default=10.0))
SAD_DURATION_S = float(cfg.cfg("liveliness", "sad_duration_s", default=5.0))
MOTION_COOLDOWN_S = float(cfg.cfg("liveliness", "motion_cooldown_s", default=5.0))
SLEEPY_AFTER_S = float(cfg.cfg("liveliness", "sleepy_after_s", default=600.0))
# Спонтанні емоції у простої
MOOD_MIN_S = float(cfg.cfg("liveliness", "mood_min_s", default=25.0))
MOOD_MAX_S = float(cfg.cfg("liveliness", "mood_max_s", default=75.0))
MOOD_DURATION_S = float(cfg.cfg("liveliness", "mood_duration_s", default=4.0))
MOOD_CALM_S = float(cfg.cfg("liveliness", "mood_calm_s", default=12.0))
# mood_max_s не має бути меншим за mood_min_s (інакше random.uniform кине помилку)
if MOOD_MAX_S < MOOD_MIN_S:
    MOOD_MAX_S = MOOD_MIN_S

# «Живі» емоції для спонтанного простою (без sad/sleepy — у них свої тригери,
# без speaking — воно натякає на репліку). Бот виглядає цікавим і бадьорим.
_AMBIENT_MOODS = ["happy", "thinking", "surprised", "love", "listening"]

# Варіанти короткого привітання, коли бот побачив людину
_GREETINGS = [
    "Привіт! Я тебе бачу!",
    "О, привіт! Радий тебе бачити!",
    "Привіт-привіт! Ти повернувся!",
    "Ку-ку! Камера каже, що ти поруч.",
    "Вітаю! Як добре, що ти тут.",
]

# ------------------------------------------------------------------ стан

_task: asyncio.Task | None = None

_vision_online = False          # чи відповідав snapshot останнього разу
_faces = 0                      # підтверджена кількість облич у кадрі
_zero_since: float | None = None  # відколи в кадрі стабільно 0 облич
_sad_until: float | None = None   # до якого моменту тримаємо sad після зникнення
_last_greet_ts: float = -1e9    # монотонний час останнього привітання
_last_motion_ts: float = -1e9   # монотонний час останньої події motion
_last_interaction_ts: float = time.monotonic()
_sleepy_active = False
_mood_until: float | None = None   # до якого моменту тримаємо спонтанну емоцію
_next_mood_at: float | None = None  # монотонний час наступної спонтанної емоції


def _set_emotion(emotion: str) -> None:
    """Емоція і в SSE (фронтенд), і на display (через міст)."""
    events.publish_emotion(emotion)
    display_bridge.send_emotion_bg(emotion)


def note_interaction() -> None:
    """
    Фіксує взаємодію (чат або подія зору). Скидає таймер дрімоти;
    якщо бот дрімав — будить його (емоція idle, далі викликач ставить свою).
    Також скасовує відкладене «sad → idle», щоб не перебити нову емоцію.
    """
    global _last_interaction_ts, _sleepy_active, _sad_until, _mood_until, _next_mood_at
    _last_interaction_ts = time.monotonic()
    _sad_until = None
    # Взаємодія скасовує активну спонтанну емоцію (щоб її «→idle» не перебив
    # реальну емоцію від чату) і відкладає наступну (перепланується, коли стихне)
    _mood_until = None
    _next_mood_at = None
    if _sleepy_active:
        _sleepy_active = False
        log.info("Бот прокинувся з дрімоти")
        try:
            _set_emotion("idle")
        except Exception:  # noqa: BLE001 — пробудження не має права ламати виклик
            log.debug("Не вдалося опублікувати емоцію пробудження", exc_info=True)


def is_sleepy() -> bool:
    """Чи бот зараз у дрімоті (для діагностики зсередини процесу)."""
    return _sleepy_active


# ------------------------------------------------------------------ реакції

async def _on_faces_appeared(faces: int) -> None:
    """0→N облич: подія зору, surprised → happy, привітання з кулдауном."""
    global _last_greet_ts
    note_interaction()
    events.publish_vision("face_appeared", faces)
    _set_emotion("surprised")
    await asyncio.sleep(1.0)  # коротка «мить здивування» перед радістю

    now = time.monotonic()
    if now - _last_greet_ts >= GREET_COOLDOWN_S:
        _last_greet_ts = now
        greeting = random.choice(_GREETINGS)
        # say несе і текст, і емоцію happy — окремої події emotion не треба
        events.publish_say(greeting, "happy")
        display_bridge.send_say_bg(greeting, "happy")
        log.info("Побачив людину (%d обл.) — привітався", faces)
    else:
        _set_emotion("happy")


def _on_faces_gone() -> None:
    """N→0 стабільно ≥10 с: подія зору + сум на ~5 с (потім тік поверне idle)."""
    global _sad_until
    note_interaction()
    events.publish_vision("face_gone", 0)
    _set_emotion("sad")
    _sad_until = time.monotonic() + SAD_DURATION_S
    log.info("Людина зникла з кадру — бот сумує")


def _on_motion() -> None:
    """Рух без облич: лише подія зору, емоцію не смикаємо."""
    note_interaction()
    events.publish_vision("motion", 0)


# ------------------------------------------------------------------ опитування Vision

async def _poll_vision(client: httpx.AsyncClient) -> bool:
    """
    Один запит GET /vision/snapshot. Повертає True, якщо Vision відповів 200
    (тоді опитуємо швидко), інакше False (перевіряємо рідко і тихо).
    """
    global _vision_online, _faces, _zero_since, _last_motion_ts

    try:
        resp = await client.get(f"{cfg.VISION_BASE_URL}/vision/snapshot", timeout=4.0)
    except httpx.HTTPError:
        resp = None

    if resp is None or resp.status_code != 200:
        if _vision_online:
            log.info("Vision став недоступний — перевіряю раз на ~%.0f с", OFFLINE_POLL_S)
        _vision_online = False
        _zero_since = None  # без даних не робимо висновок «людина пішла»
        return False

    try:
        data = resp.json()
        faces = int(data.get("faces_detected", 0))
        motion = bool(data.get("motion_detected", False))
    except (ValueError, TypeError, AttributeError):
        return False

    if not _vision_online:
        _vision_online = True
        log.info("Vision знову доступний — стежу за кадром")

    now = time.monotonic()

    if faces > 0:
        _zero_since = None
        if _faces == 0:
            _faces = faces
            await _on_faces_appeared(faces)
        else:
            _faces = faces  # кількість змінилась — без окремої події
    else:
        if _faces > 0:
            # Дебаунс: вважаємо, що людина пішла, лише після стабільних ≥10 с
            if _zero_since is None:
                _zero_since = now
            elif now - _zero_since >= FACE_GONE_STABLE_S:
                _faces = 0
                _zero_since = None
                _on_faces_gone()
        if motion and now - _last_motion_ts >= MOTION_COOLDOWN_S:
            _last_motion_ts = now
            _on_motion()

    return True


def _schedule_next_mood(now: float) -> None:
    """Планує момент наступної спонтанної емоції (тепер + випадкова пауза)."""
    global _next_mood_at
    _next_mood_at = now + random.uniform(MOOD_MIN_S, MOOD_MAX_S)


def _check_spontaneous_mood(now: float) -> None:
    """
    Коли бот спокійний (не дрімає, не сумує, давно не було взаємодій) — зрідка
    САМ ставить випадкову «живу» емоцію на кілька секунд, потім → idle. Так бот
    сам міняє емоції й виглядає живим навіть без Vision і без чату.
    mood_duration_s == 0 повністю вимикає поведінку.
    """
    global _mood_until, _next_mood_at

    if MOOD_DURATION_S <= 0:
        return

    # Активна спонтанна емоція добігла кінця → назад в idle і плануємо наступну
    if _mood_until is not None:
        if now >= _mood_until:
            _mood_until = None
            _set_emotion("idle")
            _schedule_next_mood(now)
        return

    # Поки бот дрімає/сумує або нещодавно була взаємодія — не втручаємось
    if _sleepy_active or _sad_until is not None:
        return
    if now - _last_interaction_ts < MOOD_CALM_S:
        return

    # Перше планування (після старту чи після взаємодії, коли все стихло)
    if _next_mood_at is None:
        _schedule_next_mood(now)
        return

    if now >= _next_mood_at:
        # Поважаємо вимикач «спонтанні емоції» з профілю (майстер налаштування)
        if not profile_store.load().get("spontaneous", True):
            _schedule_next_mood(now)
            return
        emotion = random.choice(_AMBIENT_MOODS)
        _mood_until = now + MOOD_DURATION_S
        log.debug("Спонтанна емоція: %s", emotion)
        _set_emotion(emotion)


def _check_timers() -> None:
    """Таймери, що працюють незалежно від Vision: sad→idle, дрімота, спонтанні емоції."""
    global _sad_until, _sleepy_active
    now = time.monotonic()

    if _sad_until is not None and now >= _sad_until:
        _sad_until = None
        _set_emotion("idle")

    if not _sleepy_active and now - _last_interaction_ts >= SLEEPY_AFTER_S:
        _sleepy_active = True
        log.info("Тиша вже %.0f хв — бот дрімає", SLEEPY_AFTER_S / 60)
        _set_emotion("sleepy")

    _check_spontaneous_mood(now)


# ------------------------------------------------------------------ життєвий цикл

async def _run() -> None:
    """Головний цикл: тік раз на секунду; Vision опитуємо за розкладом."""
    next_poll = 0.0
    # Vision — локальний: системний/env проксі обходимо (див. cfg.httpx_trust_env)
    async with httpx.AsyncClient(trust_env=cfg.httpx_trust_env(cfg.VISION_BASE_URL)) as client:
        while True:
            now = time.monotonic()
            if now >= next_poll:
                try:
                    ok = await _poll_vision(client)
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001 — фонова задача не має права померти
                    log.debug("Помилка опитування Vision", exc_info=True)
                    ok = False
                next_poll = time.monotonic() + (POLL_S if ok else OFFLINE_POLL_S)
            try:
                _check_timers()
            except Exception:  # noqa: BLE001
                log.debug("Помилка таймерів", exc_info=True)
            await asyncio.sleep(1.0)


def start() -> None:
    """Стартує фонову задачу (викликати з startup, коли event loop уже є)."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_run(), name="vision_watcher")
        log.info("Нагляд за життям бота запущено")


async def stop() -> None:
    """Скасовує фонову задачу (викликати з shutdown)."""
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        except Exception:  # noqa: BLE001 — задача могла померти з власним винятком
            # ще ДО shutdown; це не привід зривати решту lifespan-очистки
            # (display_bridge, services_manager) — лише фіксуємо в лог
            log.exception("Фонова задача зору завершилася з помилкою")
        _task = None
        log.info("Нагляд за життям бота зупинено")
