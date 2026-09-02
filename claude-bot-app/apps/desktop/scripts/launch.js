#!/usr/bin/env node
'use strict';

/**
 * Запуск Electron.
 *
 * Навіщо окремий скрипт замість `electron .`: якщо в середовищі виставлено
 * ELECTRON_RUN_AS_NODE=1 (так буває в CI та деяких інструментах розробки),
 * Electron стартує як звичайний Node — без вікна, без `app`, і require('electron')
 * повертає рядок зі шляхом. Помилка при цьому виглядає геть не пов'язаною:
 * «Cannot read properties of undefined (reading 'isPackaged')».
 *
 * `env -u` вирішив би це на macOS і Linux, але не на Windows, тому знімаємо
 * змінну в Node і передаємо чисте середовище далі.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');

const electron = require('electron');
if (typeof electron !== 'string') {
  console.error('[claude-bot] цей скрипт треба запускати через node, а не через electron');
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
