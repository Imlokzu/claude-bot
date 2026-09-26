"""
The screen's pure JS modules, run through node.

wake.js and reply.js are kept free of any DOM exactly so their rules can be
checked without a browser or a microphone. The screen itself is vanilla ES
modules with no toolchain, so these run the real files, not a copy.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

import app_config
import events

SCREEN = Path(app_config.STATIC_DIR) / "screen"
NODE = shutil.which("node")

needs_node = pytest.mark.skipif(NODE is None, reason="node is not installed")


def _run(module: str, body: str):
    """Import a screen module in node, run `body`, return what it prints as JSON."""
    url = (SCREEN / module).as_uri()
    script = f"import * as m from {json.dumps(url)};\n{body}"
    out = subprocess.run(
        [NODE, "--input-type=module", "-e", script],
        capture_output=True, text=True, timeout=20, check=True,
    )
    return json.loads(out.stdout)


def _wake(phrases: list[str], word: str = "клод", armed: bool = False) -> list[dict]:
    return _run("wake.js", f"console.log(JSON.stringify({json.dumps(phrases)}.map("
                           f"p => m.parseWake(p, {json.dumps(word)}, {json.dumps(armed)}))));")


@needs_node
class TestWakeWord:
    @pytest.mark.parametrize("phrase", [
        "Клод, котра година?",
        "клоде котра година",          # vocative, the natural way to call someone
        "Клоду котра година",
        "Claude котра година",         # recognition switched script
        "хей клауд котра година",
        "гей Cloud котра година",
        "а скажи клод котра година",
        "котра година, Клод?",         # the name at the very end
    ])
    def test_recognition_spellings_of_the_name_wake_it(self, phrase: str):
        [result] = _wake([phrase])
        assert result == {"action": "send", "text": "котра година"}

    @pytest.mark.parametrize("phrase", [
        "відкрий код",                    # a dropped sound is an everyday word
        "кіт спить на дивані",
        "я вчора говорив з клодом про це",  # a mention, not an address
        "клодтест упав",
        "",
    ])
    def test_near_misses_and_mentions_do_not(self, phrase: str):
        [result] = _wake([phrase])
        assert result["action"] == "ignore"

    def test_the_name_alone_arms(self):
        assert _wake(["Клод", "клот!"]) == [{"action": "arm", "text": ""}] * 2

    def test_stop_with_the_name_is_a_barge_in(self):
        assert _wake(["Клод, стоп", "клод тихо", "Claude, stop"]) == [{"action": "stop", "text": ""}] * 3

    def test_armed_takes_the_whole_phrase_and_drops_the_name(self):
        assert _wake(["увімкни музику", "Клод, а ще?", "стоп"], armed=True) == [
            {"action": "send", "text": "увімкни музику"},
            {"action": "send", "text": "а ще"},
            {"action": "stop", "text": ""},
        ]

    def test_english_name(self):
        assert _wake(["hey Claude, what time is it?"], word="claude") == [
            {"action": "send", "text": "what time is it"},
        ]


_TRACE = """
const log = [];
const hooks = {};
for (const k of ["onOpen", "onAppend", "onSet", "onClose", "onRemove"]) {
  hooks[k] = (b) => log.push([k, b.note ? "note" : "answer", b.text]);
}
const turn = new m.ReplyTurn(hooks);
"""


@needs_node
class TestReplyTurn:
    def test_narration_then_answer_bubbles_in_order(self):
        result = _run("reply.js", _TRACE + """
turn.note("n1", ["Секунду, гляну"]);
turn.work();
turn.delta("Знайшов!"); turn.split();
turn.delta("Рейс о "); turn.delta("9:10."); turn.split();
turn.delta("Брати?");
const done = turn.done(["Знайшов!", "Рейс о 9:10.", "Брати?"]);
console.log(JSON.stringify({texts: turn.texts(), replaced: done.replaced.length,
  closed: turn.bubbles.every(b => b.closed), notes: turn.bubbles.map(b => b.note)}));
""")
        assert result == {
            "texts": ["Секунду, гляну", "Знайшов!", "Рейс о 9:10.", "Брати?"],
            "replaced": 0,
            "closed": True,
            "notes": [True, False, False, False],
        }

    def test_each_bubble_closes_before_the_next_opens(self):
        # Speech is fed a whole bubble on close; if the next bubble opened
        # first, its words could be read before the end of the previous one.
        result = _run("reply.js", _TRACE + """
turn.note("n1", ["Гляну"]);
turn.delta("Один."); turn.split(); turn.delta("Два.");
turn.closeAll();
console.log(JSON.stringify(log.filter(e => e[0] === "onOpen" || e[0] === "onClose").map(e => e[0] + ":" + e[2])));
""")
        assert result == [
            "onOpen:", "onClose:Гляну",
            "onOpen:", "onClose:Один.",
            "onOpen:", "onClose:Два.",
        ]

    def test_note_snapshots_update_in_place(self):
        result = _run("reply.js", _TRACE + """
turn.note("n1", ["Зараз"]);
turn.note("n1", ["Зараз гляну."]);
turn.note("n1", ["Зараз гляну.", "Ще секунду"]);
console.log(JSON.stringify({texts: turn.texts(), closed: turn.bubbles.map(b => b.closed)}));
""")
        assert result == {"texts": ["Зараз гляну.", "Ще секунду"], "closed": [True, False]}

    def test_done_replaces_a_stream_that_leaked_an_error(self):
        result = _run("reply.js", _TRACE + """
turn.delta("Error: internal error");
const done = turn.done(["Привіт!", "Як ти?"]);
console.log(JSON.stringify({texts: turn.texts(), replaced: done.replaced.map(b => b.text),
  removed: log.filter(e => e[0] === "onRemove").length}));
""")
        assert result == {
            "texts": ["Привіт!", "Як ти?"],
            "replaced": ["Error: internal error"],
            "removed": 1,
        }

    def test_whitespace_differences_are_not_a_replacement(self):
        result = _run("reply.js", _TRACE + """
turn.delta("Знайшов!  "); turn.split(); turn.delta("\\nРейс о 9:10.");
console.log(JSON.stringify(turn.done(["Знайшов!", "Рейс о 9:10."]).replaced.length));
""")
        assert result == 0


class TestReplyEventBubbles:
    """The screen speaks a reply message by message, so it needs the split."""

    def test_reply_event_carries_bubbles(self):
        with patch.object(events, "publish") as publish:
            events.publish_reply("Один\n\nДва", "happy", ["Один", "Два"])
        event = publish.call_args.args[0]
        assert event["bubbles"] == ["Один", "Два"]
        assert event["text"] == "Один\n\nДва"

    def test_without_bubbles_the_event_is_unchanged(self):
        with patch.object(events, "publish") as publish:
            events.publish_reply("Один", "happy")
        assert "bubbles" not in publish.call_args.args[0]

    def test_bubbles_share_the_text_ceiling(self):
        with patch.object(events, "publish") as publish:
            events.publish_reply("x", "happy", ["a" * 15000, "b" * 5000, "c" * 10])
        bubbles = publish.call_args.args[0]["bubbles"]
        assert sum(map(len, bubbles)) <= 16000
