const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const brainConfig = require('./brain-config.cjs')
const openclawCli = require('./openclaw-cli.cjs')
const visionAgent = require('./vision-agent.cjs')

const isDev = !app.isPackaged

ipcMain.handle('brain:get', () => {
  try {
    return { ok: true, ...brainConfig.getBrainSettings() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('brain:save', (_event, payload) => {
  try {
    return brainConfig.saveBrainSettings(payload)
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('gateway:check', async () => {
  try {
    return await brainConfig.checkGatewayReachable()
  } catch (err) {
    return { reachable: false, error: err.message }
  }
})

// Реальний сетап через офіційний CLI `openclaw` (не через ручний запис
// конфігів) — див. electron/openclaw-cli.cjs. Прогрес стрімиться в рендерер
// подією 'setup:log', бо ці команди можуть тривати десятки секунд.

ipcMain.handle('setup:getVersion', () => openclawCli.getVersion())

ipcMain.handle('setup:install', async (event) => {
  const send = (chunk) => event.sender.send('setup:log', chunk)
  return openclawCli.installOpenClaw(send)
})

ipcMain.handle('setup:onboard', async (event, payload) => {
  const send = (chunk) => event.sender.send('setup:log', chunk)
  return openclawCli.runOnboarding(payload, send)
})

// Vision Agent (FastAPI + OpenCV, сусідня папка "Vision Agent") — Electron
// сам піднімає й гасить цей процес, рендерер потім ходить у нього напряму
// по HTTP (baseUrl), а не через IPC-проксі, бо це просто REST API.
ipcMain.handle('vision:ensureStarted', () => visionAgent.ensureStarted())
ipcMain.handle('vision:baseUrl', () => visionAgent.BASE_URL)

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Claude Bot Studio',
    backgroundColor: '#dfe7dc',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.setMenuBarVisibility(false)

  visionAgent.onLog((chunk) => win.webContents.send('vision:log', chunk))

  if (isDev) {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:8443'
    win.loadURL(devServerUrl)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  // Найкраще зусилля — якщо Python/venv Vision Agent ще не готовий, вкладка
  // "Зір" просто покаже "камера недоступна" і кнопку повторної спроби.
  visionAgent.ensureStarted().catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  visionAgent.stop()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  visionAgent.stop()
})
