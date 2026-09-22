import { useCallback, useEffect, useState } from 'react';

/*
 * Мова панелі. Як і тема — локальна для цього браузера (localStorage),
 * бо на телефоні й на столі можуть хотіти різні.
 *
 * `document.documentElement.lang` — єдине джерело правди: саме його читають
 * обидва локальні модулі (lib/i18n, locales/workspace), тож перемикання
 * тут одразу переключає всі рядки, що вже на ключах.
 */

export type Language = 'uk' | 'en';

const KEY = 'claudeBotLang';

function read(): Language {
  try {
    return localStorage.getItem(KEY) === 'uk' ? 'uk' : 'en';
  } catch {
    return 'en';
  }
}

export function useLanguage(): [Language, (next: Language) => void] {
  const [lang, setLang] = useState<Language>(read);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      /* приватний режим — вибір просто не переживе перезавантаження */
    }
  }, [lang]);

  return [lang, useCallback((next: Language) => setLang(next), [])];
}
