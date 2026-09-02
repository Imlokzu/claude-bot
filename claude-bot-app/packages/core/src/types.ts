/**
 * Типи бекенду «Клод Бота» (FastAPI на 127.0.0.1:8100).
 *
 * Це НЕ вигадані типи, а форма, яку реально віддає наявний бекенд —
 * той самий, що обслуговує дебаг-панель. Застосунок нічого в ньому не
 * змінює: він лише інший клієнт до тих самих ендпоінтів.
 */

/** Емоція бота, якою він позначає свою відповідь. */
export type Emotion = string;

/** Один хід у розмові. */
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  /** Емоція є лише у відповідей бота. */
  emotion?: Emotion;
  /** Виклики інструментів, які бот зробив, поки відповідав. */
  steps?: ToolStep[];
  /** Прикріплення користувача. */
  attachments?: Attachment[];
  /** Unix-час у секундах. */
  ts?: number;
}

/** Виклик інструмента всередині відповіді. */
export interface ToolStep {
  name: string;
  /** Довжина тексту на момент виклику — щоб вставити крок у правильне місце. */
  at?: number;
  input?: unknown;
  output?: unknown;
  ok?: boolean;
}

export interface Attachment {
  /** Шлях, який віддав /api/chat/upload, напр. "/uploads/abc.png". */
  url: string;
  /** MIME-тип. */
  type: string;
  name?: string;
}

/** Відповідь POST /api/chat. */
export interface ChatReply {
  reply: string;
  emotion: Emotion;
  /** Мозок, який РЕАЛЬНО відповів (omni | openclaw | anthropic | chat2api | demo). */
  mode: string;
  session_id?: string;
  /** Модель, якою відповіли, якщо бекенд її повідомив. */
  model?: string;
  steps?: ToolStep[];
}

/** Рівень «міркування» для наступної відповіді. */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ChatRequest {
  message: string;
  session_id?: string;
  history?: Array<{ role: string; content: string }>;
  reasoning_effort?: ReasoningEffort;
  attachments?: Attachment[];
}

/**
 * Модель із GET /api/models.
 *
 * Поле саме `id`, а не `value` — так його віддає бекенд. `reasoning` теж не
 * булеве, а обʼєкт з переліком доступних рівнів: модель може підтримувати
 * лише частину з них.
 */
export interface ModelOption {
  /** id, як його розуміє роутер, напр. "opencode-go/kimi-k3". */
  id: string;
  label: string;
  reasoning?: {
    supported: boolean;
    levels: ReasoningEffort[];
    default: ReasoningEffort;
  };
}

export interface ModelsResponse {
  models: ModelOption[];
  /** Обрана користувачем модель. */
  selected: string;
  /** Модель за замовчуванням із config.yaml. */
  default?: string;
  /**
   * Людський підпис того, хто РЕАЛЬНО відповів останнім (напр. «демо-режим»).
   * Це не те саме, що `selected`: обрана модель могла впасти, і відповів
   * запасний мозок. Показувати `selected` як автора відповіді — брехня.
   */
  active?: string;
  /** Технічний id мозку: omni | openclaw | anthropic | chat2api | demo. */
  brain?: string;
}

/**
 * Коротка картка розмови у списку (GET /api/sessions).
 * Поля — за фактичною відповіддю бекенда: `updated` це unix-СЕКУНДИ,
 * а не ISO-рядок, і є лічильник повідомлень.
 */
export interface SessionSummary {
  id: string;
  title: string;
  /** Unix-час у секундах (не мілісекундах). */
  updated: number;
  /** Скільки повідомлень у розмові. */
  count: number;
  pinned: boolean;
  /** Проєкт, до якого прив'язана розмова (для кодинг-режиму); "" — без проєкту. */
  project: string;
}

export interface SessionDetail {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: Message[];
  /** Чи має розмова справжню назву, чи автоматичну. */
  titled?: boolean;
}

/** Проєкт кодинг-режиму — тека, у якій працює агент. */
export interface Project {
  id: string;
  name: string;
}

/** GET /api/code/status — чи взагалі показувати режим «Код». */
export interface CodeStatus {
  available: boolean;
  /** Модель, якою кодинг працює ЗАРАЗ (вибір, а не лише типова з конфіга). */
  model: string;
  /** Кований список для пікера. */
  models: CodeModelOption[];
  default_model?: string;
  profile: string;
  /** Абсолютний шлях теки, у якій працює кодинг-агент. */
  root: string;
}

/** Модель кодинг-агента. id завжди у формі «провайдер/модель». */
export interface CodeModelOption {
  id: string;
  label: string;
}

/** GET /api/auth/config. */
export interface AuthConfig {
  issuer: string;
  /** true, якщо вхід вимкнено (CLERK_DISABLED=1) — локальна розробка. */
  disabled: boolean;
}

/** Режим розмови: звичайний чат або кодинг-агент. */
export type ChatMode = 'chat' | 'code';
