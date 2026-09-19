import { useMemo } from 'react';
import { Orb, ThinkingReasoning } from '@/vendor/aicss';
import { LatticeLoader } from '@/vendor/reactbits';
import { stepLine, toolLook } from '@/lib/toolLabels';
import type { ToolStep } from './types';

/*
 * «Думаю…» під стрічкою розмови.
 *
 * Блок — aicss.dev/r/thinking-reasoning: мітка з шимером, під нею рядки, які
 * після відповіді складаються в «Думав N с» із можливістю розгорнути.
 *
 * Важливо, ЧИМ його наповнено. В оригіналі це вигадані речення про хід
 * думки; у нас моделі не віддають своїх міркувань потоком (у SSE приходять
 * лише delta/tool_*), тож показувати «роздуми» тут означало б їх вигадати.
 * Тому рядки — це РЕАЛЬНІ дії: кожен виклик інструмента з його аргументом.
 * Якщо бот просто відповідає, не викликавши нічого, лишається сама мітка —
 * і це теж правда: думати вголос не було чого.
 *
 * Значок ліворуч — LatticeLoader (React Bits) замість колишнього ThoughtLine:
 * решітка живе, поки відповідь пишеться, і гасне, коли готово.
 * Значок біля кожного рядка — орб aicss, підібраний за дією (шукає, пише,
 * читає): рух розрізняє дії швидше, ніж підпис.
 */
export function Thinking({ steps, running }: { steps: ToolStep[]; running: boolean }) {
  const lines = useMemo(
    () =>
      steps.map((step) => (
        <span key={step.id} className="flex items-center gap-2">
          <Orb variant={toolLook(step.label).orb} size={14} />
          <span className="min-w-0 truncate">{stepLine(step.label, step.detail)}</span>
        </span>
      )),
    [steps],
  );

  return (
    <div className="mb-6 pl-6">
      <ThinkingReasoning
        lines={lines}
        busy={running}
        label="Думаю…"
        doneLabel={(seconds) => `Думав ${seconds} с`}
        glyph={
          <LatticeLoader
            status={running ? 'working' : 'done'}
            showTimer={false}
            label=""
            doneLabel=""
            cellSize={4}
            gap={2}
            color="var(--c-accent)"
            doneColor="var(--c-ok)"
            idleOpacity={0.18}
          />
        }
      />
    </div>
  );
}
