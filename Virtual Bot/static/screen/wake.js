/* ============================================================
   Wake word parsing ("hey Google", our way)

   Kept separate and free of any DOM so the logic runs straight from node,
   without a microphone:
     node --input-type=module -e "import('./wake.js')..."

   Why not a plain substring search: the name reaches us through speech
   recognition, and recognition spells it however it likes. "Клод" comes
   back as "Клоде" (Ukrainian vocative — the natural way to call someone),
   "Клоду", "Claude", "клауд", "клот", "Cloud". An exact match missed most
   real calls, so the bot looked deaf. Every token is reduced to a rough
   phonetic key instead, and keys are compared.
   ============================================================ */

const CYR = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "e", ж: "zh",
  з: "z", и: "i", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "u", я: "a", ы: "i", э: "e",
  ё: "o", ъ: "",
};

// Voiced consonant at the end of a word is said unvoiced: "клод" ~ "клот".
const DEVOICE = { d: "t", b: "p", z: "s", g: "k", h: "k", v: "f" };

// Filler that may come before the name: "хей, клод", "ok claude". Written
// as people say them; keyed through phoneticKey when first used.
const FILLER_WORDS = [
  "хей", "гей", "ей", "ой", "о", "а", "ну", "слухай", "скажи", "окей", "ок",
  "привіт", "як", "hey", "hi", "ok", "okay", "hello", "yo", "listen", "say",
];

// Commands that must work even while the bot is talking (barge-in).
const STOP_WORDS_RAW = [
  "стоп", "стій", "тихо", "замовкни", "досить", "пауза", "хватит", "цить",
  "stop", "quiet", "enough", "pause", "shush",
];

let fillerKeys = null;
let stopKeys = null;
function keysOf(list) {
  return new Set(list.map((w) => phoneticKey(w)));
}

// How far into a phrase the name may sit and still be a call: "Клод, …",
// "хей Клод, …", "а скажи, Клод, …". Deeper than that it is a mention
// ("я вчора говорив з Клодом про це"), not an address.
const MAX_LEAD_TOKENS = 2;

/** One word → rough phonetic key: script-, case- and spelling-agnostic. */
export function phoneticKey(word) {
  let s = String(word || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(/[ʼ'’`]/g, "");
  s = Array.from(s).map((ch) => (ch in CYR ? CYR[ch] : ch)).join("");
  s = s.replace(/[^a-z0-9]/g, "");
  s = s
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/c(?!h)/g, "k")
    .replace(/q/g, "k")
    .replace(/w/g, "v")
    .replace(/x/g, "ks")
    .replace(/y/g, "i")
    .replace(/(au|ou|ow|aw|oa)/g, "o");
  // A silent final "e" in English ("claude"), but never the whole word
  if (s.length > 3) s = s.replace(/e$/, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}

function devoiced(key) {
  const last = key.slice(-1);
  return last in DEVOICE ? key.slice(0, -1) + DEVOICE[last] : key;
}

/**
 * Does one recognised word sound like the name?
 * Accepted: the same key; the key plus a short case ending ("клоду",
 * "клодом"); one substituted sound in a name of 4+ sounds ("клад").
 * Refused on purpose: a dropped sound ("код", "кот" for "клод") — those
 * are everyday words, and waking on "code" would be worse than missing.
 */
export function soundsLike(word, name) {
  const w = phoneticKey(word);
  const n = phoneticKey(name);
  if (!w || !n) return false;
  if (w === n || devoiced(w) === devoiced(n)) return true;
  if (w.startsWith(n) && w.length - n.length <= 3 && n.length >= 3) return true;
  if (n.length >= 4 && w.length === n.length && w[0] === n[0]) {
    let diff = 0;
    const a = devoiced(w);
    const b = devoiced(n);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff <= 1;
  }
  return false;
}

/** Words with their positions in the original text. */
function tokens(text) {
  const out = [];
  const re = /[\p{L}\p{N}ʼ'’]+/gu;
  let m;
  while ((m = re.exec(text))) out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return out;
}

function trimPunct(text) {
  return text.replace(/^[\s,.:;!?—–-]+/, "").replace(/[\s,.:;!?—–-]+$/, "").trim();
}

/**
 * Where the name is in a phrase, if it is addressed to the bot.
 * @returns {{before: string, after: string} | null}
 */
export function findWake(said, word) {
  const text = String(said || "");
  const name = String(word || "").trim();
  if (!text.trim() || !name) return null;
  const list = tokens(text);
  for (let i = 0; i < list.length; i++) {
    if (!soundsLike(list[i].word, name)) continue;
    fillerKeys = fillerKeys || keysOf(FILLER_WORDS);
    const lead = list.slice(0, i).filter((t) => !fillerKeys.has(phoneticKey(t.word))).length;
    const isLast = i === list.length - 1;
    // "котра година, Клод?" — the name at the very end also addresses him
    if (lead > MAX_LEAD_TOKENS && !isLast) continue;
    return {
      before: trimPunct(text.slice(0, list[i].start)),
      after: trimPunct(text.slice(list[i].end)),
    };
  }
  return null;
}

/** Is the command just "stop" / "тихо" — something to obey mid-speech? */
export function isStopCommand(command) {
  const list = tokens(String(command || ""));
  if (!list.length || list.length > 3) return false;
  stopKeys = stopKeys || keysOf(STOP_WORDS_RAW);
  return list.some((t) => stopKeys.has(phoneticKey(t.word)));
}

/**
 * Was the bot's name said, and what should it do.
 *
 * @param {string} said  recognised phrase
 * @param {string} word  wake word (the bot's name)
 * @param {boolean} armed  the name was already heard, or the bot is in its
 *                         follow-up window: the whole phrase is the command
 * @returns {{action: "ignore"|"arm"|"send"|"stop", text: string}}
 *   ignore — not for the bot, stay quiet;
 *   arm    — only the name was said, wait for the next phrase;
 *   send   — there is something for the brain (text);
 *   stop   — "Клод, стоп": silence the voice, send nothing.
 */
export function parseWake(said, word, armed) {
  const text = (said || "").trim();
  if (!text) return { action: "ignore", text: "" };

  const hit = findWake(text, word);
  if (armed) {
    // Already awake: the name inside the phrase is just a name, drop it
    const command = hit ? trimPunct([hit.before, hit.after].filter(Boolean).join(" ")) || text : text;
    if (isStopCommand(command)) return { action: "stop", text: "" };
    return { action: "send", text: command };
  }
  if (!hit) return { action: "ignore", text: "" };

  // "Клод, котра година?" → command after the name; "котра година, Клод?"
  // → before it; "Клод" alone → wait for the next phrase.
  const command = hit.after || hit.before;
  if (!command) return { action: "arm", text: "" };
  if (isStopCommand(command)) return { action: "stop", text: "" };
  return { action: "send", text: command };
}
