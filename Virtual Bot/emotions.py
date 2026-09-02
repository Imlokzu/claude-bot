"""
«Клод Бот» — Virtual Bot: шар емоцій.

Модель просять починати відповідь тегом [емоція:happy]. Тут ми:
1) парсимо тег і прибираємо його з тексту відповіді;
2) якщо тега нема — вгадуємо емоцію евристикою за ключовими словами
   української відповіді.
"""

from __future__ import annotations

import re

# Дозволені емоції (контракт із фронтендом).
# Останні чотири — «емоції-дії» з анімацією реквізиту (див. crab.js):
ALLOWED_EMOTIONS = {
    "idle", "listening", "thinking", "speaking", "happy",
    "sad", "confused", "surprised", "love", "sleepy",
    "searching",  # копається у файлах/нотатках/результатах пошуку
    "web",        # шукає в інтернеті (крутить веб-кулю)
    "working",    # виконує задачу / кодить (термінал)
    "writing",    # пише нотатку / зберігає в памʼять
    "asking",     # ставить користувачу запитання
    "greeting",   # вітається (махає клешнею)
    "loading",    # статус: щось завантажується/обробляється (спінер)
    "celebrating",# радіє успіху / святкує (конфеті)
    "cool",       # впевнений/незворушний (в окулярах)
}

# Ці стани описують процес, а не настрій після готової відповіді. Якщо модель
# завершила відповідь із тегом working/searching, обличчя не має «працювати» вічно.
TRANSIENT_ACTIVITY_EMOTIONS = {"searching", "web", "working", "writing", "loading", "thinking"}


def settled_emotion(emotion: str) -> str:
    """Емоція для дисплея після завершення запиту."""
    return "idle" if emotion in TRANSIENT_ACTIVITY_EMOTIONS else emotion

# Тег виду [емоція:happy] або [emotion:happy] на початку відповіді.
# Назву ловимо і латиницею, і кирилицею (модель інколи пише «[емоція:щасливий]») —
# такий тег теж треба прибрати з тексту і, за можливості, змапити на дозволену емоцію.
_TAG_RE = re.compile(
    r"\[\s*(?:емоція|емоцiя|emotion)\s*[:：]\s*([a-zA-Zа-яіїєґА-ЯІЇЄҐʼ'-]+)\s*\]",
    re.IGNORECASE,
)

# Українські назви емоцій → дозволені англійські (якщо модель проігнорувала формат)
_UA_EMOTION_MAP = {
    "радісний": "happy", "радість": "happy", "щасливий": "happy", "веселий": "happy",
    "сумний": "sad", "сум": "sad", "смуток": "sad",
    "думаю": "thinking", "задумливий": "thinking", "роздуми": "thinking",
    "слухаю": "listening", "слухання": "listening",
    "говорю": "speaking", "розмова": "speaking",
    "здивований": "surprised", "здивування": "surprised",
    "спантеличений": "confused", "розгублений": "confused",
    "закоханий": "love", "любов": "love", "кохання": "love",
    "сонний": "sleepy", "сплячий": "sleepy",
    "копаюся": "searching", "шукаю": "searching", "пошук": "searching",
    "мережа": "web", "інтернет": "web", "гуглю": "web", "веб": "web",
    "працюю": "working", "робота": "working", "кодую": "working",
    "пишу": "writing", "запис": "writing", "нотатка": "writing",
    "питаю": "asking", "питання": "asking", "запитання": "asking",
    "вітаюся": "greeting", "привіт": "greeting", "вітання": "greeting",
    "завантажую": "loading", "завантаження": "loading", "обробляю": "loading",
    "святкую": "celebrating", "святкування": "celebrating", "ура": "celebrating",
    "крутий": "cool", "круто": "cool", "незворушний": "cool",
    "очікування": "idle", "спокійний": "idle", "нейтральний": "idle",
}

# Евристика: пари (емоція, ключові слова у відповіді). Порядок = пріоритет.
_EMOTION_KEYWORDS: list[tuple[str, list[str]]] = [
    ("love", ["люблю", "обожнюю", "серденьк", "серц", "❤", "💙", "💛"]),
    ("sad", ["сумно", "шкода", "на жаль", "вибач", "прикро", "засмуч", "😢"]),
    ("surprised", ["ого", "вау", "оце так", "несподівано", "дивовижно", "невже", "не може бути"]),
    ("confused", ["не розумію", "не зрозумів", "не впевнений", "не впевнена", "незрозуміло", "спантелич", "важко сказати", "заплутав"]),
    ("sleepy", ["добраніч", "спати", "сонн", "втомив", "втомлен", "сплячий", "дрімат"]),
    ("happy", ["чудово", "супер", "класно", "радий", "рада", "вітаю", "ура", "весело", "прекрасно", "приємно", "🙂", "😊", "😄"]),
    ("thinking", ["думаю", "міркую", "подумати", "поміркув", "цікаве питання", "розмірков", "гіпотез"]),
]


def extract_emotion(reply: str, fallback: str = "speaking") -> tuple[str, str]:
    """
    Повертає (чистий_текст_відповіді, емоція).

    Спершу шукає тег [емоція:...] (де завгодно в тексті — моделі інколи
    ставлять його не з першого символа), прибирає ВСІ такі теги з тексту.
    Якщо валідного тега нема — евристика за ключовими словами.
    """
    emotion: str | None = None

    # Беремо перший ВАЛІДНИЙ тег (модель могла спершу написати невалідний)
    for match in _TAG_RE.finditer(reply):
        candidate = match.group(1).lower()
        candidate = _UA_EMOTION_MAP.get(candidate, candidate)
        if candidate in ALLOWED_EMOTIONS:
            emotion = candidate
            break
    # Прибираємо всі теги емоцій із тексту (навіть невалідні)
    clean = _TAG_RE.sub("", reply).strip()
    # Прибираємо можливий подвійний пробіл після вирізання тега
    clean = re.sub(r"[ \t]{2,}", " ", clean)

    if emotion is None:
        emotion = guess_emotion(clean, fallback=fallback)
    return clean, emotion


class StreamTagFilter:
    """
    Вирізає теги [емоція:…] ПРЯМО В ПОТОЦІ токенів.

    Навіщо: модель починає відповідь тегом, і при стрімінгу користувач бачив
    сирий «[емоція:searching]» перед текстом — тег вирізався лише у фінальній
    відповіді. Тут ми віддаємо текст без тега вже під час друку, а сам тег
    повертаємо окремо, щоб обличчя краба реагувало ОДРАЗУ, а не наприкінці.

    Тег може прийти розірваним між чанками («[емо» + «ція:web]»), тому все
    після останньої незакритої «[» тримаємо в буфері, доки не стане ясно, тег
    це чи звичайний текст. `flush()` наприкінці віддає залишок.
    """

    # Скільки максимум тримаємо «підозрілий» хвіст: довший за будь-який тег
    # фрагмент точно не тег — віддаємо його, щоб текст не завис у буфері.
    _MAX_HOLD = 40

    def __init__(self) -> None:
        self._buffer = ""
        self.emotion: str | None = None

    def feed(self, chunk: str) -> tuple[str, str | None]:
        """Чанк → (видимий текст, нова емоція або None)."""
        self._buffer += chunk or ""
        found: str | None = None

        while True:
            match = _TAG_RE.search(self._buffer)
            if not match:
                break
            candidate = _UA_EMOTION_MAP.get(match.group(1).lower(), match.group(1).lower())
            if self.emotion is None and candidate in ALLOWED_EMOTIONS:
                self.emotion = candidate
                found = candidate
            head, rest = self._buffer[: match.start()], self._buffer[match.end():]
            # На місці вирізаного тега лишалися б два пробіли — а фінальний
            # текст (extract_emotion) їх схлопує; тримаємо потік однаковим.
            if head.endswith((" ", "\t")) and rest.startswith((" ", "\t")):
                rest = rest.lstrip(" \t")
            self._buffer = head + rest

        # Хвіст, який ще може виявитись початком тега, притримуємо
        hold_at = self._buffer.rfind("[")
        if hold_at != -1 and len(self._buffer) - hold_at <= self._MAX_HOLD:
            visible, self._buffer = self._buffer[:hold_at], self._buffer[hold_at:]
        else:
            visible, self._buffer = self._buffer, ""
        return visible, found

    def flush(self) -> str:
        """Залишок буфера (тег так і не склався — це був звичайний текст)."""
        rest, self._buffer = self._buffer, ""
        return rest


def guess_emotion(text: str, fallback: str = "speaking") -> str:
    """Евристика: підбирає емоцію за ключовими словами українського тексту."""
    lowered = text.lower()
    for emotion, keywords in _EMOTION_KEYWORDS:
        if any(kw in lowered for kw in keywords):
            return emotion
    return fallback if fallback in ALLOWED_EMOTIONS else "speaking"
