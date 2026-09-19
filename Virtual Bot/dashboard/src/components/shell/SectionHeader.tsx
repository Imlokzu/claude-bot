import { DecryptedText } from '@/vendor/reactbits';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { glue } from '@/lib/glue';

/*
 * Шапка розділу.
 *
 * З появою дока назва розділу перестала бути видимою в навігації — тепер
 * її місце тут, і це вже не оздоблення, а орієнтир. Один компонент на всі
 * розділи: інакше кожен екран почне вигадувати власний заголовок.
 *
 * Мітка проявляється ефектом DecryptedText (React Bits): перемикання
 * розділу читається як «прилад перемкнувся», а не як миттєва підміна
 * тексту, яку око не встигає помітити.
 */
export function SectionHeader({
  label,
  title,
  hint,
  actions,
  className,
}: {
  label: string;
  title: string;
  hint?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <header className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {reduced ? (
          <span className="u-label !text-[13px] !tracking-[0.2em]">{label}</span>
        ) : (
          <DecryptedText
            key={label}
            text={label}
            animateOn="view"
            sequential
            speed={34}
            characters="АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЮЯ01"
            parentClassName="u-label !text-[13px] !tracking-[0.2em]"
            className="u-label !text-[13px] !tracking-[0.2em]"
            encryptedClassName="u-label !text-[13px] !tracking-[0.2em] opacity-45"
          />
        )}
        <h1 className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.025em] text-ink sm:text-[26px]">
          {glue(title)}
        </h1>
        {hint ? <p className="u-measure mt-1 text-[13px] text-ink-3">{glue(hint)}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </header>
  );
}
