/*
 * One table for every visible string, the same shape as static/screen/i18n.js,
 * so Ukrainian does not end up baked into the components.
 */
import { NativeModules, Platform } from 'react-native';

const DICT = {
  uk: {
    'connect.title': 'Підключення',
    'connect.lead': 'Встав посилання на бота. Ключ із посилання зберігається окремо й далі не показується.',
    'connect.label': 'ПОСИЛАННЯ АБО АДРЕСА',
    'connect.go': 'Підключитися',
    'connect.checking': 'Перевіряю…',
    'connect.bad': 'Не схоже на адресу бота.',
    'connect.failed': 'Бот не відповідає за цією адресою.',
    'connect.noKey': 'У посиланні немає ключа — бот його вимагатиме.',
    'chat.placeholder': 'Напиши боту…',
    'chat.send': 'Надіслати',
    'chat.thinking': 'Думає…',
    'chat.empty': 'Порожньо. Напиши перше повідомлення.',
    'chat.failed': 'Не вдалося надіслати',
    'chat.offline': 'бот без мозку',
    'chat.forget': 'Змінити адресу',
    'chat.newSession': 'Нова розмова',
    'status.online': 'на звʼязку',
    'status.offline': 'не відповідає',
  },
  en: {
    'connect.title': 'Connect',
    'connect.lead': 'Paste a link to the bot. The key is stored separately and not shown again.',
    'connect.label': 'LINK OR ADDRESS',
    'connect.go': 'Connect',
    'connect.checking': 'Checking…',
    'connect.bad': 'That does not look like the bot’s address.',
    'connect.failed': 'The bot did not answer at that address.',
    'connect.noKey': 'The link carries no key — the bot will ask for one.',
    'chat.placeholder': 'Write to the bot…',
    'chat.send': 'Send',
    'chat.thinking': 'Thinking…',
    'chat.empty': 'Nothing yet. Write the first message.',
    'chat.failed': 'Could not send',
    'chat.offline': 'no brain available',
    'chat.forget': 'Change address',
    'chat.newSession': 'New conversation',
    'status.online': 'connected',
    'status.offline': 'not answering',
  },
};

function deviceLocale() {
  try {
    const tag =
      Platform.OS === 'ios'
        ? NativeModules.SettingsManager?.settings?.AppleLocale
        : NativeModules.I18nManager?.localeIdentifier;
    return String(tag || 'uk');
  } catch {
    return 'uk';
  }
}

const L = deviceLocale().toLowerCase().startsWith('en') ? DICT.en : DICT.uk;

export const t = (key) => L[key] ?? key;
