import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CometDial, GlideSelect, VoicePill, WakeSlider } from '@/vendor/reactbits';
import { Panel, PanelHead } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Empty, SkeletonList } from '@/components/ui/Feedback';
import { useToast } from '@/components/ui/Toaster';
import { useCssVar } from '@/hooks/useAccentRgb';
import { authHeaders } from '@/lib/auth';
import { get, post } from '@/lib/api';
import { glue } from '@/lib/glue';
import { MicOff, Play } from 'lucide-react';

/*
 * Голос бота.
 *
 * У старій панелі озвучка й мікрофон жили в окремому оверлеї, який відкривався
 * поверх чату; налаштувати голос, не заходячи в розмову, було неможливо.
 * Тут вони там, де їм місце, — у налаштуваннях, з можливістю послухати
 * одразу.
 *
 * Керування — готові елементи з React Bits: GlideSelect (голос), WakeSlider
 * (темп, бо смужка звуку — найпряміша метафора мовлення), CometDial
 * (гучність прослуховування), VoicePill (перевірка мікрофона).
 */

interface TtsStatus {
  enabled: boolean;
  provider: string;
  voices: { id: number | string; name: string; hint?: string }[];
  selected: number | string | null;
  speeds: number[];
}

const SAMPLE = 'Привіт! Я Клод Бот. Так звучить мій голос.';

export function VoiceSection() {
  const toast = useToast();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const accent = useCssVar('--c-accent', '#b95f3d');
  const accentInk = useCssVar('--c-accent-ink', '#fff');
  const surface2 = useCssVar('--c-surface-2', '#efe9df');
  const surface3 = useCssVar('--c-surface-3', '#e5ddd0');
  const ink = useCssVar('--c-text', '#231e19');

  const tts = useQuery({ queryKey: ['tts-status'], queryFn: () => get<TtsStatus>('/api/tts/status') });
  const asr = useQuery({ queryKey: ['asr-status'], queryFn: () => get<{ enabled: boolean }>('/api/asr/status') });

  // Повзунок стартує на звичайному темпі (×1), а не на максимумі:
  // 100 % за замовчуванням означало б, що бот одразу тараторить.
  const [speed, setSpeed] = useState(0);
  const [volume, setVolume] = useState(80);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    audioRef.current?.pause();
  }, []);

  // Межі темпу приходять від провайдера, тож позицію «×1» рахуємо після
  // завантаження статусу: у Piper це 0 %, в ElevenLabs — теж 0 %, але шкала
  // коротша, і фіксоване число тут брехало б.
  useEffect(() => {
    const list = tts.data?.speeds;
    if (!list || list.length === 0) return;
    const low = Math.min(...list, 1);
    const high = Math.max(...list, 1);
    setSpeed(high === low ? 0 : Math.round(((1 - low) / (high - low)) * 100));
  }, [tts.data?.speeds]);

  const speeds = tts.data?.speeds ?? [1];
  const minSpeed = Math.min(...speeds, 1);
  const maxSpeed = Math.max(...speeds, 1);
  // Повзунок ходить у відсотках, бо межі темпу залежать від провайдера:
  // Piper тягне до 2×, ElevenLabs — лише до 1.2×.
  const realSpeed = minSpeed + ((maxSpeed - minSpeed) * speed) / 100;

  const preview = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ text: SAMPLE, speed: Number(realSpeed.toFixed(2)) }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.volume = volume / 100;
      audioRef.current = audio;
      await audio.play();
    } catch (error) {
      toast.error('Не вдалося озвучити', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (tts.isPending) {
    return (
      <Panel>
        <SkeletonList rows={5} />
      </Panel>
    );
  }

  if (!tts.data?.enabled) {
    return (
      <Panel>
        <PanelHead label="голос" />
        <Empty
          icon={MicOff}
          title="Озвучки немає"
          hint={glue('Ні локального Piper, ні ключа ElevenLabs. Бот відповідатиме текстом.')}
        />
      </Panel>
    );
  }

  return (
    <Panel className="space-y-5">
      <PanelHead label="голос" hint={`провайдер: ${tts.data.provider}`} />

      <Field label="Голос">
        <GlideSelect
          options={(tts.data.voices ?? []).map((voice) => ({
            value: String(voice.id),
            label: voice.name || `Голос ${voice.id}`,
            tag: voice.hint,
          }))}
          value={String(tts.data.selected ?? '')}
          onChange={(next) => {
            void post('/api/tts/voice', { speaker: Number(next) })
              .then(() => {
                void tts.refetch();
                toast.ok('Голос змінено');
              })
              .catch((error: Error) => toast.error('Голос не прийнявся', error.message));
          }}
          ariaLabel="Голос бота"
          size="md"
          radius={10}
          menuWidth={280}
          placement="bottom"
          accentColor={accent}
          surfaceColor={surface2}
          highlightColor={surface3}
          textColor={ink}
        />
      </Field>

      <Field label="Темп мовлення" hint={`×${realSpeed.toFixed(2)}`}>
        <WakeSlider
          value={speed}
          onChange={setSpeed}
          min={0}
          max={100}
          bars={28}
          height={46}
          restHeight={8}
          gap={3}
          fillColor={accent}
          trackColor={surface3}
          ariaLabel="Темп мовлення"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-6">
        <div>
          <p className="u-label mb-2">гучність прослуховування</p>
          <CometDial
            value={volume}
            onChange={setVolume}
            min={0}
            max={100}
            unit="%"
            label="Гучність"
            size={132}
            thickness={4}
            accent={accent}
            ink={ink}
          />
        </div>

        <div className="space-y-3">
          <Button variant="solid" onClick={() => void preview()} disabled={busy}>
            <Play className="fill-current" />
            {busy ? 'Готую…' : 'Послухати'}
          </Button>

          <div>
            <p className="u-label mb-2">мікрофон</p>
            {asr.data?.enabled ? (
              <VoicePill
                mode="hold"
                reactive="mic"
                size={30}
                accentColor={accent}
                iconColor={accentInk}
                background={surface2}
                ariaLabel="Перевірити мікрофон"
              />
            ) : (
              <p className="text-[12px] text-ink-3">{glue('Розпізнавання мови вимкнено')}</p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
