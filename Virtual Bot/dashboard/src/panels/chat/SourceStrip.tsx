import { useMemo } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { collectSources } from './sources';
import { useIsPhone } from '@/hooks/useMediaQuery';
import { t } from '@/locales/chat';
import type { ToolStep } from './types';

/*
 * The strip of pages a reply was built from.
 *
 * Collapsed it is one line — a count and the hostnames — because most of the
 * time the question is only "did it actually look anything up, and where".
 * Opening it gives the titles and the links.
 *
 * No favicons. Fetching them means a request per host to a third party on
 * every reply, which both leaks what the owner is reading and leaves holes in
 * the strip whenever the panel runs without network — and the panel is built
 * to run without network. A monospace initial carries the same recognition
 * and matches the rest of the instrument.
 */

function Initial({ host }: { host: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-[18px] shrink-0 place-items-center rounded-xs border border-line bg-surface-2 font-mono text-[10px] uppercase text-ink-2"
    >
      {host.slice(0, 1)}
    </span>
  );
}

export function SourceStrip({ steps }: { steps: ToolStep[] }) {
  const sources = useMemo(() => collectSources(steps), [steps]);
  const isPhone = useIsPhone();
  if (!sources.length) return null;

  // Hosts, not links: the same site found five times is still one name here.
  const hosts = [...new Set(sources.map((source) => source.host))];
  // Four names fit a desktop column; on a phone they shrink to "e…", which
  // names nothing. Two readable names beat four unreadable ones.
  const shown = isPhone ? 2 : 4;

  return (
    <details className="group mt-3 min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm py-1 outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden">
        <span className="u-label shrink-0 text-ink-3">
          {t('sources.label', { count: sources.length })}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {hosts.slice(0, shown).map((host) => (
            <span key={host} className="flex items-center gap-1 truncate font-mono text-[11px] text-ink-3">
              <Initial host={host} />
              <span className="truncate">{host}</span>
            </span>
          ))}
          {hosts.length > shown ? (
            <span className="shrink-0 font-mono text-[11px] text-ink-3">+{hosts.length - shown}</span>
          ) : null}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-ink-3 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
      </summary>

      <ol className="mt-1.5 space-y-0.5 border-l border-line pl-3">
        {sources.map((source, index) => (
          <li key={source.url}>
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="group/src flex items-start gap-2 rounded-sm px-1.5 py-1.5 transition-colors hover:bg-surface"
            >
              <span className="mt-px shrink-0 font-mono text-[10px] text-ink-3">{index + 1}</span>
              <Initial host={source.host} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{source.title || source.host}</span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">
                  {source.host} · {source.tool}
                </span>
              </span>
              <ExternalLink className="mt-0.5 size-3 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover/src:opacity-100 motion-reduce:transition-none" />
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
