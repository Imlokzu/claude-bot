/*
 * Нерозривні пробіли для українського тексту.
 *
 * Ідея — з Typehug (typehug.aliszu.com, «UI things»). Сам пакет має словники
 * лише для англійської та польської, тож правила тут свої. Чотири родини,
 * ті самі, що в оригіналі:
 *
 *   1. короткі слова   — прийменник/сполучник не лишається в кінці рядка
 *   2. числа з одиницями — «30 хв», «5 ГБ», «2 с» не розриваються
 *   3. ініціали й знаки — «№ 7», «с. 12»
 *   4. кінець абзацу   — останні два слова тримаються разом, щоб рядок не
 *                        закінчувався одиноким словом
 *
 * Застосовувати до ІНТЕРФЕЙСНИХ рядків: підписи, підказки, заголовки.
 * До вмісту чату не застосовувати — там Markdown і код, і нерозривний пробіл
 * усередині ``` зламає порівняння тексту.
 */

const NBSP = ' ';

/** Однобуквені та короткі службові слова, які не можна кидати в кінці рядка. */
const SHORT = new Set([
  'а', 'б', 'в', 'ж', 'з', 'и', 'і', 'й', 'к', 'о', 'с', 'у', 'я',
  'ад', 'аж', 'би', 'бо', 'де', 'до', 'за', 'зі', 'із', 'їх', 'ми', 'на',
  'не', 'ні', 'но', 'об', 'от', 'по', 'та', 'ти', 'то', 'ту', 'це', 'ця',
  'чи', 'що', 'як', 'ці', 'цю', 'вж',
  'без', 'бут', 'вид', 'від', 'все', 'для', 'між', 'над', 'або', 'під',
  'при', 'про', 'так', 'той', 'цей', 'щоб', 'теж', 'уже', 'усе',
]);

/** Одиниці виміру, які тримаються за числом. */
const UNITS = new Set([
  'мс', 'с', 'хв', 'год', 'дн', 'дні', 'днів', 'р', 'рр',
  'б', 'кб', 'мб', 'гб', 'тб', 'кіб', 'міб', 'гіб',
  '%', '°', '°c', 'гц', 'кгц', 'мгц', 'вт', 'мвт', 'в', 'ма',
  'шт', 'раз', 'рази', 'разів', 'символ', 'символи', 'символів',
  'токен', 'токени', 'токенів', 'файл', 'файли', 'файлів',
  'px', 'fps', 'kb', 'mb', 'gb', 'ms',
]);

/** Знаки, після яких число не відривається: № 7, § 3. */
const SIGNS = new Set(['№', '§', '±', '~', '≈']);

const IS_NUMBER = /^\d+([.,]\d+)?$/;

export interface GlueOptions {
  /** Зшивати останні два слова абзацу. Вимкни для дуже вузьких колонок. */
  paragraphEnding?: boolean;
}

/**
 * Замінює звичайні пробіли на нерозривні там, де розрив зіпсував би рядок.
 * Ідемпотентна: повторний виклик нічого не змінює.
 */
export function glue(input: string, options: GlueOptions = {}): string {
  const { paragraphEnding = true } = options;
  if (!input) return input;

  // Працюємо порядково: кінець абзацу має сенс лише в межах рядка.
  return input
    .split('\n')
    .map((line) => glueLine(line, paragraphEnding))
    .join('\n');
}

function glueLine(line: string, paragraphEnding: boolean): string {
  // Розбиваємо, зберігаючи роздільники, щоб не з'їсти подвійні пробіли.
  const parts = line.split(/(\s+)/);
  if (parts.length < 3) return line;

  for (let i = 1; i < parts.length - 1; i += 2) {
    const gap = parts[i];
    // Чіпаємо лише одиночний звичайний пробіл: табуляція й подвійний
    // пробіл — це чийсь навмисний відступ.
    if (gap !== ' ') continue;

    const rawBefore = parts[i - 1];
    const after = parts[i + 1];

    if (shouldGlue(rawBefore, after)) parts[i] = NBSP;
  }

  if (paragraphEnding) {
    // Останній пробіл рядка: одиноке слово на новому рядку — сирота.
    const last = parts.length - 2;
    if (last > 0 && parts[last] === ' ') {
      const tail = stripPunct(parts[last + 1]);
      // Довге слово саме собою тримає рядок — сироти з нього не виходить.
      if (tail.length <= 10) parts[last] = NBSP;
    }
  }

  return parts.join('');
}

function stripPunct(word: string): string {
  return word.replace(/^[«"'(\[—–-]+|[»"')\]:;,.!?…]+$/g, '').toLowerCase();
}

function shouldGlue(rawBefore: string, after: string): boolean {
  if (!rawBefore || !after) return false;

  // Ініціал перевіряємо ДО чистки: крапка — і є ознака ініціала.
  if (/^[а-яїієґa-z]\.$/i.test(rawBefore)) return true;

  const before = stripPunct(rawBefore);
  if (!before) return false;

  // 1. короткі службові слова
  if (SHORT.has(before)) return true;

  // 2. число + одиниця
  if (IS_NUMBER.test(before) && UNITS.has(stripPunct(after))) return true;

  // 3. знак + число (№ 7)
  if (SIGNS.has(before) && IS_NUMBER.test(stripPunct(after))) return true;

  return false;
}
