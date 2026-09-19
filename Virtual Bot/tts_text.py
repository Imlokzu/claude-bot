"""
«Клод Бот» — підготовка тексту до озвучки (спільна для всіх TTS-провайдерів).

Навіщо окремий модуль: чистка потрібна ОДНАКОВА і Piper'у, і ElevenLabs, а
далі шляхи розходяться — Piper вимагає нижнього регістру й наголосів, а
ElevenLabs, навпаки, читає звичайний текст із великими літерами краще.

Головне тут — посилання. Модель, яка бачить «https://youtu.be/nXS4aZs_Ao4»,
читає його вголос по символах: «ейч-ті-ті-пі-ес двокрапка слеш слеш…» — і так
хвилину на кожен лінк у відповіді. У мовленні посилання не несе змісту
(натиснути на нього голосом не можна), тому воно ЗНИКАЄ, а підпис із
markdown-лінка лишається текстом.
"""
from __future__ import annotations

import re

# ![підпис](url) і [підпис](url) → лишаємо лише підпис
_MD_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\(\s*<?[^)\s]+>?[^)]*\)")
_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(\s*<?[^)\s]+>?[^)]*\)")

# Голі посилання: зі схемою, з www, і короткі youtu.be/… без схеми.
_BARE_URL_RE = re.compile(
    r"(?:https?://|www\.|(?:youtu\.be|t\.me|bit\.ly)/)\S+",
    flags=re.IGNORECASE,
)

# Технічні рядки в дужках, що лишились від посилань: «()», «( )», «(…)»
_EMPTY_PARENS_RE = re.compile(r"\(\s*[—–-]?\s*\)")

# Розмітка, яку не читають: ** _ ` # > і залишки таблиць
_MD_MARKS_RE = re.compile(r"[*_`#>|]+")
_MD_BULLET_RE = re.compile(r"^\s*[-+*]\s+", flags=re.MULTILINE)
_MD_RULE_RE = re.compile(r"^\s*(?:[-=_]\s*){3,}$", flags=re.MULTILINE)

_EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF←-⇿⌀-⏿]",
    flags=re.UNICODE,
)


def strip_links(text: str) -> str:
    """Прибирає посилання, лишаючи підписи markdown-лінків."""
    text = _MD_IMAGE_RE.sub(r"\1", text)
    text = _MD_LINK_RE.sub(r"\1", text)
    text = _BARE_URL_RE.sub("", text)
    return _EMPTY_PARENS_RE.sub("", text)


def clean_for_speech(text: str, *, drop_emoji: bool = True) -> str:
    """
    Текст → те, що має сенс вимовляти: без посилань, розмітки й емодзі.

    Регістр НЕ трогаємо — це вирішує сам провайдер (Piper переводить у
    нижній, бо його phoneme-мапа не має великих кириличних літер).
    """
    out = str(text or "")
    out = strip_links(out)
    out = _MD_RULE_RE.sub(" ", out)
    out = _MD_BULLET_RE.sub("", out)
    out = _MD_MARKS_RE.sub("", out)
    if drop_emoji:
        out = _EMOJI_RE.sub("", out)
    # Розділові знаки, що лишились самі: « — .» на початку рядка тощо
    out = re.sub(r"\s+([,.!?;:…])", r"\1", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out
