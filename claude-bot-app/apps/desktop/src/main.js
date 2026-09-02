'use strict';

/**
 * Electron-обгортка застосунку.
 *
 * Завантажуємо ту саму веб-збірку Expo (apps/app/dist), але НЕ через file://:
 * Expo збирає посилання на ресурси як абсолютні («/_expo/static/…»), і на
 * file:// вони вказали б у корінь файлової системи. Тому підіймаємо крихітний
 * статичний сервер на 127.0.0.1 і відкриваємо http-адресу. Побічна вигода —
 * у застосунку нормальний http-origin, тому CORS бекенда працює так само, як
 * у браузері (порт 8082 уже є в його списку дозволених).
 */

const { app, BrowserWindow, shell } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 8082;
const HOST = '127.0.0.1';

// У зібраному застосунку статика лежить у resources/web (див. extraResources),
// у режимі розробки — просто поряд у apps/app/dist.
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '../../app/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Обрізаємо query і декодуємо: у шляхах бувають відсоткові послідовності.
      let rel = decodeURIComponent((req.url || '/').split('?')[0]);
      if (rel === '/' || rel === '') rel = '/index.html';

      const target = path.join(WEB_ROOT, rel);
      // Захист від виходу за корінь: «..» у шляху не має відкрити чужий файл.
      if (!target.startsWith(WEB_ROOT + path.sep) && target !== WEB_ROOT) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      fs.readFile(target, (err, data) => {
        if (err) {
          // SPA (web.output: "single"): будь-який невідомий шлях — це
          // маршрут застосунку, а не відсутній файл.
          fs.readFile(path.join(WEB_ROOT, 'index.html'), (e2, html) => {
            if (e2) {
              res.writeHead(404).end('Not found');
              return;
            }
            res.writeHead(200, { 'Content-Type': MIME['.html'] }).end(html);
          });
          return;
        }
        const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': type }).end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

let win = null;

async function createWindow() {
  if (!fs.existsSync(path.join(WEB_ROOT, 'index.html'))) {
    throw new Error(
      `Немає веб-збірки: ${WEB_ROOT}. Спочатку зберіть її — npm run build:web -w @claude-bot/app`,
    );
  }
  await serve();

  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 380,
    minHeight: 480,
    // Тон тла збігається з палітрою застосунку, щоб вікно не блимало білим
    backgroundColor: '#eee4d2',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // Рендерер — звичайна веб-сторінка без доступу до Node: він показує
      // віддалений контент бекенда, і давати йому require() не за що.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Зовнішні посилання — у системний браузер, а не в вікно застосунку.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await win.loadURL(`http://${HOST}:${PORT}/`);
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('[claude-bot] не вдалося запустити:', err.message);
  app.quit();
});

app.on('window-all-closed', () => {
  // macOS: застосунок живе далі в доку — там так прийнято.
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
