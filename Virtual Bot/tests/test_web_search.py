from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

from tools import search


_HTML = """
<div class="result">
  <a rel="nofollow" class="result__a" href="https://openai.com/codex/">OpenAI Codex</a>
  <a class="result__snippet">Coding agent from OpenAI.</a>
</div>
"""


class _Response:
    status_code = 200
    text = _HTML

    def raise_for_status(self):
        return None


class _Client:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, *args, **kwargs):
        return _Response()


class WebSearchTests(unittest.TestCase):
    def test_parses_current_duckduckgo_html_markup(self) -> None:
        with patch.object(search.httpx, "AsyncClient", return_value=_Client()):
            result = asyncio.run(search.search_web("OpenAI Codex"))

        self.assertEqual(result["results"][0]["title"], "OpenAI Codex")
        self.assertEqual(result["results"][0]["url"], "https://openai.com/codex/")
        self.assertEqual(result["results"][0]["snippet"], "Coding agent from OpenAI.")


if __name__ == "__main__":
    unittest.main()
