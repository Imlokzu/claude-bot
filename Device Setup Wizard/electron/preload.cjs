// Preload script for "Claude Bot Studio".
//
// Real functionality wired so far:
// - Reading/writing OpenClaw's brain config (~/.openclaw/openclaw.json +
//   SOUL.md) for quick edits, from the "Мозок" (Brain) tab.
// - A TCP-level reachability check against the OpenClaw Gateway.
// - A real setup flow that shells out to the official `openclaw` CLI
//   (install + non-interactive onboarding) instead of reimplementing that
//   logic here — see electron/openclaw-cli.cjs.
//
// Drive listing / flashing / mDNS discovery are still not implemented —
// those remain future work (see electron/main.cjs history).

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('claudeBot', {
  getBrainSettings: () => ipcRenderer.invoke('brain:get'),
  saveBrainSettings: (payload) => ipcRenderer.invoke('brain:save', payload),
  checkGatewayConnection: () => ipcRenderer.invoke('gateway:check'),

  getOpenClawVersion: () => ipcRenderer.invoke('setup:getVersion'),
  installOpenClaw: () => ipcRenderer.invoke('setup:install'),
  runOnboarding: (payload) => ipcRenderer.invoke('setup:onboard', payload),

  // Живий лог install/onboard-процесів. Повертає функцію відписки.
  onSetupLog: (callback) => {
    const listener = (_event, chunk) => callback(chunk)
    ipcRenderer.on('setup:log', listener)
    return () => ipcRenderer.removeListener('setup:log', listener)
  },

  // Vision Agent (FastAPI+OpenCV) — Electron сам стартує процес; рендерер
  // лише дізнається baseUrl і б'є в нього напряму через fetch() (звичайний
  // REST API, IPC-проксі тут не потрібен).
  ensureVisionStarted: () => ipcRenderer.invoke('vision:ensureStarted'),
  getVisionBaseUrl: () => ipcRenderer.invoke('vision:baseUrl'),
  onVisionLog: (callback) => {
    const listener = (_event, chunk) => callback(chunk)
    ipcRenderer.on('vision:log', listener)
    return () => ipcRenderer.removeListener('vision:log', listener)
  },
})
