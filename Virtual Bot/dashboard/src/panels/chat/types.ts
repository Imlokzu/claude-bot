/** Повідомлення так, як їх зберігає бекенд (chat_store). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  attachments?: unknown[];
  participant?: string;
}

export interface SessionSummary {
  id: string;
  title?: string;
  updated?: number;
  created?: number;
  count?: number;
  pinned?: boolean;
  project?: string;
}

export interface SessionDetail {
  id: string;
  title?: string;
  messages?: {
    role: string;
    content: string;
    ts?: number;
    attachments?: unknown[];
    /** Це не репліка, а переказ стиснутої розмови (див. chat_store.compact). */
    compacted?: boolean;
    compacted_from?: number;
  }[];
}

/** Виклик тулза — рядок у блоці «Думаю…» (див. Thinking.tsx). */
export interface ToolStep {
  id: string;
  label: string;
  /** Аргумент виклику: шлях, запит, команда — те, що чіпає бот. */
  detail: string;
  status: 'active' | 'done' | 'failed';
}
