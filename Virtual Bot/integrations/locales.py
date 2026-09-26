"""
Strings the integrations themselves send to people (not the brain's replies:
those come from the model in whatever language the conversation is in).

Same shape as the screen's i18n: keys, `uk` and `en`, `{name}` placeholders.
The language is the messenger user's own client language when it is one of
ours, Ukrainian otherwise.
"""

from __future__ import annotations

STRINGS: dict[str, dict[str, str]] = {
    "uk": {
        "tg.start": "Привіт! Я Клод Бот. Пиши як у звичайному чаті — це та сама розмова, що й у панелі.\n\n"
                    "Можеш пересилати мені повідомлення з інших чатів: я їх просто збираю й нічого не відповідаю, "
                    "поки ти сам не напишеш, що з ними зробити.\n\n/new — нова розмова\n/go — відповісти на переслане зараз\n/id — твій id",
        "tg.paired": "Готово, я тебе запамʼятав. Тепер це твій чат із ботом.",
        "tg.notPaired": "Я відповідаю лише власнику. Якщо це ти — відкрий панель бота → Інтеграції → Telegram і надішли мені код спарювання: /start КОД\n\nТвій id: {id}",
        "tg.badCode": "Код не підходить. Візьми свіжий у панелі бота.",
        "tg.new": "Нова розмова. Попередня лишилась у панелі.",
        "tg.id": "Твій id: {id}\nЦей чат: {chat}",
        "tg.held": "Отримав {n} пересланих. Напиши, що з ними зробити.",
        "tg.nothingHeld": "Нема нічого пересланого, на що відповідати.",
        "tg.error": "Щось пішло не так: {error}",
        "tg.voiceNote": "голосове {duration}",
        "tg.voiceFailed": "голосове {duration}, не розпізнане",
        "tg.fileNote": "файл {name}, {size}",
        "tg.pkgImported": "Пакет «{label}» {version} додано в магазин. Він чужий, тож працюватиме в пісочниці без мережі.",
        "tg.pkgInstall": "Встановити",
        "tg.pkgInstalled": "Встановлено: {label}. Шукай у застосунках екрана.",
        "tg.pkgFailed": "Пакет не прийнято: {error}",
        "tg.pkgShared": "Пакет «{label}» для екрана Клод Бота. Перешли цей файл своєму боту — він додасть його в магазин.",
        "dc.notPaired": "Я відповідаю лише власнику. Код спарювання — у панелі бота → Інтеграції → Discord: напиши мені `!pair КОД`.",
        "dc.paired": "Готово, тепер я відповідаю тобі тут.",
        "dc.new": "Нова розмова.",
        "google.connected": "Google підключено ({email}). Можна закрити цю вкладку.",
        "google.denied": "Доступ до Google не надано. Можна закрити вкладку й спробувати ще раз із панелі.",
        "google.failed": "Не вдалося підключити Google: {error}",
    },
    "en": {
        "tg.start": "Hi! I'm Claude Bot. Write like in any chat — it's the same conversation as in the panel.\n\n"
                    "You can forward me messages from other chats: I just collect them and stay quiet "
                    "until you write what to do with them.\n\n/new — new conversation\n/go — answer the forwards now\n/id — your id",
        "tg.paired": "Done, I'll remember you. This is now your chat with the bot.",
        "tg.notPaired": "I only answer my owner. If that's you, open the bot panel → Integrations → Telegram and send me the pairing code: /start CODE\n\nYour id: {id}",
        "tg.badCode": "That code doesn't match. Get a fresh one in the bot panel.",
        "tg.new": "New conversation. The previous one stays in the panel.",
        "tg.id": "Your id: {id}\nThis chat: {chat}",
        "tg.held": "Got {n} forwarded. Tell me what to do with them.",
        "tg.nothingHeld": "Nothing forwarded to answer.",
        "tg.error": "Something went wrong: {error}",
        "tg.voiceNote": "voice message {duration}",
        "tg.voiceFailed": "voice message {duration}, not transcribed",
        "tg.fileNote": "file {name}, {size}",
        "tg.pkgImported": "Package “{label}” {version} added to the store. It's from someone else, so it runs sandboxed and offline.",
        "tg.pkgInstall": "Install",
        "tg.pkgInstalled": "Installed: {label}. Find it in the screen's apps.",
        "tg.pkgFailed": "Package rejected: {error}",
        "tg.pkgShared": "A “{label}” package for the Claude Bot screen. Forward this file to your own bot and it will add it to the store.",
        "dc.notPaired": "I only answer my owner. The pairing code is in the bot panel → Integrations → Discord: send me `!pair CODE`.",
        "dc.paired": "Done, I'll answer you here now.",
        "dc.new": "New conversation.",
        "google.connected": "Google connected ({email}). You can close this tab.",
        "google.denied": "Google access was not granted. Close this tab and try again from the panel.",
        "google.failed": "Could not connect Google: {error}",
    },
}


def pick_lang(code: str | None) -> str:
    code = (code or "").lower()[:2]
    return code if code in STRINGS else "uk"


def t(lang: str, key: str, **values: object) -> str:
    text = STRINGS.get(lang, {}).get(key) or STRINGS["uk"].get(key) or key
    for name, value in values.items():
        text = text.replace("{" + name + "}", str(value))
    return text
