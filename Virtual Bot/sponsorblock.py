"""
«Клод Бот» — SponsorBlock: де у відео вбудована реклама і що можна пропустити.

Це і є справжній «адблок» для нашого шляху відтворення. Рекламу, яку
YouTube ВСТАВЛЯЄ сам, ми не бачимо взагалі: відео йде проксі-потоком
(`/api/music/video`) без плеєра YouTube, тож ні прероли, ні банери туди не
доходять. Але лишається реклама, ВКЛЕЄНА в саме відео («цей ролик спонсує…»),
і вирізати її може тільно спільнотна база — SponsorBlock.

API: https://sponsor.ajay.app — публічний, безкоштовний, без ключа.
Ходимо ПРИВАТНИМ шляхом: `/api/skipSegments/<перші 4 символи sha256(videoID)>`.
Сервер віддає всі відео з таким префіксом хеша (сотні), і ми вибираємо своє
локально — тож із запиту НЕ видно, що саме дивиться людина. Це коштує
кілька десятків кілобайт на відео замість двох, і ця ціна свідома: бот стоїть
у когось на столі й не має зливати історію перегляду третій стороні.

Порожній список — нормальний стан (сегментів для відео просто немає), а не
помилка: плеєр грає далі, просто без пропусків.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any

import httpx

log = logging.getLogger("virtual_bot.sponsorblock")

API_BASE = "https://sponsor.ajay.app/api/skipSegments"

# Категорії, які взагалі існують у SponsorBlock. Значення — людська назва
# (її показує застосунок у налаштуваннях і бот у відповіді).
CATEGORIES: dict[str, str] = {
    "sponsor": "Реклама спонсора",
    "selfpromo": "Самопромо і донати",
    "interaction": "«Лайк і підписка»",
    "intro": "Заставка без змісту",
    "outro": "Титри в кінці",
    "preview": "Перекази того, що буде",
    "filler": "Відступи не по темі",
    "music_offtopic": "Немузичні частини (у кліпах)",
}

# actionType: беремо лише "skip". "mute" приглушує, "poi" — це закладка,
# "full" означає «все відео — реклама»; автоматично стрибати по них не можна,
# інакше плеєр вилітав би в кінець на першій секунді.
_ACTION_SKIP = "skip"

# Сегменти коротші за це — не пропускаємо: стрибок на пів секунди читається
# як заїкання плеєра, а не як прибрана реклама.
MIN_SEGMENT_S = 1.0

_TTL_S = 3600.0
_CACHE_MAX = 200
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_lock = asyncio.Lock()

# Скільки чекаємо базу: вона не критична, і краще грати без пропусків, ніж
# тримати чорний екран, поки хтось не відповість.
TIMEOUT_S = 6.0


def video_hash_prefix(video_id: str, length: int = 4) -> str:
    """Перші символи sha256(videoID) — те, що бачить сервер замість id."""
    digest = hashlib.sha256(video_id.encode("utf-8")).hexdigest()
    return digest[:length]


def clean_categories(values: object) -> list[str]:
    """Лишає тільки відомі категорії, у стабільному порядку CATEGORIES."""
    if not isinstance(values, (list, tuple, set)):
        return []
    wanted = {str(v).strip().lower() for v in values}
    return [name for name in CATEGORIES if name in wanted]


def _parse(payload: object, video_id: str, categories: list[str]) -> list[dict[str, Any]]:
    """Відповідь приватного ендпоінта → сегменти НАШОГО відео.

    Формат: [{"videoID": ..., "segments": [{"category", "actionType",
    "segment": [start, end], "UUID", "votes", "locked"}]}, ...].
    """
    if not isinstance(payload, list):
        return []
    allowed = set(categories)
    out: list[dict[str, Any]] = []
    for entry in payload:
        if not isinstance(entry, dict) or entry.get("videoID") != video_id:
            continue
        for seg in entry.get("segments") or []:
            if not isinstance(seg, dict):
                continue
            category = str(seg.get("category", ""))
            if category not in allowed:
                continue
            if str(seg.get("actionType", _ACTION_SKIP)) != _ACTION_SKIP:
                continue
            bounds = seg.get("segment")
            if not isinstance(bounds, (list, tuple)) or len(bounds) != 2:
                continue
            try:
                start = float(bounds[0])
                end = float(bounds[1])
            except (TypeError, ValueError):
                continue
            if not (end > start) or (end - start) < MIN_SEGMENT_S:
                continue
            # Голоси нижче нуля — спірний сегмент: спільнота вважає його
            # хибним, і пропуск по ньому вирізав би зміст, а не рекламу.
            try:
                votes = int(seg.get("votes", 0))
            except (TypeError, ValueError):
                votes = 0
            if votes < 0 and not seg.get("locked"):
                continue
            out.append({
                "category": category,
                "label": CATEGORIES[category],
                "start": round(start, 2),
                "end": round(end, 2),
            })
    out.sort(key=lambda s: s["start"])
    return _merge_overlaps(out)


def _merge_overlaps(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Склеює сегменти, що перетинаються: інакше плеєр стрибав би двічі."""
    merged: list[dict[str, Any]] = []
    for seg in segments:
        if merged and seg["start"] <= merged[-1]["end"]:
            last = merged[-1]
            if seg["end"] > last["end"]:
                last["end"] = seg["end"]
                # Назву лишаємо від першого — саме він каже, чому пропускаємо
            continue
        merged.append(dict(seg))
    return merged


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    hit = _cache.get(key)
    if hit is None:
        return None
    ts, segments = hit
    if time.monotonic() - ts > _TTL_S:
        _cache.pop(key, None)
        return None
    return segments


def _cache_put(key: str, segments: list[dict[str, Any]]) -> None:
    if len(_cache) >= _CACHE_MAX:
        oldest = min(_cache, key=lambda k: _cache[k][0])
        _cache.pop(oldest, None)
    _cache[key] = (time.monotonic(), segments)


async def segments(video_id: str, categories: list[str]) -> list[dict[str, Any]]:
    """Сегменти для пропуску. Мережевий збій = порожній список, не виняток."""
    video_id = (video_id or "").strip()
    categories = clean_categories(categories)
    if not video_id or not categories:
        return []
    key = video_id + "|" + ",".join(categories)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    prefix = video_hash_prefix(video_id)
    url = f"{API_BASE}/{prefix}"
    # Тільки потрібні поля: відповідь на префікс — це сотні відео, і повний
    # набір полів роздував би її в мегабайти на каналі Pi.
    params = {
        "categories": '["' + '","'.join(categories) + '"]',
        "actionTypes": '["skip"]',
    }
    async with _lock:
        cached = _cache_get(key)
        if cached is not None:
            return cached
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, follow_redirects=True) as client:
                resp = await client.get(url, params=params)
            if resp.status_code == 404:
                # Жодного відео з таким префіксом — теж відповідь, кешуємо
                _cache_put(key, [])
                return []
            resp.raise_for_status()
            found = _parse(resp.json(), video_id, categories)
        except Exception as exc:  # noqa: BLE001 — база не критична для показу
            log.info("SponsorBlock недоступний (%s: %s) — граємо без пропусків",
                     type(exc).__name__, exc)
            return []
        _cache_put(key, found)
        if found:
            log.info("⏭ SponsorBlock: %d сегментів для %s", len(found), video_id)
        return found


def total_skipped(segments_list: list[dict[str, Any]]) -> float:
    """Скільни секунд усього вирізаємо — це бот і озвучує людині."""
    return round(sum(max(0.0, s["end"] - s["start"]) for s in segments_list), 1)
