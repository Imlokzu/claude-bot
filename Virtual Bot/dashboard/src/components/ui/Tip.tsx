import { WarmTooltip } from '@/vendor/reactbits';

/*
 * Підказка — React Bits · WarmTooltip. «Теплий» тут означає, що після першої
 * підказки сусідні показуються без затримки: у щільній панелі з іконками це
 * рятує від відчуття гальм.
 */
export function Tip({
  content,
  shortcut,
  side = 'top',
  children,
  disabled,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <WarmTooltip
      content={content}
      shortcut={shortcut}
      side={side}
      disabled={disabled}
      size="sm"
      radius={8}
      surfaceColor="var(--c-surface-3)"
      inkColor="var(--c-text)"
    >
      {children}
    </WarmTooltip>
  );
}
