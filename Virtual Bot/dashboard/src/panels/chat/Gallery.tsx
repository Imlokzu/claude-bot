import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AccordionGallery, AnimatedContent, GlareHover } from '@/vendor/reactbits';
import { useAccentColor, useCssVar } from '@/hooks/useAccentRgb';
import { ImageViewer, type GalleryImage } from './ImageViewer';
import { t } from '@/locales/workspace';
import { t as chatT } from '@/locales/chat';

/*
 * Картинки у відповіді бота.
 *
 * Модель вставляє їх звичайним markdown — ![підпис](адреса), — і поки їх
 * малював браузер «як є», відповідь із трьома фото розсипалась: одне на
 * пів екрана, друге в сірник, і між ними ніякого зв'язку. Тому тут два
 * рішення і обидва про розмір.
 *
 *   Одна картинка — кадр сталої висоти. Не «до 220», а рівно 220: стрічка
 *   не повинна стрибати, поки картинка вантажиться.
 *
 *   Кілька — гармошка (AccordionGallery, React Bits): вони займають рівно
 *   ту саму смугу, що й одна, і видно, що це ОДИН набір, а не три випадкові
 *   вкладення. Наведення розгортає одну на всю ширину.
 *
 * Повний розмір — у переглядачі (ImageViewer), і саме тому тут скрізь
 * object-fit: cover без докорів сумління: обрізаний кадр — це не втрата,
 * а превʼю, яке на клік розкривається цілим.
 */

const FRAME_H = 220;
const GALLERY_H = 240;

interface Group {
  node: HTMLElement | null;
  images: GalleryImage[];
}

interface ScopeApi {
  register: (id: string, group: Group) => void;
  unregister: (id: string) => void;
  open: (id: string, index: number) => void;
}

const ScopeContext = createContext<ScopeApi | null>(null);

/**
 * Область однієї репліки.
 *
 * Тримає ВСІ картинки репліки одним списком, тож «наступна» в переглядачі
 * доходить і до тих, що лежали в сусідньому абзаці. Порядок беремо з
 * розмітки (compareDocumentPosition), а не з порядку монтування: під час
 * стрімінгу абзаци приїжджають як завгодно.
 */
export function GalleryScope({ children }: { children: React.ReactNode }) {
  const groups = useRef(new Map<string, Group>());
  const [viewer, setViewer] = useState<{ images: GalleryImage[]; index: number } | null>(null);

  const api = useMemo<ScopeApi>(
    () => ({
      register: (id, group) => groups.current.set(id, group),
      unregister: (id) => groups.current.delete(id),
      open: (id, index) => {
        const entries = [...groups.current.entries()].sort(([, a], [, b]) => {
          if (!a.node || !b.node) return 0;
          const relation = a.node.compareDocumentPosition(b.node);
          if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
          if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
          return 0;
        });
        const images: GalleryImage[] = [];
        let offset = 0;
        for (const [key, group] of entries) {
          if (key === id) offset = images.length;
          images.push(...group.images);
        }
        if (!images.length) return;
        setViewer({ images, index: offset + index });
      },
    }),
    [],
  );

  return (
    <ScopeContext.Provider value={api}>
      {children}
      {viewer ? (
        <ImageViewer
          images={viewer.images}
          initialIndex={viewer.index}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </ScopeContext.Provider>
  );
}

/** Реєструє свої картинки в області репліки й уміє відкрити переглядач. */
function useGroup(images: GalleryImage[]) {
  const api = useContext(ScopeContext);
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  // Streaming can update a caption without changing the image URL.
  const key = JSON.stringify(images);

  useEffect(() => {
    api?.register(id, { node: node.current, images });
    return () => api?.unregister(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, id, key]);

  const open = useCallback(
    (index: number) => api?.open(id, index),
    [api, id],
  );

  return { node, open };
}

/** Одна картинка: кадр сталої висоти з відблиском по наведенню. */
export function ChatImage({ src, alt }: GalleryImage) {
  const images = useMemo(() => [{ src, alt }], [src, alt]);
  const { node, open } = useGroup(images);
  const line = useCssVar('--c-border', '#ded5c6');
  const surface = useCssVar('--c-surface-2', '#f7f2e9');

  return (
    <AnimatedContent distance={14} duration={0.42} threshold={0} className="block">
      <figure ref={node} className="my-3">
        <GlareHover
          width="min(420px, 100%)"
          height={`${FRAME_H}px`}
          background={surface}
          borderColor={line}
          borderRadius="var(--r-md)"
          glareColor="#ffffff"
          glareOpacity={0.28}
          glareSize={220}
          transitionDuration={720}
          className="chat-shot"
        >
          <button
            type="button"
            onClick={() => open(0)}
            aria-label={alt ? chatT('image.openNamed', { alt }) : chatT('image.open')}
            className="block size-full cursor-zoom-in"
          >
            <img src={src} alt={alt} loading="lazy" draggable={false} />
          </button>
        </GlareHover>
        {alt ? (
          <figcaption className="mt-1.5 text-[12px] text-ink-3">{alt}</figcaption>
        ) : null}
      </figure>
    </AnimatedContent>
  );
}

/** Кілька картинок — гармошка на ту саму смугу. */
export function ChatGallery({ images }: { images: GalleryImage[] }) {
  const { node, open } = useGroup(images);
  const accent = useAccentColor();

  const items = useMemo(
    () => images.map((image) => ({ image: image.src, label: image.alt, alt: image.alt })),
    [images],
  );

  return (
    <AnimatedContent distance={14} duration={0.42} threshold={0} className="block">
      <div ref={node} className="chat-gallery my-3">
        <AccordionGallery
          items={items}
          height={GALLERY_H}
          gap={6}
          radius={10}
          tilt={5}
          parallax={0.35}
          expandRatio={images.length > 3 ? 0.5 : 0.46}
          grayscale={false}
          accentColor={accent}
          /* Затемнення під підписом — завжди темне, обома темами: підпис
             білий і лежить на фотографії, а не на тлі панелі. */
          overlayColor="#17120f"
          textColor="#ffffff"
          onOpen={open}
        />
        <p className="mt-1.5 text-[12px] text-ink-3">
          {t('gallery.hint', { count: images.length })}
        </p>
      </div>
    </AnimatedContent>
  );
}
