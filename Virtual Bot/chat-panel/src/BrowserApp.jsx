import React, { useEffect, useRef, useState } from 'react';
import { ConfigProvider, theme, Button, Input } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  HomeOutlined,
  ExportOutlined,
} from '@ant-design/icons';

/**
 * Вкладка «Браузер» — сторінку тягне бекенд (/api/browser/page) і віддає її
 * в <iframe>. Напряму більшість сайтів у фрейм не пускає (X-Frame-Options),
 * тому без проксі вкладка була б порожньою.
 *
 * Кліки по посиланнях усередині сторінки не «губляться»: вставлений на
 * бекенді місток шле адресу сюди через postMessage, а навігацію робимо ми —
 * так адресний рядок та історія лишаються синхронні з тим, що видно.
 */

const HOME = 'https://uk.wikipedia.org/';

function proxied(url) {
  return `/api/browser/page?url=${encodeURIComponent(url)}`;
}

function Browser() {
  const [url, setUrl] = useState(HOME);
  const [draft, setDraft] = useState(HOME);
  const [navigation, setNavigation] = useState({ history: [HOME], pos: 0 });
  const [nonce, setNonce] = useState(0);
  const frameRef = useRef(null);
  const { history, pos } = navigation;

  const go = (next, { push = true } = {}) => {
    const target = (next || '').trim();
    if (!target) return;
    setUrl(target);
    setDraft(target);
    if (push) {
      setNavigation((current) => {
        const nextHistory = [...current.history.slice(0, current.pos + 1), target];
        return { history: nextHistory, pos: nextHistory.length - 1 };
      });
    }
  };

  useEffect(() => {
    const onMessage = (event) => {
      /* Тільки від НАШОГО фрейма: інакше будь-яке вікно з хендлом на цю
         сторінку могло б підсунути вкладці довільну навігацію. */
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'claudebot-navigate' || typeof data.url !== 'string') return;
      go(data.url);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  const back = () => {
    if (pos <= 0) return;
    const next = pos - 1;
    setNavigation({ history, pos: next });
    go(history[next], { push: false });
  };

  const forward = () => {
    if (pos >= history.length - 1) return;
    const next = pos + 1;
    setNavigation({ history, pos: next });
    go(history[next], { push: false });
  };

  return (
    <div className="br-panel">
      <div className="br-bar">
        <Button size="small" icon={<ArrowLeftOutlined />} onClick={back} disabled={pos <= 0} />
        <Button
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={forward}
          disabled={pos >= history.length - 1}
        />
        <Button size="small" icon={<ReloadOutlined />} onClick={() => setNonce((n) => n + 1)} />
        <Button size="small" icon={<HomeOutlined />} onClick={() => go(HOME)} />
        <Input
          size="small"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => go(draft)}
          placeholder="адреса або пошуковий запит"
        />
        <Button size="small" icon={<ExportOutlined />} href={url} target="_blank" title="Відкрити у справжньому браузері" />
      </div>
      {/* sandbox без allow-same-origin: сторінка живе в чужому origin і не
          має доступу ні до нашої панелі, ні до її localStorage. */}
      <iframe
        key={`${url}-${nonce}`}
        ref={frameRef}
        className="br-frame"
        title="Вбудований браузер"
        src={proxied(url)}
        sandbox="allow-scripts allow-forms allow-popups"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

export default function WrappedBrowser() {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#C96442',
          /* Шрифт задаємо токеном antd: його власний reset інакше перебиває
             body-стиль сторінки, і панель лишалась на дефолтному ui-sans-serif. */
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, ui-sans-serif, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',

          colorBgContainer: '#FBFAF7',
          colorBorder: '#E4E1D6',
          colorText: '#2B2A26',
          borderRadius: 8,
        },
      }}
    >
      <Browser />
    </ConfigProvider>
  );
}
