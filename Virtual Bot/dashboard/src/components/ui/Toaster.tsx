import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SwipeToast } from '@/vendor/reactbits';

/*
 * Тости — React Bits · SwipeToast у власному стосі.
 *
 * Компонент уміє позиціонувати себе сам, але тоді кілька тостів лягли б один
 * на одного. Тому вмикаємо inline (position: relative) і складаємо їх тут:
 * так само працює змах для закриття, але з'являється нормальна черга.
 */

export type ToastTone = 'info' | 'ok' | 'error';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  tone: ToastTone;
  duration: number;
}

interface ToastApi {
  toast: (title: string, options?: { description?: string; tone?: ToastTone; duration?: number }) => void;
  error: (title: string, description?: string) => void;
  ok: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const FUSE: Record<ToastTone, string> = {
  info: 'var(--c-accent)',
  ok: 'var(--c-ok)',
  error: 'var(--c-err)',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const toast: ToastApi['toast'] = (title, options = {}) => {
      const item: ToastItem = {
        id: nextId.current++,
        title,
        description: options.description,
        tone: options.tone ?? 'info',
        // Помилку читають довше: її треба встигнути зрозуміти, а не лише помітити.
        duration: options.duration ?? (options.tone === 'error' ? 7000 : 4000),
      };
      // Більше чотирьох — це вже не сповіщення, а стіна. Найстаріші йдуть.
      setItems((current) => [...current.slice(-3), item]);
    };
    return {
      toast,
      error: (title, description) => toast(title, { description, tone: 'error' }),
      ok: (title, description) => toast(title, { description, tone: 'ok' }),
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="u-safe-b pointer-events-none fixed inset-x-0 bottom-0 flex flex-col items-center gap-2 p-4 sm:items-end"
        style={{ zIndex: 'var(--z-toast)' }}
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              className="pointer-events-auto"
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.14 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 34 }}
            >
              <SwipeToast
                inline
                open
                title={item.title}
                description={item.description}
                duration={item.duration}
                onClose={() => remove(item.id)}
                background="var(--c-surface-3)"
                color="var(--c-text)"
                fuseColor={FUSE[item.tone]}
                radius={11}
                width={340}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast викликано поза <ToastProvider>');
  return api;
}
