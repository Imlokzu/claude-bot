import { useCallback, useEffect, useState } from 'react';

/*
 * Тема й акцент. Ключі localStorage успадковані зі старої панелі, тож вибір
 * користувача переживає переїзд на новий фронтенд.
 *
 * Перше застосування робить інлайн-скрипт в index.html — до першого кадру.
 * Тут лише подальші перемикання й реакція на зміну системної теми.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type AccentId = 'terracotta' | 'sage' | 'teal' | 'amber';

const THEME_KEY = 'claudeBotTheme';
const ACCENT_KEY = 'claudeBotAccent';

export const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'light', label: 'Світла пустеля' },
  { id: 'dark', label: 'Темний графіт' },
  { id: 'system', label: 'Як у системі' },
];

export const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: 'terracotta', label: 'Теракота', swatch: '#b95f3d' },
  { id: 'sage', label: 'Шавлія', swatch: '#6f8b5f' },
  { id: 'teal', label: 'Океан', swatch: '#3f7f7a' },
  { id: 'amber', label: 'Бурштин', swatch: '#a9742d' },
];

function read<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Приватний режим або заборонені site data — вибір просто не переживе
    // перезавантаження. Ламати панель через це не варто.
  }
}

const THEME_IDS = THEMES.map((t) => t.id);
const ACCENT_IDS = ACCENTS.map((a) => a.id);

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeChoice>(() => read(THEME_KEY, 'system', THEME_IDS));
  const [accent, setAccentState] = useState<AccentId>(() =>
    read(ACCENT_KEY, 'terracotta', ACCENT_IDS),
  );

  // Обчислена тема — те, що реально на екрані (system уже розгорнуто).
  const [resolved, setResolved] = useState<'light' | 'dark'>(
    () => (document.documentElement.dataset.theme as 'light' | 'dark') || 'light',
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      setResolved(dark ? 'dark' : 'light');
    };
    apply();
    // Слухаємо систему завжди, а не лише в режимі "system": користувач може
    // перемкнутись на нього, поки вкладка відкрита.
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);

  const setTheme = useCallback((value: ThemeChoice) => {
    write(THEME_KEY, value);
    setThemeState(value);
  }, []);

  const setAccent = useCallback((value: AccentId) => {
    write(ACCENT_KEY, value);
    setAccentState(value);
  }, []);

  return { theme, accent, resolved, setTheme, setAccent };
}
