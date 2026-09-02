/* ============================================================
   Розбір ключового слова («хей, гугл» по-нашому)

   Винесено окремо і без жодних залежностей від DOM саме для того, щоб
   цю логіку можна було прогнати напряму, не маючи мікрофона:
     node --input-type=module -e "import('./wake.js')..."
   ============================================================ */

/**
 * Чи прозвучало імʼя бота і що саме він має зробити.
 *
 * @param {string} said  розпізнана фраза
 * @param {string} word  ключове слово (імʼя бота, у нижньому регістрі)
 * @param {boolean} armed  імʼя вже почули раніше й чекаємо команду
 * @returns {{action: "ignore"|"arm"|"send", text: string}}
 *   ignore — не до бота, мовчимо;
 *   arm    — сказали лише імʼя, чекаємо наступну фразу;
 *   send   — є що передати мозку (text).
 */
export function parseWake(said, word, armed) {
  const text = (said || "").trim();
  if (!text) return { action: "ignore", text: "" };

  // Уже «розбудили» — уся наступна фраза є командою
  if (armed) return { action: "send", text };

  const key = (word || "").trim().toLowerCase();
  if (!key) return { action: "ignore", text: "" };

  const lowered = text.toLowerCase();
  const at = lowered.indexOf(key);
  if (at === -1) return { action: "ignore", text: "" };

  // Імʼя має бути окремим словом: «клод» так, «клодтест» ні
  const before = at === 0 ? "" : lowered[at - 1];
  const afterIdx = at + key.length;
  const after = afterIdx >= lowered.length ? "" : lowered[afterIdx];
  const isBoundary = (ch) => ch === "" || !/[\p{L}\p{N}]/u.test(ch);
  if (!isBoundary(before) || !isBoundary(after)) return { action: "ignore", text: "" };

  // «Клод, котра година?» — команда одразу; саме «Клод» — чекаємо наступну
  const rest = text.slice(afterIdx).replace(/^[\s,.:;!?—–-]+/, "").trim();
  if (rest) return { action: "send", text: rest };
  return { action: "arm", text: "" };
}
