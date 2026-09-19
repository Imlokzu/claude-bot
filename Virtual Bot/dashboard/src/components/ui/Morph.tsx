import { TextMorph } from 'torph/react';
import { cn } from '@/lib/cn';

/*
 * Текст, що змінюється на місці — Torph («UI things»).
 *
 * Береться лише там, де рядок ЗАМІЩУЄТЬСЯ, а не з'являється: чим бот зайнятий,
 * назва моделі, назва треку, лічильники. Для появи тексту морфінг зайвий і
 * лише відволікає.
 */
export function Morph({
  children,
  className,
  mono,
}: {
  children: string | number;
  className?: string;
  mono?: boolean;
}) {
  return (
    <TextMorph
      className={cn(mono && 'u-data', className)}
      ease={{ stiffness: 240, damping: 26 }}
      respectReducedMotion
    >
      {String(children)}
    </TextMorph>
  );
}
