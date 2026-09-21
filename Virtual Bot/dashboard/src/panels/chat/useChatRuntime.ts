import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { cleanEmotionTag, streamChat, type AgentStatus, type ChatAttachment } from '@/lib/chatStream';
import { t } from '@/lib/i18n';
import { updateActivity, finishActivity, restoreActivity } from './activity';
import { useToast } from '@/components/ui/Toaster';
import { estimateTokens } from './tokens';
import type { ChatMessage, SessionDetail, SessionSummary, ToolStep } from './types';

/*
 * Зшивання нашого бекенда з assistant-ui.
 *
 * Береться саме useExternalStoreRuntime, а не useLocalRuntime: історію
 * розмов тримає бекенд (/api/sessions), і при перемиканні розмови масив
 * повідомлень має підмінюватись цілком. Локальний рантайм веде свій власний
 * список і такого не дозволяє.
 */

let localId = 0;
const nextId = () => `local-${++localId}`;

export function useChatRuntime() {
  const client = useQueryClient();
  const toast = useToast();

  const [sessionId, setSessionId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Відповідь, яка ще пишеться. Окремо від messages, бо її текст міняється
  // на кожен чанк, а історія — ні.
  const [draft, setDraft] = useState<string | null>(null);
  const [steps, setSteps] = useState<ToolStep[]>([]);
  const stepsRef = useRef<ToolStep[]>([]);
  const draftRef = useRef('');
  const generation = useRef(0);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('connecting');
  const [streamModel, setStreamModel] = useState('');
  // Скільки реплік сховано за переказом. 0 — розмову не стискали.
  const [compactedFrom, setCompactedFrom] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Only the request-scoped chat stream may contribute to this transcript.
  // The global bot event bus also contains other sessions and background work.
  useEffect(() => () => {
    generation.current += 1;
    abortRef.current?.abort();
  }, []);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await get<{ sessions: SessionSummary[] }>('/api/sessions')).sessions ?? [],
  });

  /** Відкриває збережену розмову. */
  const openSession = useCallback(
    async (id: string) => {
      const version = ++generation.current;
      abortRef.current?.abort();
      abortRef.current = null;
      setSessionId(id);
      setDraft(null);
      setSteps([]);
      stepsRef.current = [];
      draftRef.current = '';
      setCompactedFrom(0);
      if (!id) {
        setMessages([]);
        return;
      }
      try {
        const data = await get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
        if (version !== generation.current) return;
        // Переказ завжди стоїть першим і єдиним — саме так його пише
        // chat_store.compact.
        setCompactedFrom(Number(data.messages?.[0]?.compacted_from ?? 0));
        setMessages(
          (data.messages ?? []).map((message, index) => ({
            id: `${id}-${index}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.role === 'assistant' ? cleanEmotionTag(message.content ?? '') : message.content ?? '',
            ts: message.ts,
            attachments: message.attachments,
            steps: restoreActivity(message.steps),
          })),
        );
      } catch (error) {
        if (version === generation.current) toast.error(t('chat.openError'), (error as Error).message);
      }
    },
    [toast],
  );

  const newSession = useCallback(() => {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setSessionId('');
    setMessages([]);
    setDraft(null);
    setSteps([]);
    stepsRef.current = [];
    draftRef.current = '';
    setCompactedFrom(0);
  }, []);

  const send = useCallback(
    async (text: string, attachments: unknown[] = []) => {
      const trimmed = text.trim();
      if (!trimmed || abortRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      const version = ++generation.current;
      const isCurrent = () => version === generation.current && !controller.signal.aborted;

      const safeAttachments = attachments.filter(
        (item): item is ChatAttachment => Boolean(item && typeof item === 'object' && 'url' in item),
      );
      setMessages((current) => [...current, {
        id: nextId(), role: 'user', content: trimmed, attachments: safeAttachments,
      }]);
      setDraft('');
      setSteps([]);
      stepsRef.current = [];
      draftRef.current = '';
      setAgentStatus('connecting');
      setStreamModel('');

      let accumulated = '';
      let terminal = false;
      const preserveInterrupted = () => {
        if (!isCurrent() || terminal) return;
        terminal = true;
        const finished = finishActivity(stepsRef.current);
        if (accumulated || finished.length) {
          setMessages((current) => [...current, { id: nextId(), role: 'assistant', content: accumulated, steps: finished }]);
        }
        setDraft(null);
        setSteps(finished);
      };

      await streamChat(
        {
          message: trimmed,
          session_id: sessionId || undefined,
          attachments: safeAttachments,
          // reasoning_effort тут більше не шлемо. Він діяв лише на прямий
          // виклик Omni (картинки), а в чаті відповідає OpenClaw, і глибину
          // думання йому задає власний конфіг — див. /api/brain/thinking.
          // Поле, яке нічого не міняє в тому шляху, яким іде відповідь,
          // створювало б ілюзію керування.
        },
        {
          onDelta: (chunk) => {
            if (!isCurrent() || terminal) return;
            accumulated += chunk;
            draftRef.current = accumulated;
            setDraft(accumulated);
          },
          onTool: (event) => {
            if (!isCurrent() || terminal) return;
            stepsRef.current = updateActivity(stepsRef.current, event);
            setSteps(stepsRef.current);
          },
          onStatus: (status) => {
            if (isCurrent() && !terminal) setAgentStatus(status);
          },
          onModel: (model) => {
            if (isCurrent() && !terminal) setStreamModel(model);
          },
          onSession: (id) => {
            if (isCurrent() && !terminal) setSessionId(id);
          },
          onDone: (result) => {
            if (!isCurrent() || terminal) return;
            terminal = true;
            const finished = result.steps ?? finishActivity(stepsRef.current);
            setMessages((current) => [
              ...current,
            { id: nextId(), role: 'assistant', content: result.reply, steps: finished,
              model: result.model || streamModel },
            ]);
            setDraft(null);
            setSteps(finished);
            if (result.model) setStreamModel(result.model);
            // Each assistant message owns its activity, including saved history.
            // Бекенд міг створити нову розмову й дати їй назву у фоні.
            if (result.session_id && result.session_id !== sessionId) setSessionId(result.session_id);
            void client.invalidateQueries({ queryKey: ['sessions'] });
            void client.invalidateQueries({ queryKey: ['models'] });
          },
          onError: (message) => {
            if (!isCurrent() || terminal) return;
            preserveInterrupted();
            toast.error(t('chat.replyError'), message);
          },
        },
        controller.signal,
      ).catch((error: unknown) => {
        if (!isCurrent() || terminal) return;
        preserveInterrupted();
        if ((error as Error)?.name !== 'AbortError') toast.error(t('chat.connectionError'), (error as Error).message);
      });

      if (abortRef.current === controller) abortRef.current = null;
    },
    [client, sessionId, toast],
  );

  const cancel = useCallback(async () => {
    generation.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    const finished = finishActivity(stepsRef.current);
    const content = draftRef.current;
    if (content || finished.length) {
      setMessages((list) => [...list, { id: nextId(), role: 'assistant', content, steps: finished }]);
    }
    setDraft(null);
    setSteps(finished);
  }, []);

  // Скільки контексту зʼїла розмова. Рахуємо по видимій історії плюс те,
  // що зараз друкується, — саме це поїде наступним запитом.
  const usedTokens = useMemo(
    () => estimateTokens(draft !== null ? [...messages, { content: draft }] : messages),
    [messages, draft],
  );

  const visible = useMemo<ChatMessage[]>(
    () => (draft !== null ? [...messages, { id: 'draft', role: 'assistant', content: draft, steps }] : messages),
    [messages, draft, steps],
  );

  const runtime = useExternalStoreRuntime<ChatMessage>({
    isRunning: draft !== null,
    isLoading: false,
    messages: visible,
    convertMessage: (message): ThreadMessageLike => ({
      id: message.id,
      role: message.role,
      content: [{ type: 'text', text: message.content }],
      metadata: { custom: { steps: message.steps ?? [], running: message.id === 'draft',
        agentStatus: message.id === 'draft' ? agentStatus : undefined,
        model: message.model || (message.id === 'draft' ? streamModel : undefined) } },
    }),
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
      await send(text);
    },
    onCancel: cancel,
  });

  return {
    runtime,
    sessions: sessions.data ?? [],
    sessionsLoading: sessions.isPending,
    sessionId,
    openSession,
    newSession,
    steps,
    running: draft !== null,
    compactedFrom,
    usedTokens,
    // PromptBar володіє власним текстом, тож надсилання й зупинка потрібні
    // назовні напряму, повз композер assistant-ui.
    send,
    cancel,
  };
}
