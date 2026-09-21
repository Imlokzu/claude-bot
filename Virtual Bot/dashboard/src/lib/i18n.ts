/** New dashboard strings live here; existing screens migrate when touched. */
const uk = {
  'brand.name': 'КЛОД БОТ',
  'brand.virtual': '· ВІРТУАЛЬНИЙ',
  'activity.running': 'Працюю…',
  'activity.summary': 'Дії агента · {count}',
  'activity.expand': 'Показати дії агента',
  'activity.active': 'Виконується',
  'activity.done': 'Готово',
  'activity.failed': 'Помилка',
  'activity.interrupted': 'Перервано · завершення не підтверджено',
  'activity.input': 'Параметри',
  'activity.result': 'Результат',
  'activity.partial': 'Проміжний результат',
  'activity.noResult': 'Результат ще не надійшов',
  'activity.connecting': 'Підключаю стрічку дій OpenClaw…',
  'activity.waiting': 'Очікую відповідь моделі. Викликів інструментів поки немає.',
  'activity.unavailable': 'Стрічка дій OpenClaw недоступна. Відповідь може продовжуватись, але всі дії не видно.',
  'activity.disconnected': 'З’єднання зі стрічкою дій втрачено. Частина подій могла не надійти.',
  'activity.seconds': '{seconds} с',
  'chat.openError': 'Не вдалося відкрити розмову',
  'chat.replyError': 'Бот не відповів',
  'chat.connectionError': 'Збій звʼязку',
  'chat.unknownError': 'Невідома помилка',
  'chat.incomplete': 'Потік обірвався до завершення відповіді',
} as const;

const en: Record<keyof typeof uk, string> = {
  'brand.name': 'CLAUDE BOT',
  'brand.virtual': '· VIRTUAL',
  'activity.running': 'Working…',
  'activity.summary': 'Agent activity · {count}',
  'activity.expand': 'Show agent activity',
  'activity.active': 'Running',
  'activity.done': 'Completed',
  'activity.failed': 'Failed',
  'activity.interrupted': 'Interrupted · completion unconfirmed',
  'activity.input': 'Parameters',
  'activity.result': 'Result',
  'activity.partial': 'Partial result',
  'activity.noResult': 'No result received yet',
  'activity.connecting': 'Connecting to OpenClaw activity…',
  'activity.waiting': 'Waiting for the model. No tool calls yet.',
  'activity.unavailable': 'OpenClaw activity is unavailable. The reply may continue, but not all actions are visible.',
  'activity.disconnected': 'Activity connection lost. Some events may be missing.',
  'activity.seconds': '{seconds}s',
  'chat.openError': 'Could not open conversation',
  'chat.replyError': 'The bot did not reply',
  'chat.connectionError': 'Connection failed',
  'chat.unknownError': 'Unknown error',
  'chat.incomplete': 'The stream ended before the reply was complete',
};

export function t(key: keyof typeof uk, values: Record<string, string | number> = {}): string {
  const locale = typeof document !== 'undefined' && document.documentElement.lang.startsWith('en') ? en : uk;
  return locale[key].replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}
