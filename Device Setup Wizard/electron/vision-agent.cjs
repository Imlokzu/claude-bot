// Клод Бот — керування процесом Vision Agent (сусідня папка "Vision Agent",
// FastAPI + OpenCV з Кроку 1) прямо з Electron-застосунку.
//
// Раніше Vision Agent треба було піднімати вручну (`uvicorn main:app`) в
// окремому терміналі. Тепер Claude Bot Studio сама стартує його як дочірній
// процес при запуску застосунку і гасить при виході — це і є "єдиний
// бекенд, підключений до додатка": вкладка "Зір" ходить у нього напряму по
// HTTP (localhost, CORS відкритий на боці FastAPI).

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const HOST = '127.0.0.1'
const PORT = 8000

// Якщо задано VISION_AGENT_URL (напр. http://192.168.50.200:8000 — реальний
// Raspberry Pi 3 з вебкою), ходимо туди по мережі й НЕ спавнимо локальний
// процес — тоді Vision Agent, який ми піднімаємо на ноуті, лише дублював би
// той самий сервіс, що вже реально працює на пристрої.
const REMOTE_URL = process.env.VISION_AGENT_URL || null
const BASE_URL = REMOTE_URL || `http://${HOST}:${PORT}`

function getVisionAgentDir() {
  // Electron-застосунок лежить у "Device Setup Wizard/", Vision Agent — у
  // сусідній папці на тому ж рівні кореня проєкту.
  return path.join(__dirname, '..', '..', 'Vision Agent')
}

function resolvePythonBin() {
  const dir = getVisionAgentDir()
  const venvPython =
    process.platform === 'win32'
      ? path.join(dir, '.venv', 'Scripts', 'python.exe')
      : path.join(dir, '.venv', 'bin', 'python')

  if (fs.existsSync(venvPython)) return venvPython
  return process.platform === 'win32' ? 'python' : 'python3'
}

let child = null
let logListeners = []

function onLog(callback) {
  logListeners.push(callback)
  return () => {
    logListeners = logListeners.filter((cb) => cb !== callback)
  }
}

function emitLog(chunk) {
  for (const cb of logListeners) cb(chunk)
}

async function isReachable() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)
    const res = await fetch(`${BASE_URL}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

// Стартує Vision Agent, якщо він ще не запущений (напр. вручну в терміналі,
// або з попереднього запуску застосунку). Ідемпотентно — можна викликати
// кілька разів.
async function ensureStarted() {
  if (child || (await isReachable())) {
    return { ok: true, alreadyRunning: true, baseUrl: BASE_URL }
  }

  if (REMOTE_URL) {
    return { ok: false, error: `Віддалений Vision Agent (${REMOTE_URL}) недоступний` }
  }

  const dir = getVisionAgentDir()
  if (!fs.existsSync(path.join(dir, 'main.py'))) {
    return { ok: false, error: `Vision Agent не знайдено за шляхом ${dir}` }
  }

  const python = resolvePythonBin()

  child = spawn(python, ['-m', 'uvicorn', 'main:app', '--host', HOST, '--port', String(PORT)], {
    cwd: dir,
  })

  child.stdout.on('data', (chunk) => emitLog(chunk.toString()))
  child.stderr.on('data', (chunk) => emitLog(chunk.toString()))
  child.on('exit', (code) => {
    emitLog(`\n[vision-agent] процес завершився (код ${code})\n`)
    child = null
  })
  child.on('error', (err) => {
    emitLog(`\n[vision-agent] помилка запуску: ${err.message}\n`)
    child = null
  })

  // Даємо процесу трохи часу підняти FastAPI, перш ніж рендерер почне
  // опитувати /vision/snapshot. 50 × 300мс = 15с — на повільних SD-картах
  // (Raspberry Pi) старт uvicorn+OpenCV легко перевалює за 6с.
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 300))
    if (await isReachable()) return { ok: true, alreadyRunning: false, baseUrl: BASE_URL }
  }

  return { ok: false, error: 'Vision Agent не відповів на /health за 15с' }
}

function stop() {
  if (child) {
    child.kill()
    child = null
  }
}

module.exports = {
  BASE_URL,
  ensureStarted,
  isReachable,
  stop,
  onLog,
}
