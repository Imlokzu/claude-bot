import { useEffect, useRef } from 'react';
import { Camera, ChevronRight, FileText, Image, PanelRightOpen, Wrench } from 'lucide-react';
import { ContextMeter } from './ContextMeter';
import { t } from '@/locales/chat';

/*
 * What the "+" opens on a phone.
 *
 * The desktop "+" is a list of sources beside a wide field. On a phone the
 * things you actually reach for are different — take a photo, pick one from
 * the gallery, attach a file — and each deserves a thumb-sized target rather
 * than a row in a dropdown. The context meter and the tool switches move in
 * here as well: under the field they cost a line on every screen, and they
 * are checked now and then, not read on every reply.
 *
 * It opens in place above the prompt bar instead of as a modal, so the
 * conversation stays visible behind it and the draft keeps its focus.
 */

/*
 * Picked explicitly rather than `image/*`: given the generic type, iOS hands
 * over HEIC originals that neither the models nor the browser preview can
 * read; with named types it transcodes to JPEG on the way out.
 */
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif';
const FILE_TYPES = `${IMAGE_TYPES},.txt,.md,.json,.pdf`;

function Tile({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-ink transition-[background-color,transform] duration-[120ms] hover:bg-surface-3 active:scale-[0.97] motion-reduce:active:scale-100 [&_svg]:size-9 [&_svg]:stroke-[1.75]"
    >
      {icon}
      <span className="font-mono text-[13px]">{label}</span>
    </button>
  );
}

function Row({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-lg bg-surface-2 px-4 text-left text-ink transition-colors hover:bg-surface-3 [&>svg:first-child]:size-6 [&>svg:first-child]:stroke-[1.75]"
    >
      {icon}
      <span className="font-mono text-[15px]">{label}</span>
      <ChevronRight className="ml-auto size-4 text-ink-3" />
    </button>
  );
}

export function AttachSheet({
  open,
  onClose,
  anchor,
  onFiles,
  onTools,
  onPanels,
  context,
}: {
  open: boolean;
  onClose: () => void;
  /** The "+" that toggles the sheet — a tap on it is not an outside tap. */
  anchor: React.RefObject<HTMLElement | null>;
  onFiles: (files: FileList) => void;
  onTools: () => void;
  onPanels: () => void;
  context: React.ComponentProps<typeof ContextMeter>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const files = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (root.current?.contains(target) || anchor.current?.contains(target)) return;
      // The context breakdown opens in a portal; a tap inside it belongs to
      // the sheet, and closing here would tear the popover down under the
      // finger.
      if (target.closest?.('[data-radix-popper-content-wrapper]')) return;
      onClose();
    };
    // Escape peels one layer: with the context breakdown open, it closes
    // that and leaves the sheet — Radix handles the popover's own Escape
    // first, while its content is still in the DOM.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  /** One handler for all three inputs: hand the files over, reset, close. */
  const picked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.currentTarget.files;
    if (list?.length) onFiles(list);
    // Cleared so that picking the same photo twice still fires `change`.
    event.currentTarget.value = '';
    onClose();
  };

  return (
    <>
      {/* The inputs stay mounted while the sheet is closed: the OS picker
          returns after the sheet has already gone, and an unmounted input
          would drop the files on the floor. */}
      <input ref={camera} type="file" accept={IMAGE_TYPES} capture="environment" className="hidden" tabIndex={-1} aria-hidden="true" onChange={picked} />
      <input ref={photos} type="file" accept={IMAGE_TYPES} multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={picked} />
      <input ref={files} type="file" accept={FILE_TYPES} multiple className="hidden" tabIndex={-1} aria-hidden="true" onChange={picked} />

      {open ? (
        <div
          ref={root}
          role="dialog"
          aria-label={t('composer.add')}
          data-state="open"
          className="u-pop space-y-2 rounded-xl border border-line bg-surface p-2.5 shadow-pop"
        >
          <div className="grid grid-cols-3 gap-2">
            <Tile icon={<Camera />} label={t('sheet.camera')} onClick={() => camera.current?.click()} />
            <Tile icon={<Image />} label={t('sheet.photos')} onClick={() => photos.current?.click()} />
            <Tile icon={<FileText />} label={t('sheet.files')} onClick={() => files.current?.click()} />
          </div>
          <ContextMeter {...context} variant="row" />
          <Row icon={<Wrench />} label={t('sheet.tools')} onClick={onTools} />
          <Row icon={<PanelRightOpen />} label={t('sheet.panels')} onClick={onPanels} />
        </div>
      ) : null}
    </>
  );
}
