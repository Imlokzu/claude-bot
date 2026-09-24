"""
Shape a raw bot reply into chat bubbles and an optional emoji reaction.

The bot talks like a person in a messenger: several short messages instead
of one wall of text, and sometimes nothing but a reaction to what you said.
The model marks that up itself with two tags (taught in the OpenClaw
workspace persona, SOUL.md):

    [[msg]]        start a new bubble
    [react:👍]     react to the user's message with this emoji

Neither tag may ever reach a human, a speaker or the device screen, so every
path that shows or speaks a reply goes through `shape()` / `plain()` here, and
the live token stream goes through `BubbleStream`.
"""

from __future__ import annotations

import re
import unicodedata

SPLIT_MARKER = "[[msg]]"

# Tolerant on purpose: models add spaces and change case inside tags.
_SPLIT_RE = re.compile(r"\[\[\s*msg\s*\]\]", re.IGNORECASE)
_REACT_RE = re.compile(r"\[\s*react\s*[:：]\s*([^\]\s]{1,16})\s*\]", re.IGNORECASE)
# The emotion tag is metadata for the face, not part of a bubble. A reply
# that is only "[емоція:happy] 😊" is still just an emoji.
_EMOTION_TAG_RE = re.compile(
    r"\[\s*(?:emotion|емоц[іiи]я|эмоция)\s*[:：]\s*[^\]\s]+\s*\]", re.IGNORECASE,
)

# Longest tail the stream may hold back while it waits to see whether an open
# "[" becomes a tag. Anything longer is plain text and must not stall.
_MAX_HOLD = 28


def is_emoji(value: str) -> bool:
    """
    A reaction is one emoji, possibly with modifiers (skin tone, ZWJ sequence,
    variation selector, flag pair). Letters, digits and ASCII punctuation are
    refused: `[react:ok]` from a confused model must not show up as a "reaction".
    """
    text = (value or "").strip()
    if not text or len(text) > 16:
        return False
    clusters = 0
    previous = ""
    pending_flag = False
    for ch in text:
        if ch.isascii() or ch.isalnum() or ch.isspace():
            return False
        category = unicodedata.category(ch)
        if category == "So":
            if 0x1F1E6 <= ord(ch) <= 0x1F1FF:
                # A flag is two regional indicators; count the pair once.
                if not pending_flag:
                    clusters += 1
                pending_flag = not pending_flag
            elif previous != "\u200d":
                clusters += 1
        elif category not in ("Mn", "Me", "Cf", "Sk"):
            # Mn/Me: variation selectors and keycaps, Cf: ZWJ, Sk: skin tones.
            return False
        previous = ch
    return clusters == 1


def extract_reaction(text: str) -> tuple[str, str | None]:
    """Remove every reaction tag; return the text and the first valid emoji."""
    reaction: str | None = None
    for match in _REACT_RE.finditer(text or ""):
        if is_emoji(match.group(1)):
            reaction = match.group(1).strip()
            break
    return _REACT_RE.sub("", text or ""), reaction


def split(text: str) -> list[str]:
    """Split on the bubble marker, dropping empty bubbles."""
    return [part.strip() for part in _SPLIT_RE.split(text or "") if part.strip()]


def shape(text: str) -> tuple[list[str], str | None]:
    """Raw reply → (bubbles, reaction). An empty list means "reaction only"."""
    clean, reaction = extract_reaction(text)
    bubbles = split(clean)
    if reaction is not None:
        return bubbles, reaction
    # A reply that is nothing but an emoji was meant for the person's
    # message. A bubble that only contains "😊" does not stick to it.
    stripped = [b for b in (_EMOTION_TAG_RE.sub("", b).strip() for b in bubbles) if b]
    lone = [b for b in stripped if is_emoji(b)]
    words = [b for b in stripped if not is_emoji(b)]
    if len(lone) == 1:
        return words, lone[0]
    return bubbles, None


def plain(text: str) -> str:
    """The reply as one readable text, for voice, the device screen and search."""
    return "\n\n".join(shape(text)[0])


def trim_open_tag(text: str) -> str:
    """
    Cut a trailing, still-unclosed "[..." off a cumulative text snapshot.

    Narration arrives as a growing snapshot rather than as deltas, so a tag
    can be caught half-written ("Зараз гляну [[ms"). Showing that for 80 ms
    and then snapping it away reads as a glitch.
    """
    at = text.rfind("[")
    if at != -1 and "]" not in text[at:] and len(text) - at <= _MAX_HOLD + 12:
        # "[[msg" — cut from the first bracket of the pair, not the second.
        while at > 0 and text[at - 1] == "[":
            at -= 1
        return text[:at]
    return text


class BubbleStream:
    """
    The same shaping, applied to a token stream as it arrives.

    `feed()` turns text chunks into events for the client:
        {"type": "delta", "chunk": str}   text for the current bubble
        {"type": "break"}                 the next text starts a new bubble
        {"type": "reaction", "emoji": str}

    A tag can be split across chunks ("[[m" + "sg]]"), so everything after the
    last open "[" is held until it is clear whether it is a tag. A break is
    only emitted once text actually follows it, so a trailing marker or one
    before a reaction-only tail never leaves an empty bubble behind.
    """

    def __init__(self) -> None:
        self._buffer = ""
        self._pending_break = False
        self.reaction: str | None = None
        self.bubbles: list[str] = [""]

    def feed(self, chunk: str) -> list[dict]:
        self._buffer += chunk or ""
        events: list[dict] = []
        while True:
            split_match = _SPLIT_RE.search(self._buffer)
            react_match = _REACT_RE.search(self._buffer)
            matches = [m for m in (split_match, react_match) if m]
            if not matches:
                break
            match = min(matches, key=lambda m: m.start())
            self._text(self._buffer[: match.start()], events)
            if match is split_match:
                if self.bubbles[-1].strip():
                    self._pending_break = True
            elif self.reaction is None and is_emoji(match.group(1)):
                self.reaction = match.group(1).strip()
                events.append({"type": "reaction", "emoji": self.reaction})
            self._buffer = self._buffer[match.end():]

        hold_at = self._buffer.rfind("[")
        while hold_at > 0 and self._buffer[hold_at - 1] == "[":
            hold_at -= 1
        if hold_at != -1 and len(self._buffer) - hold_at <= _MAX_HOLD:
            visible, self._buffer = self._buffer[:hold_at], self._buffer[hold_at:]
        else:
            visible, self._buffer = self._buffer, ""
        self._text(visible, events)
        return events

    def flush(self) -> list[dict]:
        """Release the held tail: it never became a tag, so it is plain text."""
        rest, self._buffer = self._buffer, ""
        events: list[dict] = []
        self._text(rest, events)
        return events

    def _text(self, text: str, events: list[dict]) -> None:
        if not text:
            return
        if self._pending_break:
            text = text.lstrip()
            if not text:
                return
            self._pending_break = False
            self.bubbles.append("")
            events.append({"type": "break"})
        elif not self.bubbles[-1]:
            text = text.lstrip()
            if not text:
                return
        self.bubbles[-1] += text
        events.append({"type": "delta", "chunk": text})

    def text_bubbles(self) -> list[str]:
        return [bubble.strip() for bubble in self.bubbles if bubble.strip()]
