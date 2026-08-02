# Voice Loop — Крок 3, підключений до OpenClaw

Замикає "розумну колонку" на ноуті: мікрофон → локальний STT (faster-whisper)
→ OpenClaw (памʼять, tool use, `vision_check_camera`, сам Claude вже
всередині) → TTS у колонки. Жодного заліза (RPi) не треба — усе на цьому
комп'ютері, як заплановано в `claude-bot-dev-order.md`.

## Схема

```
мікрофон -> record_utterance() -> faster-whisper -> текст
                                                        |
                                                        v
                                    OpenClawClient.send_message()
                                                        |
                                                        v
                        POST http://127.0.0.1:18789/v1/chat/completions
                                                        |
                                                        v
                                              OpenClaw agent (памʼять,
                                              vision_check_camera, Claude)
                                                        |
                                                        v
                                              текст відповіді -> pyttsx3 -> колонки
```

## Передумови

1. OpenClaw запущений (`openclaw onboard --install-daemon`, Gateway працює на
   `127.0.0.1:18789`).
2. Vision Agent + OpenClaw Vision Plugin (сусідні папки) вже підключені —
   тоді бот може відповідати "я бачу когось" через `vision_check_camera`.
3. Увімкнено OpenAI-сумісний ендпоінт у конфігу Gateway
   (`~/.openclaw/openclaw.json`) — за замовчуванням він вимкнений:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

Перезапусти Gateway після зміни.

4. Візьми gateway-токен (`gateway.auth.token` або `OPENCLAW_GATEWAY_TOKEN`) і
   встав у `config.yaml` цього проєкту (`openclaw.token`).

## Встановлення

```bash
pip install -r requirements.txt --break-system-packages
```

На macOS для pyttsx3 додатково нічого не треба (використовує NSSpeechSynthesizer).
На Linux знадобиться `espeak`/`espeak-ng`:

```bash
sudo apt install espeak-ng
```

## Запуск

```bash
python voice_loop.py
```

Говори після "Слухаю…" — фраза завершується автоматично після ~1с тиші.
Вихід — `Ctrl+C`.

## Файли

- `voice_loop.py` — головний цикл: запис мікрофона (RMS-детекція тиші),
  faster-whisper STT, виклик OpenClaw, pyttsx3 TTS
- `openclaw_client.py` — окремий HTTP-клієнт для
  `/v1/chat/completions` OpenClaw (легко тестується без мікрофона)
- `config.yaml` — URL/токен OpenClaw, параметри запису, вибір моделі Whisper,
  TTS
- `requirements.txt` — залежності

## Верифіковано

- `openclaw_client.py` протестовано проти локального mock-сервера, що
  відтворює точний формат відповіді OpenClaw (`choices[0].message.content`)
  — заголовок авторизації і парсинг відповіді підтверджено коректними.
- Обидва файли синтаксично валідні (`py_compile`).
- Захоплення мікрофона, реальна модель Whisper і pyttsx3-озвучення — це вже
  залежить від живого мікрофона/колонок, тому перевіряється безпосередньо на
  твоєму комп'ютері через `python voice_loop.py`.

## Що далі

TTS зараз `pyttsx3` — простий офлайн-MVP з dev-order.md. Коли захочеш
кращий голос, заміни `speak()` на ElevenLabs API або ChatterboxTTS (локально)
— решта пайплайну не зміниться.
