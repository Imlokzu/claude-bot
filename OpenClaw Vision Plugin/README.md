# Claude Bot Vision — OpenClaw tool plugin

OpenClaw tool plugin, що дає агенту `vision_check_camera` — можливість "заглянути"
через камеру Клод Бота прямо зараз. Комунікує з **Vision Agent** (сусідня папка
`Vision Agent/`, FastAPI + OpenCV з Кроку 1) через HTTP.

Це та частина, якою ми замінюємо саморобні Кроки 2-3 з `claude-bot-dev-order.md`
(пам'ять, tool use) — їх бере на себе OpenClaw, а цей плагін лише підключає до
нього наш вже готовий і перевірений vision-шар.

## Як це працює

```
Claude Bot (OpenClaw agent) --tool call--> vision_check_camera
                                                  |
                                                  v
                                    GET http://127.0.0.1:8000/vision/snapshot
                                                  |
                                                  v
                                     Vision Agent (main.py, Крок 1)
                                     — захоплює кадр з вебки/CSI-камери,
                                       Haar Cascade + motion detection
```

Агент викликає інструмент, коли користувач питає "що ти бачиш", "чи є хтось
поруч" тощо. Інструмент повертає `{ faces_detected, motion_detected,
motion_score, mode }` — те саме, що віддає `/vision/snapshot`.

## Встановлення

1. Переконайся, що Vision Agent запущений (`Vision Agent/` — `uvicorn main:app`).
2. Збери й перевір плагін:

```bash
npm install
npm run plugin:build      # компілює TS -> dist/, генерує openclaw.plugin.json
npm run plugin:validate   # перевіряє маніфест офіційним OpenClaw CLI
npm test
```

3. Встанови в OpenClaw (з кореня цього пакета):

```bash
openclaw plugins install .
```

4. За потреби вкажи інший baseURL Vision Agent (не `127.0.0.1:8000`) у конфігу
   плагіна Gateway (`~/.openclaw/openclaw.json`):

```json5
{
  plugins: {
    "claude-bot-vision": {
      baseUrl: "http://192.168.1.114:8000",
    },
  },
}
```

5. Перезапусти Gateway — інструмент `vision_check_camera` стане доступний
   агенту.

## Верифіковано

- `npm run plugin:build` + `plugin:validate` — офіційний OpenClaw CLI
  підтвердив, що плагін валідний, `contracts.tools` містить
  `vision_check_camera`.
- Логіку `execute()` (fetch → обробка помилок → парсинг JSON) прогнано проти
  реально запущеного Vision Agent — коректно отримав `/health`, і коректно
  обробив помилку "камера недоступна" (503) у форматі, який очікує агент.

## Файли

- `src/index.ts` — визначення плагіна (`defineToolPlugin`) з інструментом
  `vision_check_camera`
- `openclaw.plugin.json` — згенерований маніфест (не редагувати вручну —
  перегенеровується `plugin:build`)
- `package.json` — залежності й скрипти збірки
