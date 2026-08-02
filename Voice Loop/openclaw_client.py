"""
Клод Бот — клієнт для OpenAI-сумісного /v1/chat/completions ендпоінта OpenClaw.

OpenClaw вже виступає "мозком" (памʼять, tool use — включно з нашим
vision_check_camera, маршрутизація до Claude) — цей клієнт лише надсилає
розпізнаний текст і повертає відповідь. Заміняє власний RAG/tool-use клієнт
із Кроків 2-3 dev-order.md.

Ендпоінт вимкнений за замовчуванням у OpenClaw — треба увімкнути:

    {
      gateway: {
        http: {
          endpoints: {
            chatCompletions: { enabled: true },
          },
        },
      },
    }
"""

from __future__ import annotations

import requests


class OpenClawClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        agent: str = "openclaw/default",
        timeout_s: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.agent = agent
        self.timeout_s = timeout_s

    def send_message(self, text: str, session_key: str | None = None) -> str:
        """Надсилає текст як звичайне повідомлення користувача, повертає текст відповіді."""
        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        if session_key:
            headers["x-openclaw-session-key"] = session_key

        payload = {
            "model": self.agent,
            "messages": [{"role": "user", "content": text}],
        }

        resp = requests.post(url, headers=headers, json=payload, timeout=self.timeout_s)
        resp.raise_for_status()
        data = resp.json()

        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError) as e:
            raise ValueError(f"Неочікувана відповідь від OpenClaw: {data}") from e
