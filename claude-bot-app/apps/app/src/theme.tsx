/**
 * Тема застосунку. Значення беремо з @claude-bot/core — того самого джерела,
 * що й веб-панель, тому кольори не роз'їжджаються між платформами.
 *
 * React Native не має CSS-змінних і медіа-запитів, тому тема — це контекст,
 * а не каскад: компоненти беруть палітру хуком.
 */
import React from 'react';
import { Platform, useColorScheme } from 'react-native';
import { paletteFor, type Palette, type ThemeName } from '@claude-bot/core';

interface Theme {
  palette: Palette;
  name: ThemeName;
  /** Гарнітури підбираємо під платформу: серіф у заголовках — стиль Клода. */
  fonts: { sans: string; serif: string; mono: string };
}

const fonts = Platform.select({
  ios: { sans: 'System', serif: 'Georgia', mono: 'Menlo' },
  android: { sans: 'sans-serif', serif: 'serif', mono: 'monospace' },
  default: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, system-ui, sans-serif',
    serif: '"Iowan Old Style", Palatino, Georgia, serif',
    mono: '"JetBrains Mono", Menlo, Consolas, monospace',
  },
})!;

const ThemeContext = React.createContext<Theme>({
  palette: paletteFor('light'),
  name: 'light',
  fonts,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Слідуємо за системою: userInterfaceStyle: "automatic" в app.json.
  const scheme = useColorScheme();
  const name: ThemeName = scheme === 'dark' ? 'dark' : 'light';
  const value = React.useMemo<Theme>(
    () => ({ palette: paletteFor(name), name, fonts }),
    [name],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}
