"""
API вибору моделі кодинг-агента.

Окремий роутер, а не ще один блок у main.py: у main.py уже 1900+ рядків, і
кожна нова ручка там робить перегляд змін важчим. Тут — тільки те, що
стосується моделі кодингу.

Підключення в main.py одним рядком:

    import coding_api
    app.include_router(coding_api.router)
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import auth_clerk
import coding

log = logging.getLogger("virtual_bot.coding_api")

router = APIRouter(prefix="/api/code", tags=["coding"])


async def _require_user(request: Request) -> str:
    """
    Той самий строгий шлюз, що й у main.py: без валідного токена — 401.

    Свідомо ПОВТОРЕНО, а не імпортовано з main: імпорт main із роутера, який
    сам підключається в main, дав би цикл. Логіка коротка й стабільна, а
    джерело правди про «чи вимкнено вхід» одне — auth_clerk.
    """
    if auth_clerk.is_auth_disabled():
        return "dev"
    auth = request.headers.get("authorization") or request.headers.get("Authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        token = (
            request.headers.get("x-clerk-token")
            or request.query_params.get("token")
            or ""
        ).strip()
    if not token:
        raise HTTPException(status_code=401, detail="Потрібен вхід (Clerk)")
    return auth_clerk.user_id_from_payload(auth_clerk.verify_clerk_token(token))


class CodeModelRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)


@router.get("/models")
async def code_models(request: Request) -> dict:
    """Кований список моделей кодингу + та, що обрана зараз."""
    await _require_user(request)
    return {"models": coding.available_models(), "selected": coding.get_selected_model()}


@router.post("/model")
async def set_code_model(request: Request, req: CodeModelRequest) -> dict:
    """
    Вибір моделі кодингу.

    Приймаємо ЛИШЕ id з кованого списку: рядок звідси йде в аргумент --model
    чужого процесу, тож довільне значення тут неприпустиме.

    Живі процеси omp гасить сам coding.set_selected_model: модель задається
    під час запуску, тож уже піднятий процес далі працював би старою — і
    панель показувала б одне, а код писала інша модель.
    """
    await _require_user(request)
    model = req.model.strip()
    if not await coding.set_selected_model(model):
        raise HTTPException(status_code=400, detail="Невідома або недозволена модель кодингу")
    log.info("Модель кодингу обрано: %s", model)
    return {"ok": True, "selected": coding.get_selected_model()}
