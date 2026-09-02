from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import asr_regolo
import brains
import main


class RegoloAdapterTests(unittest.TestCase):
    def test_transcribe_sends_official_multipart_contract(self) -> None:
        response = MagicMock()
        response.headers = {"content-type": "text/plain; charset=utf-8"}
        response.text = "Привіт, Клод Бот"
        response.raise_for_status.return_value = None
        post = AsyncMock(return_value=response)
        client = MagicMock()
        client.__aenter__.return_value.post = post

        with (
            patch.object(asr_regolo.cfg, "get_regolo_asr_key", return_value="test-key"),
            patch.object(asr_regolo.cfg, "REGOLO_ASR_BASE_URL", "https://api.regolo.ai/v1"),
            patch.object(asr_regolo.cfg, "REGOLO_ASR_MODEL", "faster-whisper-large-v3"),
            patch.object(asr_regolo.cfg, "REGOLO_ASR_LANGUAGE", "uk"),
            patch.object(asr_regolo.cfg, "REGOLO_ASR_TIMEOUT_S", 45),
            patch.object(asr_regolo.cfg, "ASR_HOTWORDS", ""),
            patch.object(asr_regolo.httpx, "AsyncClient", return_value=client),
        ):
            text = asyncio.run(asr_regolo.transcribe(b"webm-test", "voice.webm", "audio/webm"))

        self.assertEqual(text, "Привіт, Клод Бот")
        post.assert_awaited_once_with(
            "https://api.regolo.ai/v1/audio/transcriptions",
            headers={"Authorization": "Bearer test-key"},
            data={
                "model": "faster-whisper-large-v3",
                "language": "uk",
                "response_format": "text",
            },
            files={"file": ("voice.webm", b"webm-test", "audio/webm")},
        )

    def test_hotwords_are_sent_as_prompt(self) -> None:
        """
        Терміни з `asr.hotwords` мусять доїжджати до Regolo як `prompt` —
        інакше хмарний шлях чує «клод-код» там, де локальний уже чує «Клод Код».
        """
        response = MagicMock()
        response.headers = {"content-type": "text/plain; charset=utf-8"}
        response.text = "Відкрий Клод Код"
        response.raise_for_status.return_value = None
        post = AsyncMock(return_value=response)
        client = MagicMock()
        client.__aenter__.return_value.post = post

        with (
            patch.object(asr_regolo.cfg, "get_regolo_asr_key", return_value="test-key"),
            patch.object(asr_regolo.cfg, "ASR_HOTWORDS", "Клод Код, Пайпер"),
            patch.object(asr_regolo.httpx, "AsyncClient", return_value=client),
        ):
            asyncio.run(asr_regolo.transcribe(b"webm-test", "voice.webm", "audio/webm"))

        self.assertEqual(post.await_args.kwargs["data"]["prompt"], "Клод Код, Пайпер")

    def test_transcribe_accepts_standard_json_response(self) -> None:
        response = MagicMock()
        response.headers = {"content-type": "application/json"}
        response.json.return_value = {"text": "  Привіт  "}
        response.raise_for_status.return_value = None
        post = AsyncMock(return_value=response)
        client = MagicMock()
        client.__aenter__.return_value.post = post

        with (
            patch.object(asr_regolo.cfg, "get_regolo_asr_key", return_value="test-key"),
            patch.object(asr_regolo.httpx, "AsyncClient", return_value=client),
        ):
            text = asyncio.run(asr_regolo.transcribe(b"ogg-test", "voice.ogg", "audio/ogg"))

        self.assertEqual(text, "Привіт")

    def test_http_failure_is_redacted(self) -> None:
        post = AsyncMock(side_effect=asr_regolo.httpx.TimeoutException("test-key upstream detail"))
        client = MagicMock()
        client.__aenter__.return_value.post = post

        with (
            patch.object(asr_regolo.cfg, "get_regolo_asr_key", return_value="test-key"),
            patch.object(asr_regolo.httpx, "AsyncClient", return_value=client),
        ):
            with self.assertRaisesRegex(RuntimeError, "Regolo ASR недоступний"):
                asyncio.run(asr_regolo.transcribe(b"webm-test"))


class RegoloAsrApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.auth_disabled = patch.object(main.auth_clerk, "is_auth_disabled", return_value=True)
        self.auth_disabled.start()

    def tearDown(self) -> None:
        self.auth_disabled.stop()

    def test_status_exposes_only_enabled_flag(self) -> None:
        with patch.object(main.asr_regolo, "is_available", return_value=True), TestClient(main.app) as client:
            response = client.get("/api/asr/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"enabled": True})

    def test_transcription_preserves_browser_contract(self) -> None:
        transcribe = AsyncMock(return_value="Привіт")
        with (
            patch.object(main.asr_regolo, "is_available", return_value=True),
            patch.object(main.asr_regolo, "transcribe", transcribe),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/api/asr",
                files={"audio": ("voice.webm", b"webm-test", "audio/webm")},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"text": "Привіт"})
        transcribe.assert_awaited_once_with(b"webm-test", "voice.webm", "audio/webm")

    def test_empty_audio_is_bad_request(self) -> None:
        transcribe = AsyncMock()
        with (
            patch.object(main.asr_regolo, "is_available", return_value=True),
            patch.object(main.asr_regolo, "transcribe", transcribe),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/api/asr",
                files={"audio": ("voice.webm", b"", "audio/webm")},
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Порожнє аудіо")
        transcribe.assert_not_awaited()

    def test_asr_requires_authenticated_user_when_clerk_is_enabled(self) -> None:
        with patch.object(main.auth_clerk, "is_auth_disabled", return_value=False), TestClient(main.app) as client:
            response = client.post(
                "/api/asr",
                files={"audio": ("voice.webm", b"webm-test", "audio/webm")},
            )

        self.assertEqual(response.status_code, 401)

    def test_oversized_audio_is_rejected_before_transcription(self) -> None:
        transcribe = AsyncMock()
        with (
            patch.object(main.asr_regolo, "is_available", return_value=True),
            patch.object(main.asr_regolo, "transcribe", transcribe),
            patch.object(main.cfg, "REGOLO_ASR_MAX_UPLOAD_BYTES", 4),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/api/asr",
                files={"audio": ("voice.webm", b"12345", "audio/webm")},
            )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["detail"], "Аудіо завелике")
        transcribe.assert_not_awaited()

    def test_provider_failure_does_not_disclose_upstream_error(self) -> None:
        with (
            patch.object(main.asr_regolo, "is_available", return_value=True),
            patch.object(main.asr_regolo, "transcribe", AsyncMock(side_effect=RuntimeError("test-key upstream detail"))),
            TestClient(main.app) as client,
        ):
            response = client.post(
                "/api/asr",
                files={"audio": ("voice.webm", b"webm-test", "audio/webm")},
            )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"error": "ASR помилка"})
        self.assertNotIn("test-key", response.text)


class RegoloOmniModelsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.auth_disabled = patch.object(main.auth_clerk, "is_auth_disabled", return_value=True)
        self.auth_disabled.start()

    def tearDown(self) -> None:
        self.auth_disabled.stop()

    def test_model_selection_requires_authenticated_user_when_clerk_is_enabled(self) -> None:
        with patch.object(main.auth_clerk, "is_auth_disabled", return_value=False), TestClient(main.app) as client:
            response = client.post("/api/model", json={"model": "regolo/qwen3.6-27b"})

        self.assertEqual(response.status_code, 401)

    def test_configured_models_are_allowlisted_and_unknown_one_is_rejected(self) -> None:
        """
        Суть — сам allowlist: приймаються ЛИШЕ моделі з config.yaml, довільний
        рядок відхиляється. Конкретні id беремо З КОНФІГА, а не хардкодом:
        раніше тут стояли regolo/*, яких у роутері свідомо більше немає
        (див. коментар у config.yaml → omni.models), і тест перевіряв минуле.
        """
        configured = [m["id"] for m in main.cfg.OMNI_MODELS]
        self.assertGreaterEqual(len(configured), 2, "у config.yaml має бути ≥2 моделей Omni")
        primary, backup = configured[0], configured[1]
        original = brains.get_selected_omni_model()
        try:
            with TestClient(main.app) as client:
                models = {item["id"] for item in client.get("/api/models").json()["models"]}
                primary_response = client.post("/api/model", json={"model": primary})
                backup_response = client.post("/api/model", json={"model": backup})
                invalid_response = client.post("/api/model", json={"model": "no-such-provider/not-allowed"})

            self.assertTrue({primary, backup}.issubset(models))
            self.assertEqual(primary_response.status_code, 200)
            self.assertEqual(backup_response.status_code, 200)
            self.assertEqual(invalid_response.status_code, 400)
        finally:
            brains.set_selected_omni_model(original)


if __name__ == "__main__":
    unittest.main()
