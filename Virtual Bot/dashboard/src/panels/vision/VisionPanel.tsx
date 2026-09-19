import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Play, Square } from 'lucide-react';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Status';
import { useToast } from '@/components/ui/Toaster';
import { useBotEvents } from '@/hooks/useBotEvents';
import { get } from '@/lib/api';
import { useStatus } from '@/lib/queries';
import { glue } from '@/lib/glue';
import { SectionHeader } from '@/components/shell/SectionHeader';
import { RefineFrame } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';

/*
 * Зір.
 *
 * MJPEG беремо НАПРЯМУ з сервісу Vision (порт 8000), а не через бекенд:
 * потік нескінченний, і пропущений крізь FastAPI він зайняв би воркер на
 * весь час перегляду. Так само робила стара панель.
 */
const STREAM_URL = 'http://127.0.0.1:8000/vision/stream.mjpg';

export default function VisionPanel() {
  const status = useStatus();
  const toast = useToast();
  const [streaming, setStreaming] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [badge, setBadge] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink = useCssVar('--c-text', '#231e19');
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = useCallback(() => {
    setStreaming(true);
    // Мітка часу в адресі: без неї браузер віддає кешований мертвий потік
    // після перезапуску сервісу Vision.
    setSrc(`${STREAM_URL}?t=${Date.now()}`);
  }, []);

  const stop = useCallback(() => {
    setStreaming(false);
    setSrc(null);
  }, []);

  useEffect(() => () => {
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
  }, []);

  useBotEvents((event) => {
    if (event.type !== 'vision') return;
    const kind = String(event.event ?? '');
    const faces = Number(event.faces ?? 0);
    const text =
      kind === 'face_appeared'
        ? `Бачу людей: ${faces}`
        : kind === 'face_gone'
          ? 'Нікого не видно'
          : 'Рух у кадрі';
    setBadge(text);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => setBadge(null), 4000);
  });

  const takeSnapshot = async () => {
    setShooting(true);
    try {
      const data = await get<{ image?: string; error?: string }>('/api/vision/snapshot');
      if (data.image) setSnapshot(data.image);
      else toast.error('Знімок не вийшов', data.error || 'Сервіс зору мовчить');
    } catch (error) {
      toast.error('Знімок не вийшов', (error as Error).message);
    } finally {
      setShooting(false);
    }
  };

  const online = !!status.data?.vision;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-[860px] space-y-4">
        <SectionHeader
          className="mb-6"
          label="ЗІР"
          title="Що бачить бот"
          hint="Потік іде напряму з сервісу зору, повз бекенд панелі."
        />
        <Panel>
          <PanelHead
            label="камера"
            hint={online ? 'Сервіс зору онлайн' : glue('Сервіс зору не відповідає')}
            actions={<Dot kind={online ? 'ok' : 'idle'} />}
          />

          <div className="relative aspect-video w-full overflow-hidden rounded-md border border-line bg-surface-2">
            {src ? (
              <img
                src={src}
                alt="Потік камери"
                className="size-full object-contain"
                onError={() => {
                  stop();
                  toast.error('Потік обірвався', 'Схоже, сервіс зору офлайн');
                }}
              />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-2 text-ink-3">
                <CameraOff className="size-7" />
                <span className="text-[13px]">Потік вимкнено</span>
              </div>
            )}

            {badge ? (
              <span className="u-data absolute left-3 top-3 rounded-full bg-surface/85 px-2.5 py-1 text-[11px] text-ink">
                {badge}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex gap-2">
            <Button variant={streaming ? 'quiet' : 'solid'} onClick={streaming ? stop : start}>
              {streaming ? <Square className="fill-current" /> : <Play className="fill-current" />}
              {streaming ? 'Зупинити' : 'Дивитись'}
            </Button>
            <Button variant="outline" onClick={takeSnapshot}>
              <Camera />
              Знімок
            </Button>
          </div>
        </Panel>

        {snapshot ? (
          <Panel>
            <PanelHead
              label="знімок"
              actions={
                <Button variant="ghost" size="sm" onClick={() => setSnapshot(null)}>
                  Прибрати
                </Button>
              }
            />
            {/* Рамка зі стадіями: знімок проходить шлях «беру кадр →
                готую → готово», і видно, що саме зараз відбувається. */}
            <RefineFrame
              status={shooting ? 'generating' : 'done'}
              width="100%"
              aspectRatio="16 / 9"
              radius={11}
              background={surface2}
              color={ink}
              labels={{ generating: 'Беру кадр', refining: 'Готую', done: 'Готово' }}
            >
              <img
                src={snapshot.startsWith('data:') ? snapshot : `data:image/jpeg;base64,${snapshot}`}
                alt="Знімок з камери"
                className="size-full object-contain"
              />
            </RefineFrame>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}
