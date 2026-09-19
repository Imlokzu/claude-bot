import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Search } from 'lucide-react';
import { SECTIONS } from '@/app/sections';
import { ACCENTS, THEMES, useTheme } from '@/hooks/useTheme';
import { useServiceAction } from '@/lib/queries';
import { cn } from '@/lib/cn';

/*
 * Командна палітра (⌘K / Ctrl+K).
 *
 * Дає те, чого не давала жодна вкладка: дію без навігації. Перемкнути тему,
 * підняти сервіс, стрибнути в розділ — не шукаючи, у якій вкладці воно
 * живе. Для панелі, відкритої годинами, це головний прискорювач.
 */

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const { setTheme, setAccent } = useTheme();
  const serviceAction = useServiceAction();

  const commands = useMemo<Command[]>(() => {
    const go = SECTIONS.map((section) => ({
      id: `go-${section.id}`,
      label: section.label,
      group: 'Перейти',
      run: () => {
        window.location.hash = `#/${section.id}`;
      },
    }));

    const looks: Command[] = [
      ...THEMES.map((theme) => ({
        id: `theme-${theme.id}`,
        label: theme.label,
        group: 'Тема',
        run: () => setTheme(theme.id),
      })),
      ...ACCENTS.map((accent) => ({
        id: `accent-${accent.id}`,
        label: accent.label,
        group: 'Акцент',
        run: () => setAccent(accent.id),
      })),
    ];

    const services: Command[] = [
      { id: 'vision-start', label: 'Запустити зір', group: 'Сервіси', run: () => serviceAction.mutate({ name: 'vision', action: 'start' }) },
      { id: 'vision-stop', label: 'Зупинити зір', group: 'Сервіси', run: () => serviceAction.mutate({ name: 'vision', action: 'stop' }) },
      { id: 'display-start', label: 'Запустити дисплей', group: 'Сервіси', run: () => serviceAction.mutate({ name: 'display', action: 'start' }) },
      { id: 'display-stop', label: 'Зупинити дисплей', group: 'Сервіси', run: () => serviceAction.mutate({ name: 'display', action: 'stop' }) },
    ];

    return [...go, ...looks, ...services];
  }, [setAccent, setTheme, serviceAction]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        command.group.toLowerCase().includes(needle),
    );
  }, [commands, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setCursor(0);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Курсор не має лишатись за межами відфільтрованого списку.
  useEffect(() => {
    setCursor((value) => Math.min(value, Math.max(0, shown.length - 1)));
  }, [shown.length]);

  const runAt = (index: number) => {
    const command = shown[index];
    if (!command) return;
    setOpen(false);
    command.run();
  };

  let lastGroup = '';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]"
          style={{ zIndex: 'var(--z-modal)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          <div
            className="absolute inset-0"
            style={{ background: 'var(--c-overlay)' }}
            onClick={() => setOpen(false)}
          />

          <motion.div
            className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 560, damping: 38 }}
            role="dialog"
            aria-modal="true"
            aria-label="Команди"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-ink-3" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setCursor((value) => Math.min(value + 1, shown.length - 1));
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setCursor((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    runAt(cursor);
                  }
                }}
                placeholder="Команда або розділ…"
                className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus-visible:outline-none"
              />
              <kbd className="u-data hidden shrink-0 rounded-xs border border-line px-1.5 py-0.5 text-[10px] text-ink-3 sm:block">
                esc
              </kbd>
            </div>

            <ul className="max-h-[52dvh] overflow-y-auto p-1.5">
              {shown.length === 0 ? (
                <li className="px-3 py-6 text-center text-[13px] text-ink-3">Нічого не знайшлось</li>
              ) : (
                shown.map((command, index) => {
                  const header = command.group !== lastGroup ? command.group : null;
                  lastGroup = command.group;
                  return (
                    <li key={command.id}>
                      {header ? <p className="u-label px-2.5 pb-1 pt-3 first:pt-1">{header}</p> : null}
                      <button
                        type="button"
                        onMouseEnter={() => setCursor(index)}
                        onClick={() => runAt(index)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13.5px]',
                          index === cursor ? 'bg-accent-soft text-ink' : 'text-ink-2',
                        )}
                      >
                        <span className="flex-1">{command.label}</span>
                        {index === cursor ? (
                          <CornerDownLeft className="size-3.5 shrink-0 text-ink-3" />
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
