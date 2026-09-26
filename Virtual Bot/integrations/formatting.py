"""
The brain writes Markdown; messengers each want their own dialect.

Telegram gets its HTML subset (b, i, code, pre, a, s, blockquote) because
its MarkdownV2 needs every `.`, `-` and `!` escaped, and one missed escape
rejects the whole message. Discord speaks Markdown natively, so it only
needs splitting to its length limit.
"""

from __future__ import annotations

import html
import re

_FENCE = re.compile(r"```([A-Za-z0-9_+-]*)\n?(.*?)```", re.S)
_INLINE_CODE = re.compile(r"`([^`\n]+)`")
_LINK = re.compile(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)")
_BOLD = re.compile(r"\*\*(.+?)\*\*|__(.+?)__", re.S)
_ITALIC = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\w_])")
_STRIKE = re.compile(r"~~(.+?)~~", re.S)
_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*$", re.M)
_QUOTE = re.compile(r"(?:^&gt; ?.*(?:\n|$))+", re.M)


def to_telegram_html(text: str) -> str:
    """Markdown-ish text -> Telegram HTML. Unknown syntax stays literal text."""
    stash: list[str] = []

    def keep(fragment: str) -> str:
        stash.append(fragment)
        return f"\x00{len(stash) - 1}\x00"

    # Code first: nothing inside it is formatting.
    def fence(match: re.Match) -> str:
        lang, body = match.group(1), match.group(2).rstrip("\n")
        attr = f' class="language-{html.escape(lang)}"' if lang else ""
        return keep(f"<pre><code{attr}>{html.escape(body)}</code></pre>")

    text = _FENCE.sub(fence, text)
    text = _INLINE_CODE.sub(lambda m: keep(f"<code>{html.escape(m.group(1))}</code>"), text)
    text = _LINK.sub(lambda m: keep(f'<a href="{html.escape(m.group(2), quote=True)}">{html.escape(m.group(1))}</a>'), text)

    text = html.escape(text, quote=False)
    text = _HEADING.sub(lambda m: f"<b>{m.group(1)}</b>", text)
    text = _BOLD.sub(lambda m: f"<b>{m.group(1) or m.group(2)}</b>", text)
    text = _STRIKE.sub(lambda m: f"<s>{m.group(1)}</s>", text)
    text = _ITALIC.sub(lambda m: f"<i>{m.group(1) or m.group(2)}</i>", text)
    text = _QUOTE.sub(
        lambda m: "<blockquote>" + "\n".join(line[4:].lstrip() for line in m.group(0).rstrip("\n").split("\n")) + "</blockquote>\n",
        text,
    )
    text = re.sub(r"^[ \t]*[-*] ", "• ", text, flags=re.M)
    return re.sub(r"\x00(\d+)\x00", lambda m: stash[int(m.group(1))], text).strip()


def split_text(text: str, limit: int) -> list[str]:
    """Split on paragraph, then line, then word boundaries under `limit`.

    Applied to the source text before formatting, so a split never lands
    inside an HTML tag.
    """
    text = text.strip()
    if len(text) <= limit:
        return [text] if text else []
    out: list[str] = []
    while len(text) > limit:
        cut = -1
        for sep in ("\n\n", "\n", " "):
            cut = text.rfind(sep, 0, limit)
            if cut > limit // 3:
                break
        if cut <= 0:
            cut = limit
        out.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    if text:
        out.append(text)
    return out


def human_size(size: int) -> str:
    value = float(size or 0)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def clock(seconds: float) -> str:
    seconds = int(seconds or 0)
    return f"{seconds // 60}:{seconds % 60:02d}"
