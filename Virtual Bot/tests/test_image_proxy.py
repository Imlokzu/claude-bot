from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import image_proxy
import main


def _addrinfo(address: str) -> list:
    """Мінімальний результат getaddrinfo — нам потрібен лише sockaddr."""
    return [(2, 1, 6, "", (address, 443))]


class CheckUrlTests(unittest.TestCase):
    """
    Адресу пише модель, а не людина, тож ручка мусить відмовляти сама.

    Найнебезпечніший випадок — не «дивна адреса», а цілком робоча, яка веде
    назад у локальну мережу: через проксі можна було б читати сусідні
    сервіси на 127.0.0.1, у тому числі сам бот.
    """

    def test_rejects_non_http_scheme(self) -> None:
        for url in ("file:///etc/passwd", "ftp://example.com/a.png", "data:image/png;base64,AA"):
            with self.subTest(url=url), self.assertRaises(image_proxy.ImageProxyError):
                image_proxy.check_url(url)

    def test_rejects_local_addresses(self) -> None:
        for address in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1"):
            with self.subTest(address=address):
                with patch.object(image_proxy.socket, "getaddrinfo", return_value=_addrinfo(address)):
                    with self.assertRaises(image_proxy.ImageProxyError):
                        image_proxy.check_url("https://будь-що.example/a.jpg")

    def test_rejects_when_any_address_is_local(self) -> None:
        """Хост із двома адресами, де одна сіра, — теж відмова."""
        both = _addrinfo("93.184.216.34") + _addrinfo("127.0.0.1")
        with patch.object(image_proxy.socket, "getaddrinfo", return_value=both):
            with self.assertRaises(image_proxy.ImageProxyError):
                image_proxy.check_url("https://example.com/a.jpg")

    def test_allows_public_address(self) -> None:
        with patch.object(image_proxy.socket, "getaddrinfo", return_value=_addrinfo("93.184.216.34")):
            self.assertEqual(
                image_proxy.check_url("https://example.com/a.jpg"),
                "https://example.com/a.jpg",
            )

    def test_reports_unresolvable_host(self) -> None:
        with patch.object(image_proxy.socket, "getaddrinfo", side_effect=OSError):
            with self.assertRaises(image_proxy.ImageProxyError) as caught:
                image_proxy.check_url("https://нема-такого.example/a.jpg")
        self.assertEqual(caught.exception.status, 502)


class _Response:
    """Заглушка httpx-відповіді у режимі stream()."""

    def __init__(self, status: int, media: str, chunks: list[bytes]) -> None:
        self.status_code = status
        self.headers = {"content-type": media}
        self._chunks = chunks

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc) -> bool:
        return False

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


def _client(response: _Response):
    """AsyncClient, чий stream() віддає задану відповідь."""
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.__aexit__.return_value = False
    client.stream = lambda *_a, **_kw: response
    return client


class FetchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.resolve = patch.object(
            image_proxy.socket, "getaddrinfo", return_value=_addrinfo("93.184.216.34")
        )
        self.resolve.start()
        self.addCleanup(self.resolve.stop)

    def _fetch(self, response: _Response):
        with patch.object(image_proxy.httpx, "AsyncClient", return_value=_client(response)):
            return asyncio.run(image_proxy.fetch("https://example.com/a.jpg"))

    def test_returns_bytes_and_type(self) -> None:
        data, media = self._fetch(_Response(200, "image/png", [b"\x89PNG", b"rest"]))
        self.assertEqual(data, b"\x89PNGrest")
        self.assertEqual(media, "image/png")

    def test_rejects_non_image(self) -> None:
        with self.assertRaises(image_proxy.ImageProxyError) as caught:
            self._fetch(_Response(200, "text/html; charset=utf-8", [b"<html>"]))
        self.assertEqual(caught.exception.status, 415)

    def test_rejects_bad_status(self) -> None:
        with self.assertRaises(image_proxy.ImageProxyError) as caught:
            self._fetch(_Response(403, "image/jpeg", [b""]))
        self.assertEqual(caught.exception.status, 502)

    def test_rejects_oversized(self) -> None:
        chunk = b"x" * (1024 * 1024)
        big = [chunk] * (image_proxy.MAX_BYTES // len(chunk) + 2)
        with self.assertRaises(image_proxy.ImageProxyError) as caught:
            self._fetch(_Response(200, "image/jpeg", big))
        self.assertEqual(caught.exception.status, 413)


class EndpointTests(unittest.TestCase):
    """Ручка: правильний тип, ім'я файлу й коди помилок."""

    def setUp(self) -> None:
        self.client = TestClient(main.app)

    def test_serves_as_attachment_with_clean_name(self) -> None:
        with patch.object(image_proxy, "fetch", AsyncMock(return_value=(b"\x89PNG", "image/png"))):
            resp = self.client.get(
                "/api/image/fetch",
                params={"url": "https://example.com/a.png", "name": 'краб/"мітка"'},
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["content-type"], "image/png")
        disposition = resp.headers["content-disposition"]
        self.assertTrue(disposition.startswith("attachment;"))
        # Слеші й лапки ламають сам заголовок, тож у імені їх бути не може.
        self.assertNotIn('"', disposition)
        self.assertNotIn("/", disposition.split("''", 1)[1])
        self.assertTrue(disposition.endswith(".png"))

    def test_passes_error_status_through(self) -> None:
        error = image_proxy.ImageProxyError("Адреса веде на локальну мережу")
        with patch.object(image_proxy, "fetch", AsyncMock(side_effect=error)):
            resp = self.client.get("/api/image/fetch", params={"url": "http://127.0.0.1/a.png"})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()["detail"], "Адреса веде на локальну мережу")


if __name__ == "__main__":
    unittest.main()
