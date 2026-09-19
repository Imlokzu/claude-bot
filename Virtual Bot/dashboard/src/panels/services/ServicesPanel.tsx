import { Play } from 'lucide-react';
import { SlideCommit } from '@/vendor/reactbits';
import { useCssVar } from '@/hooks/useAccentRgb';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Dot } from '@/components/ui/Status';
import { SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { useServiceAction, useServices, useStatus } from '@/lib/queries';
import { glue } from '@/lib/glue';
import { SectionHeader } from '@/components/shell/SectionHeader';

/*
 * Сервіси тіла бота. Це процеси на цій самій машині, тож панель не лише
 * показує стан, а й уміє їх піднімати.
 *
 * `online` — сервіс відповідає на /health. `managed` — його запустила саме
 * ця панель. Різниця істотна: чужий процес зупиняти ми не маємо права, і
 * бекенд це прямо забороняє, тож кнопку «Стоп» для нього глушимо.
 */

const SERVICES = [
  { id: 'vision', label: 'Зір', hint: 'Камера, розпізнавання облич і руху' },
  { id: 'display', label: 'Дисплей', hint: 'Обличчя бота на зовнішньому екрані' },
] as const;

interface ServiceStatus {
  service: string;
  online: boolean;
  managed: boolean;
  pid: number | null;
  error?: string;
}

export default function ServicesPanel() {
  const services = useServices();
  const status = useStatus();
  const action = useServiceAction();
  const toast = useToast();
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const ink2 = useCssVar('--c-text-2', '#6a6056');
  const err = useCssVar('--c-err', '#b2412e');

  const run = (name: string, act: 'start' | 'stop') => {
    action.mutate(
      { name, action: act },
      {
        onSuccess: (result) => {
          const error = (result as ServiceStatus)?.error;
          if (error) toast.error('Сервіс не послухався', error);
          else toast.ok(act === 'start' ? 'Запущено' : 'Зупинено');
        },
        onError: (error) => toast.error('Не вдалося', (error as Error).message),
      },
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto w-full max-w-[720px] space-y-4">
        <SectionHeader
          className="mb-6"
          label="СЕРВІСИ"
          title="Тіло бота"
          hint="Процеси зору й дисплея на цій машині та провайдери, з яких бот бере розум."
        />
        <Panel>
          <PanelHead label="сервіси тіла" hint={glue('Процеси на цій машині')} />
          {services.isPending ? (
            <SkeletonList rows={2} />
          ) : (
            <ul className="divide-y divide-line">
              {SERVICES.map((service) => {
                const state = (services.data as Record<string, ServiceStatus> | undefined)?.[service.id];
                const online = !!state?.online;
                const managed = !!state?.managed;
                return (
                  <li key={service.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <Dot kind={online ? 'ok' : 'idle'} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-ink">{service.label}</p>
                      <p className="text-[12px] text-ink-3">{glue(service.hint)}</p>
                    </div>
                    <span className="u-data hidden text-[11px] text-ink-3 sm:block">
                      {online ? (managed ? `наш · pid ${state?.pid ?? '—'}` : 'чужий процес') : 'офлайн'}
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={online || action.isPending}
                        onClick={() => run(service.id, 'start')}
                      >
                        <Play />
                        Старт
                      </Button>
                      {/* Зупинка — жест, а не клік: сервіс обриває камеру чи
                          екран, і випадкове влучання в кнопку тут коштує
                          дорожче, ніж зайва секунда на протягування.
                          Чужий процес бекенд зупиняти відмовляється, тож для
                          нього елемента немає взагалі. */}
                      {online && managed ? (
                        <SlideCommit
                          label="Протягни, щоб зупинити"
                          doneLabel="Зупинено"
                          errorLabel="Не вийшло"
                          onConfirm={() => run(service.id, 'stop')}
                          disabled={action.isPending}
                          trackColor={surface2}
                          handleColor={ink2}
                          successColor={err}
                          dangerColor={err}
                          width={210}
                          height={38}
                          radius={19}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHead label="провайдери" hint={glue('Звідки бот бере розум')} />
          <ul className="divide-y divide-line text-sm">
            {[
              ['OpenClaw', status.data?.openclaw],
              ['Omni-роутер', status.data?.omni],
              ['Anthropic API', status.data?.anthropic],
              ['Chat2API', status.data?.chat2api],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <span className="text-ink-2">{label}</span>
                <span className="flex items-center gap-2">
                  <Dot kind={ok ? 'ok' : 'idle'} />
                  <span className="u-data text-[11px] text-ink-3">
                    {ok ? 'налаштовано' : 'немає'}
                  </span>
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between py-2.5 last:pb-0">
              <span className="text-ink-2">Мозок останньої відповіді</span>
              <span className="u-data text-[12px] text-ink">
                {status.data?.mode && status.data.mode !== 'unknown' ? status.data.mode : '—'}
              </span>
            </li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}
