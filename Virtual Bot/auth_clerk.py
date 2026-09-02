"""
Клод Бот — Clerk auth для FastAPI (8100).

Перевіряє JWT від Clerk (RS256, JWKS за issuer'ом), без жодного редіректу.
Issuer береться з env CLERK_JWT_ISSUER (https://<instance>.clerk.accounts.dev),
або виводиться з VITE_CLERK_PUBLISHABLE_KEY фронта. JWKS кешується.
"""
from __future__ import annotations

import base64
import os
import time
from pathlib import Path
from typing import Optional

import httpx

try:
    import jwt  # PyJWT
    from jwt import PyJWKClient
except ImportError:  # pragma: no cover
    jwt = None  # type: ignore
    PyJWKClient = None  # type: ignore

from fastapi import Header, HTTPException, Request

# Clerk публікує JWKS за <issuer>/.well-known/jwks.json
# issuer — це https://<instance>.clerk.accounts.dev (без trailing /)
_JWKS_CLIENTS: dict[str, object] = {}
_JWKS_OK_UNTIL: dict[str, float] = {}

# Вазливо: publishable key (pk_test_...) НЕ є секретом, але issuer з нього
# витягуємо лише як fallback, якщо адмін не задав CLERK_JWT_ISSUER явно.


def _issuer_from_publishable_key() -> Optional[str]:
    for p in [
        Path(__file__).resolve().parent / ".env",
        Path(__file__).resolve().parent / "chat-panel" / ".env.local",
        Path(__file__).resolve().parent / "memory-panel" / ".env.local",
        Path("claude-bot-display/frontend/.env.local"),
    ]:
        try:
            text = p.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith("VITE_CLERK_PUBLISHABLE_KEY="):
                continue
            val = line.split("=", 1)[1].strip().strip('"').strip("'")
            if not val:
                continue
            try:
                b64 = val.split("_", 2)[-1] if "_" in val else val
                b64 += "=" * (-len(b64) % 4)
                decoded = base64.b64decode(b64).decode("utf-8", errors="ignore")
                import re

                m = re.search(r"[a-z0-9-]+\.clerk\.accounts\.dev", decoded)
                if m:
                    return "https://" + m.group(0)
            except Exception:
                continue
    return None


def get_clerk_issuer() -> Optional[str]:
    v = (os.environ.get("CLERK_JWT_ISSUER") or os.environ.get("CLERK_ISSUER") or "").strip().rstrip("/")
    if v:
        return v
    return _issuer_from_publishable_key()


def _get_jwks_client(issuer: str):
    if jwt is None or PyJWKClient is None:
        raise HTTPException(status_code=500, detail="PyJWT не встановлено (pip install PyJWT[crypto])")
    now = time.time()
    cli = _JWKS_CLIENTS.get(issuer)
    ok_until = _JWKS_OK_UNTIL.get(issuer, 0)
    # кеш до 1 години або до помилки
    if cli is not None and now < ok_until:
        return cli
    jwks_url = f"{issuer}/.well-known/jwks.json"
    cli = PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
    _JWKS_CLIENTS[issuer] = cli
    _JWKS_OK_UNTIL[issuer] = now + 3600
    return cli


def verify_clerk_token(token: str) -> dict:
    """Верифікує Clerk JWT, повертає payload або кидає HTTPException 401."""
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Відсутній токен авторизації")
    issuer = get_clerk_issuer()
    if not issuer:
        raise HTTPException(status_code=500, detail="CLERK_JWT_ISSUER не налаштовано")
    try:
        jwks = _get_jwks_client(issuer)
        key = jwks.get_signing_key_from_jwt(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Невірний токен (JWKS): {e}") from e
    try:
        payload = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"require": ["sub", "exp", "iss"]},
            leeway=30,
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Токен прострочено")
    except jwt.InvalidIssuerError:
        raise HTTPException(status_code=401, detail="Невірний issuer токена")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Невірний токен: {e}") from e
    sub = str(payload.get("sub") or "").strip()
    if not sub:
        raise HTTPException(status_code=401, detail="Токен без sub")
    return payload


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(default=None),
) -> dict:
    """
    FastAPI dependency: витягує Bearer токен, верифікує, повертає payload.
    Кидає 401 якщо не ок — саме це і є гейт без халтури.
    """
    # Дозволяємо і Authorization: Bearer ... і X-Clerk-Token (на випадок EventSource)
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        # fallback: токен у заголовку X-Clerk-Token або query ?token= (для SSE)
        token = request.headers.get("x-clerk-token") or request.query_params.get("token") or ""
        token = token.strip()
    payload = verify_clerk_token(token)
    return payload


def user_id_from_payload(payload: dict) -> str:
    return str(payload.get("sub") or "").strip()


def is_auth_disabled() -> bool:
    """Якщо CLERK_DISABLED=1 — пускаємо без токена (для локальної розробки)."""
    return (os.environ.get("CLERK_DISABLED") or "").strip() == "1"
