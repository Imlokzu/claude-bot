import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Eye, MessageSquare } from 'lucide-react';
import { AnimatedContent, DotGrid, GlobalSpotlight, StarBorder } from '@/vendor/reactbits';
import { SectionHeader } from '@/components/shell/SectionHeader';
import { Tile, TileHead, TileNumber } from './Tile';
import { BotState } from './BotState';
import { PacksTile } from './PacksTile';
import { ProjectsTile } from './ProjectsTile';
import { Dot } from '@/components/ui/Status';
import { useAccentColor, useAccentRgb, useCssVar } from '@/hooks/useAccentRgb';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useBotEvents } from '@/hooks/useBotEvents';
import { useServices, useStatus } from '@/lib/queries';
import { get } from '@/lib/api';

/*
 * Огляд — новий головний екран.
 *
 * Стара панель відкривалась одразу в чат, і на питання «що бот робить прямо
 * зараз» відповіді не було ніде: стан сервісів жив у одній вкладці, логи в
 * другій, памʼять у третій. Тут усе це — одна сітка, яку видно з крісла.
 *
 * Механіка сітки — MagicBento з React Bits: спільний прожектор іде за
 * курсором по всіх плитках, кожна має свої частинки й магнетизм.
 */
export default function OverviewPanel() {
  const gridRef = useRef<HTMLDivElement>(null);
  const glow = useAccentRgb();
  const accent = useAccentColor();
  // DotGrid малює в canvas — колір має бути обчисленим, не var().
  const line = useCssVar('--c-border', '#ded5c6');
  const fine = useMediaQuery('(hover: hover) and (pointer: fine)');
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  const status = useStatus();
  const services = useServices();

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () =>
      (await get<{ sessions: { id: string; title?: string; count?: number; updated?: number }[] }>(
        '/api/sessions',
      )).sessions ?? [],
  });

  const notes = useQuery({
    queryKey: ['memory-notes'],
    queryFn: async () => (await get<{ files: unknown[] }>('/api/memory/list')).files ?? [],
  });

  // Стрічка логів: три останні рядки просто в плитці — щоб помітити збій,
  // не відкриваючи розділ «Логи».
  const [tail, setTail] = useState<string[]>([]);
  useBotEvents((event) => {
    if (event.type !== 'log') return;
    setTail((current) => [...current, String(event.msg ?? '')].slice(-3));
  });

  useEffect(() => {
    void get<{ logs: { msg: string }[] }>('/api/console')
      .then((data) => setTail((data.logs ?? []).slice(-3).map((line) => line.msg)))
      .catch(() => undefined);
  }, []);

  const last = sessions.data?.[0];
  const vision = (services.data as Record<string, { online?: boolean }> | undefined)?.vision;
  const display = (services.data as Record<string, { online?: boolean }> | undefined)?.display;

  const go = (hash: string) => () => {
    window.location.hash = `#/${hash}`;
  };

  const providers = useMemo(
    () =>
      [
        ['OpenClaw', status.data?.openclaw],
        ['Omni', status.data?.omni],
        ['Anthropic', status.data?.anthropic],
      ] as const,
    [status.data],
  );

  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto">
      {/* Тло — DotGrid (React Bits): сітка точок, що розступається під
          курсором. Єдиний «живий» фон у панелі й лише тут: на екранах із
          текстом він заважав би читати. */}
      {fine && !reduced ? (
        <div className="pointer-events-none absolute inset-0 opacity-[0.55]">
          <DotGrid
            dotSize={2}
            gap={26}
            baseColor={line}
            activeColor={accent}
            proximity={110}
            shockRadius={180}
            shockStrength={3}
            className="pointer-events-auto size-full"
          />
        </div>
      ) : null}

      <div className="relative mx-auto w-full max-w-[1120px] p-4 sm:p-6">
        <SectionHeader className="mb-5" label="ОГЛЯД" title="Що бот робить зараз" />

        <GlobalSpotlight
          gridRef={gridRef}
          enabled={fine && !reduced}
          disableAnimations={!fine || reduced}
          spotlightRadius={340}
          glowColor={glow}
        />

        <AnimatedContent distance={24} duration={0.5} threshold={0} className="block">
          <div
            ref={gridRef}
            // Рядок фіксованої висоти: без нього плитка 2×2 розтягувала б обидва
            // рядки під себе, і сітка з компактної ставала вдвічі вищою.
            className="grid auto-rows-[132px] grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {/* Обличчя — найбільша плитка: саме на неї дивляться першою. */}
            <Tile span="lg" interactive={false} className="!p-0">
              <BotState />
            </Tile>

            <Tile span="md">
              <TileHead
                label="остання розмова"
                action={
                  <button
                    type="button"
                    onClick={go('chat')}
                    className="text-ink-3 transition-colors hover:text-ink"
                    aria-label="Відкрити чат"
                  >
                    <ArrowUpRight className="size-4" />
                  </button>
                }
              />
              <p className="line-clamp-2 text-[15px] leading-snug text-ink">
                {last?.title || 'Розмов ще не було'}
              </p>
              <TileNumber value={last?.count ?? null} suffix="реплік" />
            </Tile>

            <Tile>
              <TileHead label="памʼять" />
              <TileNumber value={notes.data?.length ?? null} suffix="нотаток" />
            </Tile>

            {/* Тут раніше стояло число обʼєктів у робочій теці — рядок, з
                якого нічого не випливало й нікуди не вело. Проєкти на його
                місці і показують, що в бота є, і відкриваються. */}
            <Tile span="lg" interactive={false}>
              <TileHead label="проєкти" />
              <ProjectsTile />
            </Tile>

            <Tile span="md">
              <TileHead label="сервіси тіла" />
              <ul className="mt-1 space-y-2 text-[13px]">
                <li className="flex items-center gap-2.5">
                  <Dot kind={vision?.online ? 'ok' : 'idle'} />
                  <span className="flex-1 text-ink-2">Зір</span>
                  <span className="u-data text-[11px] text-ink-3">
                    {vision?.online ? 'онлайн' : 'офлайн'}
                  </span>
                </li>
                <li className="flex items-center gap-2.5">
                  <Dot kind={display?.online ? 'ok' : 'idle'} />
                  <span className="flex-1 text-ink-2">Дисплей</span>
                  <span className="u-data text-[11px] text-ink-3">
                    {display?.online ? 'онлайн' : 'офлайн'}
                  </span>
                </li>
              </ul>
            </Tile>

            <Tile span="md">
              <TileHead label="мозок" />
              <p className="u-data mb-2 truncate text-[15px] text-ink">
                {status.data?.mode && status.data.mode !== 'unknown'
                  ? status.data.mode
                  : 'ще не відповідав'}
              </p>
              <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 text-[12px]">
                {providers.map(([label, ok]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <Dot kind={ok ? 'ok' : 'idle'} />
                    <span className="text-ink-3">{label}</span>
                  </li>
                ))}
              </ul>
            </Tile>

            <Tile span="wide">
              <TileHead
                label="останнє в консолі"
                action={
                  <button
                    type="button"
                    onClick={go('logs')}
                    className="text-ink-3 transition-colors hover:text-ink"
                    aria-label="Відкрити логи"
                  >
                    <ArrowUpRight className="size-4" />
                  </button>
                }
              />
              <ul className="space-y-1 font-mono text-[11.5px] leading-[1.6] text-ink-3">
                {tail.length === 0 ? (
                  <li>тиша</li>
                ) : (
                  tail.map((line, index) => (
                    <li key={index} className="truncate">
                      {line}
                    </li>
                  ))
                )}
              </ul>
            </Tile>

            {/* Пакети екрана — тека, з якої вони висипаються (FolderFloat).
                Стоїть саме в «Огляді»: це коротка відповідь на питання «що в
                бота встановлено», а не окремий розділ із керуванням. */}
            {/* Плитка на два рядки: пакети ВИЛІТАЮТЬ із теки вгору, і в
                звичайній плитці 132 px їх зрізало б по верхньому краю. */}
            <Tile span="lg" interactive={false}>
              <TileHead label="пакети екрана" />
              <PacksTile />
            </Tile>

            <Tile span="md" className="justify-between">
              <TileHead label="швидкі дії" />
              <div className="flex flex-wrap gap-2">
                <StarBorder
                  as="button"
                  onClick={go('chat')}
                  color={accent}
                  speed="7s"
                  thickness={1}
                  backgroundColor="var(--c-surface-2)"
                  textColor="var(--c-text)"
                  borderColor="var(--c-border)"
                >
                  <span className="flex items-center gap-2 text-[13px]">
                    <MessageSquare className="size-4" />
                    Нова розмова
                  </span>
                </StarBorder>
                <button
                  type="button"
                  onClick={go('vision')}
                  className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
                >
                  <Eye className="size-4" />
                  Подивитись
                </button>
              </div>
            </Tile>
          </div>
        </AnimatedContent>
      </div>
    </div>
  );
}
