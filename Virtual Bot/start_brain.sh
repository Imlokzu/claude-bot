#!/usr/bin/env bash
# «Клод Бот» — Omni-роутер на базі opencode.
#
# Піднімає OpenAI-сумісний шлюз на 127.0.0.1:20128 — рівно той, якого чекає
# config.yaml (секція omni) І який налаштований як upstream у OpenClaw
# (~/.openclaw/openclaw.json → "omni/opencode-go/…").
#
# Поки цього роутера не було, ланцюжок мозків падав так:
#   Omni (20128) — немає  →  OpenClaw — 500, бо його upstream це той самий
#   20128  →  Anthropic — немає ключа  →  Chat2API — не запущений  →  ДЕМО.
#
# Шим сам піднімає `opencode serve` з ОКРЕМОЮ базою даних
# (~/.local/share/claude-bot-brain) і симлінком на справжній auth.json:
#   • особиста база opencode користувача (~1.5 ГБ) відстала від бінарника на
#     кілька міграцій і падає з «no such column: replacement_seq»;
#   • ботові сесії не змішуються з особистими;
#   • ключі лишаються в одному місці.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v opencode >/dev/null 2>&1; then
  echo "[start_brain] Немає opencode у PATH — встановіть його (brew install opencode)" >&2
  exit 1
fi

if [ ! -d .venv ]; then
  echo "[start_brain] Немає .venv — спершу запустіть ./start.sh" >&2
  exit 1
fi

PORT="${OMNI_SHIM_PORT:-20128}"
echo "[start_brain] Роутер на http://127.0.0.1:${PORT}/v1 (моделі: opencode-go/*)"
exec ./.venv/bin/python -m uvicorn omni_shim:app --host 127.0.0.1 --port "$PORT"
