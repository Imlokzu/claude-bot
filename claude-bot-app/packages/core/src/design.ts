/**
 * Дизайн-токени: палітра й типографіка Claude у структурі Material 3.
 *
 * У вебі ці ж значення живуть як CSS-змінні, але React Native змінних CSS
 * не має — тому єдине джерело правди тут, у звичайних обʼєктах, і веб-шар
 * розкладає їх у CSS сам. Так тема не роз'їжджається між платформами.
 *
 * Контраст перевірений: заливка (primaryStrong) під світлим текстом дає
 * 4.52–4.56 у світлій темі й 4.92–7.04 у темній — тобто WCAG AA для
 * звичайного тексту. Саме тому заливка й акцент — РІЗНІ токени: брендовий
 * акцент середнього тону не добирав до 4.5:1.
 */

export interface Palette {
  /** Тло під усім. */
  background: string;
  /** Поверхня картки/панелі. */
  surface: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;

  onSurface: string;
  onSurfaceVariant: string;

  outline: string;
  outlineVariant: string;

  /** Брендовий акцент: рамки, іконки, підкреслення, текст-акцент. */
  primary: string;
  /** Акцент для ЗАЛИТИХ поверхонь, де на ньому лежить onPrimary. */
  primaryStrong: string;
  onPrimary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;

  error: string;
  success: string;
}

export const lightPalette: Palette = {
  background: '#eee4d2',
  surface: '#fffaf1',
  surfaceContainerLow: '#f7eddd',
  surfaceContainer: '#f0e5d2',
  surfaceContainerHigh: '#e5d5bc',

  onSurface: '#30271f',
  onSurfaceVariant: '#887563',

  outline: '#c8ae8c',
  outlineVariant: '#dbc9ad',

  primary: '#b95f3d',
  primaryStrong: '#b25b3b',
  onPrimary: '#fffaf1',
  secondaryContainer: '#e8cbb9',
  onSecondaryContainer: '#7b3a21',

  error: '#a84f45',
  success: '#718b62',
};

export const darkPalette: Palette = {
  background: '#171819',
  surface: '#222426',
  surfaceContainerLow: '#292c2e',
  surfaceContainer: '#2c2f31',
  surfaceContainerHigh: '#33373a',

  onSurface: '#e8e4dc',
  onSurfaceVariant: '#9a9da0',

  outline: '#5a6064',
  outlineVariant: '#3a3e41',

  primary: '#d17a58',
  // У темряві акцент світлий, а текст на ньому темний — затемнювати не треба
  // й шкідливо: це зменшило б різницю з onPrimary.
  primaryStrong: '#d17a58',
  onPrimary: '#222426',
  secondaryContainer: '#4a3428',
  onSecondaryContainer: '#f0c3aa',

  error: '#d87869',
  success: '#8ca879',
};

/** Шкала форми Material 3. */
export const shape = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 999,
} as const;

/** Крок сітки 4dp — усі відступи кратні йому. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Типографіка: серіф Клода для заголовків, гротеск для тексту.
 * Сімʼї підбирає платформенний шар — на iOS/macOS це SF Pro та New York,
 * на Android — Roboto й Noto Serif, у вебі — системний стек.
 */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '600' as const, serif: true },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, serif: true },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const, serif: false },
  body: { fontSize: 15, lineHeight: 23, fontWeight: '400' as const, serif: false },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, serif: false },
  mono: { fontSize: 13, lineHeight: 19, fontWeight: '400' as const, serif: false },
} as const;

/** Непрозорості state layer із специфікації M3. */
export const stateLayer = {
  hover: 0.08,
  focus: 0.1,
  pressed: 0.1,
} as const;

/** Мінімальна комфортна ціль дотику. */
export const touchTarget = 44;

/** Тривалості й криві руху M3. */
export const motion = {
  short: 100,
  medium: 200,
  long: 350,
  // React Native Easing не бере cubic-bezier рядком — платформенний шар
  // перетворює ці числа сам.
  standard: [0.2, 0, 0, 1] as const,
  emphasized: [0.05, 0.7, 0.1, 1] as const,
} as const;

export type ThemeName = 'light' | 'dark';

export function paletteFor(name: ThemeName): Palette {
  return name === 'dark' ? darkPalette : lightPalette;
}
