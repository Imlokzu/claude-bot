import React, { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, message, Modal } from 'antd';
import { authFetch } from './auth.js';
import {
  CopyOutlined,
  LinkOutlined,
  DownloadOutlined,
  HeartOutlined,
  HeartFilled,
  FolderAddOutlined,
} from '@ant-design/icons';

/**
 * Карусель для картинок, які знайшов бот.
 *
 * Стрічка мініатюр фіксованого розміру зі свайпом убік (видно ~2.5 картинки
 * одразу, як у мобільних стрічках), а не одна картинка на всю ширину. Клік —
 * перегляд на весь екран, права кнопка — те саме меню, що й у браузері:
 * копіювати саму картинку, копіювати посилання, зберегти, плюс лайк і
 * «до бібліотеки сесії» (файл лягає в робочу теку бота).
 */

const LIKES_KEY = 'virtual_bot_liked_images';

const loadLikes = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || '[]'));
  } catch {
    return new Set();
  }
};

export default function ImageGallery({ images, sessionId, project }) {
  const [index, setIndex] = useState(0);
  const [likes, setLikes] = useState(loadLikes);
  const [preview, setPreview] = useState(false);
  const trackRef = useRef(null);
  const likesRef = useRef(likes);

  useEffect(() => {
    setIndex(0);
  }, [images.length]);

  /* Вантажимо ВСІ картинки одразу, а не по кліку: інакше кожне перегортання
     чекало мережу, і карусель здавалась гальмівною. */
  useEffect(() => {
    const preloaded = (images || []).map((im) => {
      const img = new Image();
      img.src = im.src;
      return img;
    });
    return () => preloaded.forEach((img) => { img.src = ''; });
  }, [images]);

  if (!images || images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];

  const itemEls = () => trackRef.current?.querySelectorAll('.img-gallery-item') || [];

  const scrollToIndex = (i) => {
    itemEls()[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  };

  /* Стрічка сама «підказує», яка картинка зараз найближче до лівого краю —
     звідти беремо підпис, лайк-іконку та те, яку картинку відкриє повний
     перегляд і контекстне меню без зайвого кліку по самій мініатюрі. */
  const onTrackScroll = () => {
    const el = trackRef.current;
    if (!el) return;
    let closest = 0;
    let closestDist = Infinity;
    itemEls().forEach((it, i) => {
      const dist = Math.abs(it.offsetLeft - el.scrollLeft);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setIndex((prev) => (prev === closest ? prev : closest));
  };

  const move = (delta) => {
    const next = (index + delta + images.length) % images.length;
    setIndex(next);
    scrollToIndex(next);
  };

  const toggleLike = (img) => {
    const next = new Set(likesRef.current);
    if (next.has(img.src)) next.delete(img.src);
    else next.add(img.src);
    likesRef.current = next;
    setLikes(next);
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify([...next]));
    } catch {}
  };

  const copyUrl = async (img) => {
    await navigator.clipboard.writeText(img.src);
    message.success('Посилання скопійовано');
  };

  /* Саме зображення в буфер: беремо байти й кладемо як image/png —
     інакше вставиться лише текст посилання. */
  const copyImage = async (img) => {
    try {
      const blob = await fetch(img.src).then((r) => r.blob());
      const png = blob.type === 'image/png' ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      message.success('Картинку скопійовано');
    } catch {
      message.error('Не вдалося скопіювати картинку — спробуй «копіювати посилання»');
    }
  };

  const toPng = (blob) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('no blob'))), 'image/png');
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(blob);
    });

  const download = (img) => {
    const a = document.createElement('a');
    a.href = img.src;
    a.download = (img.alt || 'image').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  };

  /* «У бібліотеку» — бот кладе файл у свою робочу теку, тому потім може
     використати картинку в тому, що робить (напр. на сайті). Якщо чат
     привʼязаний до проєкту — файл летить у бібліотеку САМЕ цього проєкту,
     а не загальну сесійну, щоб усі матеріали лежали разом. */
  const addToLibrary = async (img) => {
    try {
      /* authFetch, а не голий fetch: із увімкненим Clerk ручка вимагає токен,
         і «У бібліотеку» мовчки падало б 401 у всіх, крім дев-режиму. */
      const res = await authFetch('/api/workspace/save-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: img.src,
          session_id: sessionId || '',
          subdir: project ? `projects/${project}/library` : 'session/library',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'не вдалося');
      message.success(`Збережено: ${data.path}`);
    } catch (e) {
      message.error(`Не вдалося зберегти: ${e.message}`);
    }
  };

  const libraryLabel = project ? 'У бібліотеку проєкту' : 'У бібліотеку сесії';

  const menuItemsFor = (img) => {
    const liked = likes.has(img.src);
    return [
      { key: 'copy', icon: <CopyOutlined />, label: 'Копіювати картинку' },
      { key: 'url', icon: <LinkOutlined />, label: 'Копіювати посилання' },
      { key: 'download', icon: <DownloadOutlined />, label: 'Зберегти на компʼютер' },
      { type: 'divider' },
      {
        key: 'like',
        icon: liked ? <HeartFilled /> : <HeartOutlined />,
        label: liked ? 'Прибрати вподобайку' : 'Подобається',
      },
      { key: 'library', icon: <FolderAddOutlined />, label: libraryLabel },
    ];
  };

  const onMenuFor = (img) => ({ key }) => {
    if (key === 'copy') copyImage(img);
    else if (key === 'url') copyUrl(img);
    else if (key === 'download') download(img);
    else if (key === 'like') toggleLike(img);
    else if (key === 'library') addToLibrary(img);
  };

  return (
    <div className="img-gallery">
      <div className="img-gallery-track" ref={trackRef} onScroll={onTrackScroll}>
        {images.map((im, i) => (
          <Dropdown
            key={im.src}
            menu={{ items: menuItemsFor(im), onClick: onMenuFor(im) }}
            trigger={['contextMenu']}
          >
            <div
              className="img-gallery-item"
              onClick={() => {
                setIndex(i);
                setPreview(true);
              }}
              title={im.alt || 'Клік — на весь екран, права кнопка — меню'}
            >
              <img src={im.src} alt={im.alt || ''} loading="lazy" />
              {likes.has(im.src) && <HeartFilled className="img-gallery-like" />}
            </div>
          </Dropdown>
        ))}
      </div>

      {(current.alt || images.length > 1) && (
        <div className="img-gallery-caption">
          {current.alt && <span className="img-gallery-alt">{current.alt}</span>}
          {images.length > 1 && (
            <span className="img-gallery-count">
              {index + 1} / {images.length}
            </span>
          )}
        </div>
      )}

      {images.length > 1 && (
        <div className="img-gallery-dots">
          {images.map((im, i) => (
            <button
              key={im.src}
              type="button"
              className={`img-gallery-dot${i === index ? ' img-gallery-dot-active' : ''}`}
              onClick={() => move(i - index)}
              aria-label={`Картинка ${i + 1}`}
            />
          ))}
        </div>
      )}

      <Modal
        open={preview}
        footer={null}
        onCancel={() => setPreview(false)}
        width="min(1100px, 94vw)"
        centered
        title={current.alt || 'Перегляд'}
        classNames={{ body: 'img-full-body' }}
      >
        <img className="img-gallery-full" src={current.src} alt={current.alt || ''} />
        {/* Ті самі дії, що й у контекстному меню: у повний екран заходять
            саме щоб роздивитись і забрати картинку. */}
        <div className="img-full-actions">
          <Button size="small" icon={<CopyOutlined />} onClick={() => copyImage(current)}>Копіювати</Button>
          <Button size="small" icon={<LinkOutlined />} onClick={() => copyUrl(current)}>Посилання</Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => download(current)}>Зберегти</Button>
          <Button size="small" icon={<FolderAddOutlined />} onClick={() => addToLibrary(current)}>{libraryLabel}</Button>
          <Button
            size="small"
            icon={likes.has(current.src) ? <HeartFilled /> : <HeartOutlined />}
            onClick={() => toggleLike(current)}
            danger={likes.has(current.src)}
          >
            {likes.has(current.src) ? 'Подобається' : 'Вподобати'}
          </Button>
          {images.length > 1 && (
            <span className="img-full-count">{index + 1} / {images.length}</span>
          )}
        </div>
      </Modal>
    </div>
  );
}
