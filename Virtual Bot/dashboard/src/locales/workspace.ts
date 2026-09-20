const uk = {
  'menu.add': 'Додати',
  'menu.close': 'Закрити меню',
  'pins.title': 'Закріплене',
  'pins.add': 'Додати панель',
  'pins.remove': 'Відкріпити: {name}',
  'pins.projects': 'Проєкти',
  'pins.vision': 'Зір бота',
  'pins.screen': 'Мініекран',
  'pins.open': 'Відкрити: {name}',
  'pins.loading': 'Завантаження…',
  'pins.error': 'Не вдалося завантажити',
  'pins.retry': 'Спробувати ще',
  'pins.empty': 'Проєктів ще немає',
  'pins.cameraOff': 'Камера вимкнена',
  'pins.cameraError': 'Камера недоступна',
  'pins.watch': 'Дивитися',
  'pins.stop': 'Зупинити',
  'gallery.hint': 'Зображень: {count} · натисніть, щоб відкрити',
} as const;

const en: Record<keyof typeof uk, string> = {
  'menu.add': 'Add',
  'menu.close': 'Close menu',
  'pins.title': 'Pinned',
  'pins.add': 'Add panel',
  'pins.remove': 'Unpin: {name}',
  'pins.projects': 'Projects',
  'pins.vision': 'Bot vision',
  'pins.screen': 'Mini screen',
  'pins.open': 'Open: {name}',
  'pins.loading': 'Loading…',
  'pins.error': 'Could not load',
  'pins.retry': 'Try again',
  'pins.empty': 'No projects yet',
  'pins.cameraOff': 'Camera is off',
  'pins.cameraError': 'Camera unavailable',
  'pins.watch': 'Watch',
  'pins.stop': 'Stop',
  'gallery.hint': 'Images: {count} · click to open',
};

export function t(key: keyof typeof uk, values: Record<string, string | number> = {}): string {
  const locale = typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? en : uk;
  return locale[key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
