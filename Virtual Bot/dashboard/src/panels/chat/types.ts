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
  /** Id in chat_store; reactions address messages by it. */
  serverId?: string;
  /** A bot reply as it happened: narration, tool steps, answer bubbles. */
  parts?: ReplyPart[];
  /** On a user message: the bot's emoji reaction to it. */
  reaction?: string;
  /** On a bot message: the user's reactions, keyed by bubble index. */
  reactions?: Record<string, string>;
}

/**
 * One piece of a bot reply. `note` marks what the bot said while working
 * ("one sec, looking it up") as opposed to the answer itself.
 */
export type ReplyPart =
  | { type: 'text'; text: string; note?: boolean }
  | { type: 'steps'; ids: string[] };

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
    id?: string;
    role: string;
    content: string;
    ts?: number;
    attachments?: unknown[];
    steps?: ToolStep[];
    parts?: ReplyPart[];
    reaction?: string;
    reactions?: Record<string, string>;
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
