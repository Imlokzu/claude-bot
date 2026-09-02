"use strict";

/* ============================================================
   Клод Бот — ЕКРАН: мови інтерфейсу (uk / en)

   Навіщо окремий модуль: на 320×240 кожен напис підібраний по довжині,
   тож переклад — це не «підставити слово», а другий комплект підписів,
   який має влазити в ті самі кнопки. Тримаємо їх поруч, ключ у ключ.

   Як користуватись:
     t("state.head")                    — рядок поточною мовою;
     t("ago.min", { n: 5 })             — підстановка {n};
     applyStatic()                      — розставляє тексти в HTML за
                                          data-i18n / -title / -aria / -alt;
     setLang("en") + onLangChange(fn)   — зміна мови та реакція на неї.

   Мова живе в localStorage (botScreenLang) — як і решта параметрів екрана,
   тобто на самому пристрої, без походу на сервер. Типова — українська:
   бот україномовний, англійська вмикається свідомо.
   ============================================================ */

export const LANG_KEY = "botScreenLang";

/* Назви мов НЕ перекладаються (як у телефонах): кожна написана собою,
   інакше в чужомовному інтерфейсі свою мову не знайдеш. */
export const LANGS = [
  { value: "uk", label: "Українська" },
  { value: "en", label: "English" },
];

const FALLBACK = "uk";

const DICT = {
  uk: {
    /* ---- спільне ---- */
    "common.back": "Назад ✕",
    "common.loading": "Завантаження…",
    "common.refresh": "Оновити",
    "common.none": "нема",
    "common.untitled": "Без назви",

    /* ---- циферблат ---- */
    "app.title": "Клод Бот — Екран",
    "face.link": "Звʼязок із ботом",
    "face.mic": "Говорити",
    "face.seeYou": "бачу тебе",
    "face.seeNobody": "нікого не бачу",

    /* ---- дата й свіжість ---- */
    "ago.now": "щойно",
    "ago.min": "{n} хв тому",
    "ago.hour": "{n} год тому",
    "ago.day": "{n} дн тому",
    "ago.updated": "оновлено {ago}",

    /* ---- тайл «Бот сказав» ---- */
    "say.head": "Бот сказав",
    "say.empty": "Поки тиша.",
    "say.noText": "(без тексту)",

    /* ---- тайл «Стан» ---- */
    "state.head": "Стан",
    "state.brain": "Мозок",
    "state.vision": "Зір",
    "state.display": "Дисплей",
    "state.link": "Звʼязок",
    "state.online": "онлайн",
    "state.offline": "офлайн",
    "state.alive": "живий",
    "state.noLink": "нема звʼязку",
    "state.demo": "демо",
    "state.nobrain": "нема мозку",
    "state.running": "працює",
    "state.stopped": "зупинено",

    /* ---- розмова ---- */
    "chat.title": "Розмова",
    "chat.new": "Нова розмова",
    "chat.empty": "Натисни мікрофон і говори.",
    "chat.emptyReply": "(порожня відповідь)",
    "chat.brainError": "помилка мозку",
    "chat.sessions": "Розмови",
    "chat.sessionsEmpty": "Розмов ще немає.",
    "chat.sessionsFailed": "Не вдалося завантажити список.",
    "chat.you": "Ти",
    "chat.bot": "Бот",

    /* ---- голос ---- */
    "voice.unavailable": "Голос недоступний",
    "voice.speak": "Говорити",
    "voice.pause": "Пауза",
    "voice.listening": "Слухаю…",
    "voice.listeningAll": "Слухаю все",
    "voice.waitingWord": "Чекаю «{word}»",
    "voice.yes": "так?",
    "voice.recognizing": "(розпізнаю…)",
    "voice.afterPause": "(слухаю — текст зʼявиться після паузи)",
    "voice.continuousFailed": "Безперервне слухання не запустилось",
    "voice.defaultWake": "клод",
    /* Код мови для браузерного розпізнавання мовлення */
    "speech.lang": "uk-UA",

    /* ---- режим розмови ---- */
    "mode.head": "Режим розмови",
    "mode.push": "Поговорити",
    "mode.push.hint": "Тиснеш — кажеш фразу — бот відповідає",
    "mode.open": "Слухає завжди",
    "mode.open.hint": "Мікрофон відкритий, кожна фраза йде боту",
    "mode.wake": "Ключове слово",
    "mode.wake.hint": "Реагує лише після свого імені",

    /* ---- швидкі дії ---- */
    "quick.head": "Швидкі дії",
    "quick.edit": "Переставити плитки",
    "quick.hint": "Торкнись двох плиток, щоб поміняти їх місцями",
    "quick.bright": "Яскравість",
    "quick.volume": "Гучність",
    "quick.sleep": "Сон",
    "quick.theme": "Тема",
    "quick.voice": "Голос",
    "quick.speed": "Темп",
    "quick.screens": "Екрани",
    "quick.settings": "Налаштування",
    "quick.full": "На весь",
    "quick.reload": "Перезапуск",

    /* ---- шухляда й екрани ---- */
    "apps.head": "Застосунки",
    "app.head": "Застосунок",
    "screen.face": "Обличчя",
    "screen.clock": "Годинник",
    "screen.chat": "Розмова",
    "screen.say": "Репліка",
    "screen.state": "Стан",
    "screen.quick": "Швидкі дії",
    "screen.camera": "Камера",
    "screen.services": "Сервіси",
    "screen.panel": "Панель",
    "screen.settings": "Налаштування",
    "screen.memory": "Памʼять",
    "screen.chats": "Розмови",
    "screen.store": "Магазин",

    /* ---- камера ---- */
    "cam.checking": "Перевіряю зір…",
    "cam.stream": "Потік камери",
    "cam.failed": "Потік не відкрився.",
    "cam.live": "Живий потік",
    "cam.off": "Зір вимкнено.",
    "cam.start": "Запустити зір",
    "cam.starting": "Запускаю…",
    "cam.startFailed": "Не вдалося запустити.",
    "cam.noLink": "Немає звʼязку з ботом.",

    /* ---- сервіси ---- */
    "svc.vision": "Зір (камера)",
    "svc.display": "Дисплей",
    "svc.start": "Старт",
    "svc.stop": "Стоп",
    "svc.starting": "запускаю…",
    "svc.stopping": "зупиняю…",
    "svc.note": "Сервіси живуть на тому ж комп’ютері, що й мозок.",

    /* ---- памʼять і історія ---- */
    "mem.reading": "Читаю нотатку…",
    "mem.note": "Нотатка",
    "mem.noteEmpty": "Нотатка порожня.",
    "mem.noteOpened": "Нотатку відкрито",
    "mem.empty": "Нотаток ще немає.",
    "mem.storeEmpty": "Памʼять порожня",
    "mem.count": "Нотаток: {n}",
    "mem.subjNote": "нотатку",
    "mem.subjMemory": "памʼять",
    "mem.noAccess": "Немає доступу",
    "hist.reading": "Читаю розмову…",
    "hist.messagesEmpty": "Повідомлень ще немає.",
    "hist.messagesCount": "Повідомлень: {n}",
    "hist.empty": "Збережених розмов ще немає.",
    "hist.storeEmpty": "Історія порожня",
    "hist.count": "Розмов: {n}",
    "hist.messages": "{n} повідомлень",
    "hist.subjChat": "розмови",
    "hist.subjHistory": "історію розмов",
    "err.needLogin": "Потрібен вхід у панелі, щоб читати {subject}.",
    "err.forbidden": "Немає доступу до {subject}.",
    "err.failed": "Не вдалося завантажити {subject}.",

    /* ---- панель ---- */
    "panel.botState": "Стан бота",
    "panel.local": "оновлюється локально",

    /* ---- налаштування ---- */
    "set.appearance": "Вигляд",
    "set.appearance.hint": "застосовується одразу",
    "set.lang": "Мова",
    "set.lang.hint": "написи на екрані та розпізнавання мовлення",
    "set.iconStyle": "Стиль іконок",
    "set.iconStyle.hint": "Піксельні, однотонні або кольорові",
    "set.color": "Колір",
    "set.color.hint": "для однотонних і дрібних кнопок",
    "set.customColor": "власний",
    "set.theme": "Тема",
    "set.theme.hint": "фон екрана і шторок",
    "set.theme.dark": "Темна",
    "set.theme.light": "Світла",
    "set.display": "Екран",
    "set.display.hint": "ті самі значення, що й у швидких діях",
    "set.bright": "Яскравість",
    "set.bright.hint": "15–100% без зміни системних налаштувань",
    "set.behavior": "Поведінка",
    "set.behavior.hint": "локальні параметри пристрою",
    "set.home": "Повернення додому",
    "set.home.hint": "після бездіяльності",
    "set.sleep": "Автосон",
    "set.sleep.hint": "затемнює екран і повертає додому",
    "set.clock": "Формат часу",
    "set.clock.hint": "на циферблаті",
    "set.date": "Дата",
    "set.date.hint": "під годинником",
    "set.date.on": "Показувати",
    "set.date.off": "Приховано",
    "set.motion": "Анімації",
    "set.motion.hint": "плавні переходи та pulse мікрофона",
    "set.motion.on": "Повні",
    "set.motion.off": "Мінімальні",
    "set.audio": "Голос",
    "set.audio.hint": "локальний Piper, якщо модель доступна",
    "set.tts": "Озвучення",
    "set.tts.hint": "бот говорить відповіді через браузер",
    "set.volume": "Гучність",
    "set.volume.hint": "гучність наступних відповідей",
    "set.piper": "Голос Piper",
    "set.piper.hint": "зберігається на сервері для наступних озвучок",
    "set.saved": "збережено",
    "set.saveFailed": "не вдалося зберегти",
    "set.ttsOffline": "сервіс недоступний",
    "set.testVoice": "Перевірити голос",
    "set.testSpeaking": "Говорю тестову фразу…",
    "set.testPhrase": "Налаштування голосу працюють.",
    "set.testDone": "Тест завершено.",
    "set.actions": "Дії",
    "set.actions.hint": "локальні параметри цього екрана",
    "set.reset": "Скинути налаштування екрана",
    "set.resetAsk": "Скинути тему, яскравість, голос і стиль іконок?",
    "set.resetDone": "Параметри повернуто до початкових.",
    "set.unavailable": "Недоступно",
    "set.enabled": "Увімкнено",
    "set.disabled": "Вимкнено",
    "set.attribution": "Піксельні іконки: ",

    /* ---- вибір іконок ---- */
    "icons.head": "Іконки",
    "icons.pixel": "Наші (піксельні)",
    "icons.pixel.hint": "Одна мова з крабом і годинником",
    "icons.line": "Звичайні",
    "icons.line.hint": "Контурні, як у телефоні",
    "icons.color": "Кольорові",
    "icons.color.hint": "Ті самі, але кожна у своєму відтінку",
    "iconstyle.pixel": "Піксельні",
    "iconstyle.line": "Однотонні",
    "iconstyle.color": "Кольорові",
    "tint.coral": "Кораловий",
    "tint.blue": "Блакитний",
    "tint.green": "Зелений",
    "tint.purple": "Фіолетовий",
    "tint.gold": "Золотий",
    "tint.teal": "Бірюзовий",

    /* ---- варіанти списків ---- */
    "opt.sec": "{n} секунд",
    "opt.noHome": "Не повертати",
    "opt.min1": "1 хвилина",
    "opt.min3": "3 хвилини",
    "opt.min5": "5 хвилин",
    "opt.noSleep": "Не засинати",
    "opt.h24": "24 години",
    "opt.h12": "12 годин",

    /* ---- музика ---- */
    "music.head": "Музика",
    "music.source": "Джерело музики",
    "music.radio": "Радіо",
    "music.off": "Музика вимкнена",
    "music.hintOff": "тапни ✕-іконку зліва або попроси бота",
    "music.liveStream": "живий стрім",
    "music.seek": "Позиція трека",
    "music.prev": "Попередній",
    "music.playPause": "Грати/пауза",
    "music.next": "Наступний",
    "music.streamDied": "Стрім обірвався",
    "music.radioOffline": "Радіо недоступне.",
    "music.queueHint": "Попроси бота: «Клод, увімкни Океан Ельзи» — тут з'явиться черга.",

    /* ---- магазин ---- */
    "store.apps": "Додатки",
    "store.skins": "Скіни",
    "store.skills": "Скіли",
    "store.mcp": "Тулзи",
    "store.empty": "Каталог порожній.",
    "store.open": "Відкрити",
    "store.get": "Взяти",
    "store.remove": "Прибрати",
    "store.apply": "Застосувати",
    "store.unapply": "Зняти",
    "store.badgeOn": "увімк.",
    "store.badgeHave": "є",
    "store.openclawDown": "OpenClaw недоступний: {error}",
    "store.noSkills": "Скіл не знайдено.",
    "store.noMcp": "Каталог тулзів порожній.",
    "store.installFailed": "Не встановилось",
    "store.offline": "Магазин недоступний.",
    "store.skin": "Скін: {name}",

    /* ---- підписи емоцій краба ---- */
    "emo.idle": "Очікування",
    "emo.listening": "Слухаю",
    "emo.thinking": "Думаю",
    "emo.speaking": "Говорю",
    "emo.happy": "Радісний",
    "emo.sad": "Сумний",
    "emo.confused": "Спантеличений",
    "emo.surprised": "Здивований",
    "emo.love": "Закоханий",
    "emo.sleepy": "Сонний",
    "emo.searching": "Копаюся",
    "emo.web": "Шукаю в мережі",
    "emo.working": "Працюю",
    "emo.writing": "Пишу",
    "emo.asking": "Питаю",
    "emo.greeting": "Вітаюся",
    "emo.loading": "Завантажую",
    "emo.celebrating": "Святкую",
    "emo.cool": "Крутий",
    "emo.ball": "Граю мʼячем",
    "emo.basketball": "Баскетбол",
    "emo.reading": "Читає книгу",
    "emo.defeat": "Збій…",
  },

  en: {
    "common.back": "Back ✕",
    "common.loading": "Loading…",
    "common.refresh": "Refresh",
    "common.none": "none",
    "common.untitled": "Untitled",

    "app.title": "Claude Bot — Screen",
    "face.link": "Link to the bot",
    "face.mic": "Talk",
    "face.seeYou": "I see you",
    "face.seeNobody": "nobody around",

    "ago.now": "just now",
    "ago.min": "{n} min ago",
    "ago.hour": "{n} h ago",
    "ago.day": "{n} d ago",
    "ago.updated": "updated {ago}",

    "say.head": "Bot said",
    "say.empty": "Silence so far.",
    "say.noText": "(no text)",

    "state.head": "Status",
    "state.brain": "Brain",
    "state.vision": "Vision",
    "state.display": "Display",
    "state.link": "Link",
    "state.online": "online",
    "state.offline": "offline",
    "state.alive": "alive",
    "state.noLink": "no link",
    "state.demo": "demo",
    "state.nobrain": "no brain",
    "state.running": "running",
    "state.stopped": "stopped",

    "chat.title": "Chat",
    "chat.new": "New chat",
    "chat.empty": "Tap the mic and speak.",
    "chat.emptyReply": "(empty reply)",
    "chat.brainError": "brain error",
    "chat.sessions": "Chats",
    "chat.sessionsEmpty": "No chats yet.",
    "chat.sessionsFailed": "Could not load the list.",
    "chat.you": "You",
    "chat.bot": "Bot",

    "voice.unavailable": "Voice unavailable",
    "voice.speak": "Talk",
    "voice.pause": "Pause",
    "voice.listening": "Listening…",
    "voice.listeningAll": "Listening to all",
    "voice.waitingWord": "Waiting for “{word}”",
    "voice.yes": "yes?",
    "voice.recognizing": "(recognizing…)",
    "voice.afterPause": "(listening — text appears after a pause)",
    "voice.continuousFailed": "Continuous listening did not start",
    "voice.defaultWake": "claude",
    "speech.lang": "en-US",

    "mode.head": "Chat mode",
    "mode.push": "Push to talk",
    "mode.push.hint": "Press — say a phrase — the bot answers",
    "mode.open": "Always listening",
    "mode.open.hint": "Mic stays open, every phrase goes to the bot",
    "mode.wake": "Wake word",
    "mode.wake.hint": "Reacts only after its own name",

    "quick.head": "Quick actions",
    "quick.edit": "Rearrange tiles",
    "quick.hint": "Tap two tiles to swap them",
    "quick.bright": "Brightness",
    "quick.volume": "Volume",
    "quick.sleep": "Sleep",
    "quick.theme": "Theme",
    "quick.voice": "Voice",
    "quick.speed": "Speed",
    "quick.screens": "Screens",
    "quick.settings": "Settings",
    "quick.full": "Full screen",
    "quick.reload": "Restart",

    "apps.head": "Apps",
    "app.head": "App",
    "screen.face": "Face",
    "screen.clock": "Clock",
    "screen.chat": "Chat",
    "screen.say": "Reply",
    "screen.state": "Status",
    "screen.quick": "Quick actions",
    "screen.camera": "Camera",
    "screen.services": "Services",
    "screen.panel": "Panel",
    "screen.settings": "Settings",
    "screen.memory": "Memory",
    "screen.chats": "Chats",
    "screen.store": "Store",

    "cam.checking": "Checking vision…",
    "cam.stream": "Camera stream",
    "cam.failed": "Stream did not open.",
    "cam.live": "Live stream",
    "cam.off": "Vision is off.",
    "cam.start": "Start vision",
    "cam.starting": "Starting…",
    "cam.startFailed": "Could not start.",
    "cam.noLink": "No link to the bot.",

    "svc.vision": "Vision (camera)",
    "svc.display": "Display",
    "svc.start": "Start",
    "svc.stop": "Stop",
    "svc.starting": "starting…",
    "svc.stopping": "stopping…",
    "svc.note": "Services live on the same computer as the brain.",

    "mem.reading": "Reading the note…",
    "mem.note": "Note",
    "mem.noteEmpty": "The note is empty.",
    "mem.noteOpened": "Note opened",
    "mem.empty": "No notes yet.",
    "mem.storeEmpty": "Memory is empty",
    "mem.count": "Notes: {n}",
    "mem.subjNote": "the note",
    "mem.subjMemory": "memory",
    "mem.noAccess": "No access",
    "hist.reading": "Reading the chat…",
    "hist.messagesEmpty": "No messages yet.",
    "hist.messagesCount": "Messages: {n}",
    "hist.empty": "No saved chats yet.",
    "hist.storeEmpty": "History is empty",
    "hist.count": "Chats: {n}",
    "hist.messages": "{n} messages",
    "hist.subjChat": "the chat",
    "hist.subjHistory": "chat history",
    "err.needLogin": "Sign in on the panel to read {subject}.",
    "err.forbidden": "No access to {subject}.",
    "err.failed": "Could not load {subject}.",

    "panel.botState": "Bot status",
    "panel.local": "updates locally",

    "set.appearance": "Appearance",
    "set.appearance.hint": "applies right away",
    "set.lang": "Language",
    "set.lang.hint": "screen labels and speech recognition",
    "set.iconStyle": "Icon style",
    "set.iconStyle.hint": "Pixel, single-tone or colored",
    "set.color": "Color",
    "set.color.hint": "for single-tone and small buttons",
    "set.customColor": "custom",
    "set.theme": "Theme",
    "set.theme.hint": "screen and sheet background",
    "set.theme.dark": "Dark",
    "set.theme.light": "Light",
    "set.display": "Screen",
    "set.display.hint": "same values as in quick actions",
    "set.bright": "Brightness",
    "set.bright.hint": "15–100% without touching system settings",
    "set.behavior": "Behavior",
    "set.behavior.hint": "local device options",
    "set.home": "Return home",
    "set.home.hint": "after idling",
    "set.sleep": "Auto sleep",
    "set.sleep.hint": "dims the screen and returns home",
    "set.clock": "Time format",
    "set.clock.hint": "on the watch face",
    "set.date": "Date",
    "set.date.hint": "under the clock",
    "set.date.on": "Shown",
    "set.date.off": "Hidden",
    "set.motion": "Animations",
    "set.motion.hint": "smooth transitions and mic pulse",
    "set.motion.on": "Full",
    "set.motion.off": "Minimal",
    "set.audio": "Voice",
    "set.audio.hint": "local Piper, if the model is available",
    "set.tts": "Speech",
    "set.tts.hint": "the bot speaks its replies through the browser",
    "set.volume": "Volume",
    "set.volume.hint": "volume of the next replies",
    "set.piper": "Piper voice",
    "set.piper.hint": "saved on the server for the next replies",
    "set.saved": "saved",
    "set.saveFailed": "could not save",
    "set.ttsOffline": "service unavailable",
    "set.testVoice": "Test the voice",
    "set.testSpeaking": "Speaking a test phrase…",
    "set.testPhrase": "Voice settings are working.",
    "set.testDone": "Test finished.",
    "set.actions": "Actions",
    "set.actions.hint": "local options of this screen",
    "set.reset": "Reset screen settings",
    "set.resetAsk": "Reset theme, brightness, voice and icon style?",
    "set.resetDone": "Options restored to defaults.",
    "set.unavailable": "Unavailable",
    "set.enabled": "On",
    "set.disabled": "Off",
    "set.attribution": "Pixel icons: ",

    "icons.head": "Icons",
    "icons.pixel": "Ours (pixel)",
    "icons.pixel.hint": "Same language as the crab and the clock",
    "icons.line": "Plain",
    "icons.line.hint": "Outlined, like on a phone",
    "icons.color": "Colored",
    "icons.color.hint": "The same ones, each in its own tint",
    "iconstyle.pixel": "Pixel",
    "iconstyle.line": "Single-tone",
    "iconstyle.color": "Colored",
    "tint.coral": "Coral",
    "tint.blue": "Blue",
    "tint.green": "Green",
    "tint.purple": "Purple",
    "tint.gold": "Gold",
    "tint.teal": "Teal",

    "opt.sec": "{n} seconds",
    "opt.noHome": "Never",
    "opt.min1": "1 minute",
    "opt.min3": "3 minutes",
    "opt.min5": "5 minutes",
    "opt.noSleep": "Never",
    "opt.h24": "24 hours",
    "opt.h12": "12 hours",

    "music.head": "Music",
    "music.source": "Music source",
    "music.radio": "Radio",
    "music.off": "Music is off",
    "music.hintOff": "tap the ✕ icon on the left or ask the bot",
    "music.liveStream": "live stream",
    "music.seek": "Track position",
    "music.prev": "Previous",
    "music.playPause": "Play/pause",
    "music.next": "Next",
    "music.streamDied": "Stream dropped",
    "music.radioOffline": "Radio unavailable.",
    "music.queueHint": "Ask the bot: “Claude, play Radiohead” — the queue shows up here.",

    "store.apps": "Apps",
    "store.skins": "Skins",
    "store.skills": "Skills",
    "store.mcp": "Tools",
    "store.empty": "The catalog is empty.",
    "store.open": "Open",
    "store.get": "Get",
    "store.remove": "Remove",
    "store.apply": "Apply",
    "store.unapply": "Unapply",
    "store.badgeOn": "on",
    "store.badgeHave": "got",
    "store.openclawDown": "OpenClaw unavailable: {error}",
    "store.noSkills": "No skills found.",
    "store.noMcp": "The tool catalog is empty.",
    "store.installFailed": "Install failed",
    "store.offline": "Store unavailable.",
    "store.skin": "Skin: {name}",

    "emo.idle": "Idle",
    "emo.listening": "Listening",
    "emo.thinking": "Thinking",
    "emo.speaking": "Speaking",
    "emo.happy": "Happy",
    "emo.sad": "Sad",
    "emo.confused": "Confused",
    "emo.surprised": "Surprised",
    "emo.love": "In love",
    "emo.sleepy": "Sleepy",
    "emo.searching": "Digging",
    "emo.web": "Searching the web",
    "emo.working": "Working",
    "emo.writing": "Writing",
    "emo.asking": "Asking",
    "emo.greeting": "Greeting",
    "emo.loading": "Loading",
    "emo.celebrating": "Celebrating",
    "emo.cool": "Cool",
    "emo.ball": "Playing ball",
    "emo.basketball": "Basketball",
    "emo.reading": "Reading a book",
    "emo.defeat": "Crash…",
  },
};

/* Дні й місяці окремо від DICT: це масиви, а не рядки, і порядок «число —
   місяць — день тижня» у мовах різний, тож дату збирає fmtDate(). */
const DATE_PARTS = {
  uk: {
    weekdays: ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"],
    months: ["січня", "лютого", "березня", "квітня", "травня", "червня",
      "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"],
    format: (d, m, w) => d + " " + m + ", " + w,
  },
  en: {
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    months: ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"],
    format: (d, m, w) => w + ", " + m + " " + d,
  },
};

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return DICT[v] ? v : FALLBACK;
  } catch (e) {
    return FALLBACK;
  }
}

let lang = readLang();
const listeners = [];

export function getLang() {
  return lang;
}

/* Зміна мови: пишемо в localStorage, оновлюємо <html lang> (для екранних
   читалок і переносів) і будимо слухачів — саме вони перемальовують UI. */
export function setLang(next) {
  if (!DICT[next] || next === lang) return false;
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch (e) { /* приватний режим */ }
  document.documentElement.lang = next;
  listeners.forEach((fn) => { try { fn(next); } catch (e) { /* слухач не має ламати решту */ } });
  return true;
}

export function onLangChange(fn) {
  if (typeof fn === "function") listeners.push(fn);
}

/* Рядок поточною мовою. Невідомий ключ повертаємо як є — на екрані одразу
   видно, що щось забули, і нічого не зникає мовчки. */
export function t(key, vars) {
  const table = DICT[lang] || DICT[FALLBACK];
  let s = table[key];
  if (s === undefined) s = DICT[FALLBACK][key];
  if (s === undefined) return key;
  if (vars) {
    for (const name in vars) s = s.split("{" + name + "}").join(String(vars[name]));
  }
  return s;
}

/* Підписи емоцій краба одним обʼєктом — крабу віддаємо їх цілим набором */
export function emotionLabels() {
  const table = DICT[lang] || DICT[FALLBACK];
  const out = {};
  for (const key in table) {
    if (key.startsWith("emo.") && key !== "emo.defeat") out[key.slice(4)] = table[key];
  }
  return out;
}

export function fmtDate(date) {
  const parts = DATE_PARTS[lang] || DATE_PARTS[FALLBACK];
  return parts.format(date.getDate(), parts.months[date.getMonth()], parts.weekdays[date.getDay()]);
}

/* Статичні написи в HTML: data-i18n (текст), -title, -aria, -alt.
   Так index.html лишається читабельним, а переклад — в одному місці. */
export function applyStatic(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle);
  });
  scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAria));
  });
  const title = document.querySelector("title");
  if (title) title.textContent = t("app.title");
  document.documentElement.lang = lang;
}
