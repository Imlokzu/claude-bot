import { useEffect, useRef, useState } from 'react';
import { subscribe, subscribeStatus, type BotEvent } from '@/lib/events';

/**
 * Підписка на живі події бота. Обробник тримаємо в ref, щоб перемальовка
 * компонента не рвала й не піднімала EventSource заново.
 */
export function useBotEvents(handler: (event: BotEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => subscribe((event) => ref.current(event)), []);
}

/** Чи жива стрічка подій — для крапки стану в шапці. */
export function useEventsConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => subscribeStatus(setConnected), []);
  return connected;
}
