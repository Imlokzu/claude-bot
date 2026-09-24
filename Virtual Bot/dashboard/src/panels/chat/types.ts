/** Повідомлення так, як їх зберігає бекенд (chat_store). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts?: number;
  attachments?: unknown[];
  participant?: string;
  model?: string;
  steps?: ToolStep[];
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
    steps?: ToolStep[];
    /** Це не репліка, а переказ стиснутої розмови (див. chat_store.compact). */
    compacted?: boolean;
    compacted_from?: number;
  }[];
}

/** Persisted activity for one tool invocation, identified independently of its name. */
export interface ToolStep {
  id: string;
  label: string;
  /** A short, redacted description; full structured data expands below it. */
  detail: string;
  status: 'active' | 'done' | 'failed' | 'interrupted';
  input?: unknown;
  result?: unknown;
  startedAt?: number;
  endedAt?: number;
  source?: string;
}
