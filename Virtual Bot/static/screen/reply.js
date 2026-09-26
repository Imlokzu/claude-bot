/* ============================================================
   One bot turn as messenger bubbles

   The bot writes like a person in a messenger: a short line before it goes
   to work ("one sec, checking"), then the answer split into a few messages.
   /api/chat streams that as events (see chat_bubbles.BubbleStream and
   main.api_chat):

     delta  {chunk}        text for the current answer bubble
     break  {}             the next delta starts a new bubble
     note   {id, bubbles}  narration while working, as a full snapshot
     done   {bubbles}      the final answer bubbles — the authority

   This module turns those events into a list of bubbles and tells the
   caller what changed through callbacks. It has no DOM on purpose, so the
   ordering rules can be run straight from node without a browser:
     node --input-type=module -e "import('./reply.js')..."
   ============================================================ */

/** Whitespace-insensitive text, for comparing a streamed bubble to the final one. */
export function norm(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * A bubble is a plain object the caller may decorate (the screen hangs its
 * DOM node and markdown parser on it):
 *   { text, note, closed, spoken }
 * `spoken` counts characters already handed to speech; it lives here so a
 * replaced bubble can report whether its words were already said aloud.
 */
export class ReplyTurn {
  /**
   * @param {object} hooks  any of onOpen(b), onAppend(b, chunk), onSet(b),
   *                        onClose(b), onRemove(b)
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.bubbles = [];
    this.notes = new Map();   // note id -> its bubbles, in order
    this.answer = null;       // answer bubble that the next delta extends
  }

  _call(name, ...args) {
    const fn = this.hooks[name];
    if (typeof fn === "function") fn(...args);
  }

  _open(note) {
    const b = { text: "", note: !!note, closed: false, spoken: 0 };
    this.bubbles.push(b);
    this._call("onOpen", b);
    return b;
  }

  _close(b) {
    if (!b || b.closed) return;
    b.closed = true;
    this._call("onClose", b);
  }

  /** Close every bubble still open: something else happens next. */
  closeAll() {
    this.answer = null;
    for (const b of this.bubbles) this._close(b);
  }

  delta(chunk) {
    const text = String(chunk || "");
    if (!text) return;
    if (!this.answer) {
      // Narration ends where the answer begins; leaving it open would let
      // its speech wait for the whole answer.
      this.closeAll();
      this.answer = this._open(false);
    }
    this.answer.text += text;
    this._call("onAppend", this.answer, text);
  }

  /** `break`: the current answer bubble is finished. */
  split() {
    if (!this.answer) return;
    const b = this.answer;
    this.answer = null;
    this._close(b);
  }

  /** A tool started: whatever was being said before it is complete. */
  work() {
    this.closeAll();
  }

  note(id, texts) {
    const key = String(id || "");
    const parts = (Array.isArray(texts) ? texts : []).map((t) => String(t || "")).filter((t) => t.trim());
    if (!key || !parts.length) return;
    let slots = this.notes.get(key);
    if (!slots) {
      // A new narration line comes after everything drawn so far.
      this.closeAll();
      slots = [];
      this.notes.set(key, slots);
    }
    parts.forEach((text, i) => {
      let b = slots[i];
      if (!b) {
        b = this._open(true);
        slots.push(b);
      }
      if (b.text !== text) {
        b.text = text;
        this._call("onSet", b);
      }
    });
    // A snapshot with a later bubble means the earlier ones are done.
    for (let i = 0; i < slots.length - 1; i++) this._close(slots[i]);
  }

  /** Answer bubbles as streamed so far. */
  answerTexts() {
    return this.bubbles.filter((b) => !b.note).map((b) => b.text);
  }

  /**
   * `done`: the final bubbles win over the stream. The backend says so
   * itself — a gateway error can leak into delta before the brain swaps the
   * reply, and whoever keeps the streamed text shows that error as the
   * bot's words.
   *
   * @returns {{replaced: object[]}} answer bubbles that were thrown away
   *          (empty when the stream already matched)
   */
  done(finalBubbles) {
    const finals = (Array.isArray(finalBubbles) ? finalBubbles : [])
      .map((t) => String(t || "")).filter((t) => t.trim());
    const same = finals.length === this.answerTexts().length &&
      finals.every((t, i) => norm(t) === norm(this.answerTexts()[i]));
    if (same) {
      this.closeAll();
      return { replaced: [] };
    }
    const replaced = this.bubbles.filter((b) => !b.note);
    this.answer = null;
    this.bubbles = this.bubbles.filter((b) => b.note);
    for (const b of replaced) this._call("onRemove", b);
    this.closeAll();
    for (const text of finals) {
      const b = this._open(false);
      b.text = text;
      this._call("onSet", b);
      this._close(b);
    }
    return { replaced };
  }

  /** Every bubble's text in order, for the caption and the "bot said" tile. */
  texts() {
    return this.bubbles.map((b) => b.text).filter((t) => t.trim());
  }
}
