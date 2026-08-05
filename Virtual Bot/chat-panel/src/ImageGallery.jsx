import React, { useEffect, useRef, useState } from 'react';
import { Dropdown, message, Modal } from 'antd';
import {
  LeftOutlined,
  RightOutlined,
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
 * Замість купи зображень поспіль — одна велика зі стрілками й лічильником.
 * Права кнопка миші дає те саме, що й у справжньому браузері: копіювати саму
 * картинку, копіювати посилання, зберегти. Плюс два наші пункти — лайк і
 * «до бібліотеки сесії» (файл лягає в робочу теку бота, тож він може взяти
 * його для сайту, який робить).
 */

const LIKES_KEY = 'virtual_bot_liked_images';

const loadLikes = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(LIKES_KEY) || '[]'));
  } catch {
    return new Set();
  }
};

export default function ImageGallery({ images, sessionId }) {
  const [index, setIndex] = useState(0);
  const [likes, setLikes] = useState(loadLikes);
  const [preview, setPreview] = useState(false);
  const trackRef = useRef(null);

  useEffect(() => {
    setIndex(0);
  }, [images.length]);

  if (!images || images.length === 0) return null;
  const current = images[Math.min(index, images.length - 1)];
  const liked = likes.has(current.src);

  const move = (delta) =>
    setIndex((i) => (i + delta + images.length) % images.length);

  const toggleLike = () => {
    setLikes((prev) => {
      const next = new Set(prev);
      if (next.has(current.src)) next.delete(current.src);
      else next.add(current.src);
      try {
        localStorage.setItem(LIKES_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const copyUrl = async () => {
    await navigator.clipboard.writeText(current.src);
    message.success('Посилання скопійовано');
  };

  /* Саме зображення в буфер: беремо байти й кладемо як image/png —
     інакше вставиться лише текст посилання. */
  const copyImage = async () => {
    try {
      const blob = await fetch(current.src).then((r) => r.blob());
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

  const download = () => {
    const a = document.createElement('a');
    a.href = current.src;
    a.download = (current.alt || 'image').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'image';
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.click();
  };

  /* «У бібліотеку сесії» — бот кладе файл у свою робочу теку, тому потім
     може використати картинку в тому, що робить (напр. на сайті). */
  const addToLibrary = async () => {
    try {
      const res = await fetch('/api/workspace/save-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: current.src, session_id: sessionId || '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'не вдалося');
      message.success(`Збережено: ${data.path}`);
    } catch (e) {
      message.error(`Не вдалося зберегти: ${e.message}`);
    }
  };

  const menuItems = [
    { key: 'copy', icon: <CopyOutlined />, label: 'Копіювати картинку' },
    { key: 'url', icon: <LinkOutlined />, label: 'Копіювати посилання' },
    { key: 'download', icon: <DownloadOutlined />, label: 'Зберегти на компʼютер' },
    { type: 'divider' },
    {
      key: 'like',
      icon: liked ? <HeartFilled /> : <HeartOutlined />,
      label: liked ? 'Прибрати вподобайку' : 'Подобається',
    },
    { key: 'library', icon: <FolderAddOutlined />, label: 'У бібліотеку сесії' },
  ];

  const onMenu = ({ key }) => {
    if (key === 'copy') copyImage();
    else if (key === 'url') copyUrl();
    else if (key === 'download') download();
    else if (key === 'like') toggleLike();
    else if (key === 'library') addToLibrary();
  };

  return (
    <div className="img-gallery">
      <Dropdown menu={{ items: menuItems, onClick: onMenu }} trigger={['contextMenu']}>
        <div className="img-gallery-stage" ref={trackRef}>
          <img
            src={current.src}
            alt={current.alt || ''}
            onClick={() => setPreview(true)}
            title="Клік — на весь екран, права кнопка — меню"
          />
          {liked && <HeartFilled className="img-gallery-like" />}
        </div>
      </Dropdown>

      {/* Підпис моделі до саме цієї картинки — коли їх кілька, це єдине,
          з чого видно, що на кожній. Плюс лічильник. */}
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
        <>
          <button type="button" className="img-gallery-nav img-gallery-prev" onClick={() => move(-1)}>
            <LeftOutlined />
          </button>
          <button type="button" className="img-gallery-nav img-gallery-next" onClick={() => move(1)}>
            <RightOutlined />
          </button>
          <div className="img-gallery-dots">
            {images.map((im, i) => (
              <button
                key={im.src}
                type="button"
                className={`img-gallery-dot${i === index ? ' img-gallery-dot-active' : ''}`}
                onClick={() => setIndex(i)}
                aria-label={`Картинка ${i + 1}`}
              />
            ))}
          </div>
        </>
      )}

      <Modal
        open={preview}
        footer={null}
        onCancel={() => setPreview(false)}
        width="min(1100px, 94vw)"
        centered
      >
        <img className="img-gallery-full" src={current.src} alt={current.alt || ''} />
      </Modal>
    </div>
  );
}
