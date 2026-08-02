#!/usr/bin/env bash
# «Клод Бот» — Virtual Bot: запуск бекенду панелі керування.
# Створює .venv (якщо нема), ставить залежності, стартує uvicorn на 127.0.0.1:8100.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -d .venv ]; then
  echo "[start.sh] Створюю віртуальне середовище .venv ..."
  python3 -m venv .venv
fi

echo "[start.sh] Встановлюю залежності ..."
./.venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt

# Секрети живуть у .env поряд із config.yaml. Його ЧИТАЄ сам app_config на
# імпорті (надійно, за будь-якого способу запуску, з пріоритетом справжніх
# env-змінних) — тому шелом .env НЕ сорсимо: під `set -euo pipefail` довільний
# вміст .env (пробіли, $VAR тощо) міг би обірвати запуск. Тут лише замикаємо
# права доступу 600, щоб ключ не читали інші локальні користувачі.
if [ -f .env ]; then
  chmod 600 .env 2>/dev/null || true
fi

echo "[start.sh] Запускаю Virtual Bot на http://127.0.0.1:8100 ..."
# --timeout-graceful-shutdown: відкриті SSE-стріми (/api/events) нескінченні —
# без ліміту graceful shutdown чекав би на них вічно
exec ./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8100 \
  --timeout-graceful-shutdown 3
