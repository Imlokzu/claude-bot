import { useCallback, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { streamChat } from '@/lib/chatStream';
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
  // Чи була відповідь у цій розмові вже. Потрібно, щоб блок «Думаю…» після
  // відповіді згорнувся в «Думав N с» і лишився, навіть коли інструментів не
  // викликали: тривалість — теж відповідь на «що там відбувалось».
  const [answered, setAnswered] = useState(false);
  // Скільки реплік сховано за переказом. 0 — розмову не стискали.
  const [compactedFrom, setCompactedFrom] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await get<{ sessions: SessionSummary[] }>('/api/sessions')).sessions ?? [],
  });

  /** Відкриває збережену розмову. */
  const openSession = useCallback(
    async (id: string) => {
      abortRef.current?.abort();
      setSessionId(id);
      setDraft(null);
      setSteps([]);
      setAnswered(false);
      setCompactedFrom(0);
      if (!id) {
        setMessages([]);
        return;
      }
      try {
        const data = await get<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
        // Переказ завжди стоїть першим і єдиним — саме так його пише
        // chat_store.compact.
        setCompactedFrom(Number(data.messages?.[0]?.compacted_from ?? 0));
        setMessages(
          (data.messages ?? []).map((message, index) => ({
            id: `${id}-${index}`,
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content ?? '',
            ts: message.ts,
            attachments: message.attachments,
          })),
        );
      } catch (error) {
        toast.error('Не вдалося відкрити розмову', (error as Error).message);
      }
    },
    [toast],
  );

  const newSession = useCallback(() => {
    abortRef.current?.abort();
    setSessionId('');
    setMessages([]);
    setDraft(null);
    setSteps([]);
    setAnswered(false);
    setCompactedFrom(0);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const controller = new AbortController();
      abortRef.current = controller;

      setMessages((current) => [...current, { id: nextId(), role: 'user', content: trimmed }]);
      setDraft('');
      setSteps([]);
      setAnswered(false);

      let accumulated = '';

      await streamChat(
        {
          message: trimmed,
          session_id: sessionId || undefined,
          // reasoning_effort тут більше не шлемо. Він діяв лише на прямий
          // виклик Omni (картинки), а в чаті відповідає OpenClaw, і глибину
          // думання йому задає власний конфіг — див. /api/brain/thinking.
          // Поле, яке нічого не міняє в тому шляху, яким іде відповідь,
          // створювало б ілюзію керування.
        },
        {
          onDelta: (chunk) => {
            accumulated += chunk;
            setDraft(accumulated);
          },
          onTool: (event) => {
            const tool = String(event.tool ?? 'тулз');
            setSteps((current) => {
              if (event.type === 'tool_start') {
                return [
                  ...current,
                  {
                    id: `${tool}-${current.length}`,
                    label: tool,
                    detail: String(event.detail ?? ''),
                    status: 'active',
                  },
                ];
              }
              if (event.type === 'tool_done' || event.type === 'tool_result') {
                // Закриваємо ОСТАННІЙ активний крок із цим іменем: той самий
                // тулз може бути викликаний кілька разів за відповідь.
                const index = current.map((s) => s.label === tool && s.status === 'active').lastIndexOf(true);
                if (index === -1) return current;
                const next = [...current];
                next[index] = { ...next[index], status: 'done' };
                return next;
              }
              return current;
            });
          },
          onDone: (result) => {
            setMessages((current) => [
              ...current,
              { id: nextId(), role: 'assistant', content: result.reply },
            ]);
            setDraft(null);
            // Кроки НЕ чистимо: блок «Думаю…» згортається в «Думав N с» і
            // лишається біля відповіді, поки не почнеться наступна. Питання
            // «а що він робив?» виникає саме тоді, коли відповідь уже є.
            // Скидає їх `send` на початку наступного запиту.
            setAnswered(true);
            // Бекенд міг створити нову розмову й дати їй назву у фоні.
            if (result.session_id && result.session_id !== sessionId) setSessionId(result.session_id);
            void client.invalidateQueries({ queryKey: ['sessions'] });
            void client.invalidateQueries({ queryKey: ['models'] });
          },
          onError: (message) => {
            setDraft(null);
            setSteps([]);
            toast.error('Бот не відповів', message);
          },
        },
        controller.signal,
      ).catch((error: unknown) => {
        setDraft(null);
        setSteps([]);
        // Перерване користувачем — не помилка, повідомляти нема про що.
        if ((error as Error)?.name === 'AbortError') return;
        toast.error('Збій звʼязку', (error as Error).message);
      });

      abortRef.current = null;
    },
    [client, sessionId, toast],
  );

  const cancel = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Те, що встигло надійти, лишаємо в історії: викидати половину відповіді
    // після натиску «стоп» — втрата, а не охайність.
    setDraft((current) => {
      if (current) {
        setMessages((list) => [...list, { id: nextId(), role: 'assistant', content: current }]);
      }
      return null;
    });
    setSteps([]);
  }, []);

  // Скільки контексту зʼїла розмова. Рахуємо по видимій історії плюс те,
  // що зараз друкується, — саме це поїде наступним запитом.
  const usedTokens = useMemo(
    () => estimateTokens(draft !== null ? [...messages, { content: draft }] : messages),
    [messages, draft],
  );

  const visible = useMemo<ChatMessage[]>(
    () => (draft !== null ? [...messages, { id: 'draft', role: 'assistant', content: draft }] : messages),
    [messages, draft],
  );

  const runtime = useExternalStoreRuntime<ChatMessage>({
    isRunning: draft !== null,
    isLoading: false,
    messages: visible,
    convertMessage: (message): ThreadMessageLike => ({
      id: message.id,
      role: message.role,
      content: [{ type: 'text', text: message.content }],
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
    answered,
    compactedFrom,
    usedTokens,
    // PromptBar володіє власним текстом, тож надсилання й зупинка потрібні
    // назовні напряму, повз композер assistant-ui.
    send,
    cancel,
  };
}
