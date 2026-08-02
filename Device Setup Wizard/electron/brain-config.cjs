// Клод Бот — реальна робота з конфігом OpenClaw ("мозок" бота).
//
// Читає/пише ~/.openclaw/openclaw.json (API-ключі, модель) і
// ~/.openclaw/workspace/SOUL.md (персона/тон агента). Винесено в окремий
// чистий Node-модуль (без залежності від electron), щоб можна було
// тестувати без запуску самого застосунку.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const JSON5 = require('json5')

function getOpenClawDir() {
  return path.join(os.homedir(), '.openclaw')
}

function getConfigPath() {
  return path.join(getOpenClawDir(), 'openclaw.json')
}

// Реальна перевірка, чи взагалі щось слухає на порту OpenClaw Gateway
// (типово 127.0.0.1:18789 — той самий порт, що й Control UI/Dashboard).
// Це TCP-рівень, без потреби вмикати OpenAI-сумісний HTTP-ендпоінт чи мати
// токен — просто "процес Gateway живий чи ні".
function checkGatewayReachable(host = '127.0.0.1', port = 18789, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ reachable: true, host, port }))
    socket.once('timeout', () => finish({ reachable: false, host, port, error: 'timeout' }))
    socket.once('error', (err) => finish({ reachable: false, host, port, error: err.message }))
    socket.connect(port, host)
  })
}

function readConfig() {
  const configPath = getConfigPath()
  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON5.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw new Error(`Не вдалося прочитати ${configPath}: ${err.message}`)
  }
}

function writeConfig(config) {
  const dir = getOpenClawDir()
  fs.mkdirSync(dir, { recursive: true })
  // Пишемо звичайний JSON (валідний підмножина JSON5, який OpenClaw читає) —
  // коментарі в оригінальному файлі, якщо були, при цьому не збережуться.
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

function resolveWorkspaceDir(config) {
  const raw =
    config?.agents?.list?.[0]?.workspace ||
    config?.agents?.defaults?.workspace ||
    '~/.openclaw/workspace'
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : raw
}

function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return '•'.repeat(key.length)
  return `${key.slice(0, 6)}${'•'.repeat(8)}${key.slice(-4)}`
}

function getBrainSettings() {
  const config = readConfig()
  const workspaceDir = resolveWorkspaceDir(config)
  const soulPath = path.join(workspaceDir, 'SOUL.md')

  let soulText = ''
  try {
    soulText = fs.readFileSync(soulPath, 'utf-8')
  } catch {
    soulText = ''
  }

  const anthropicKey = config?.env?.ANTHROPIC_API_KEY || ''
  const groqKey = config?.env?.GROQ_API_KEY || ''

  return {
    configPath: getConfigPath(),
    soulPath,
    anthropicKeySet: Boolean(anthropicKey),
    anthropicKeyMasked: maskKey(anthropicKey),
    groqKeySet: Boolean(groqKey),
    groqKeyMasked: maskKey(groqKey),
    primaryModel: config?.agents?.defaults?.model?.primary || '',
    soulText,
  }
}

function saveBrainSettings({ anthropicApiKey, groqApiKey, personality, wakePhrase }) {
  const config = readConfig()
  config.env = config.env || {}

  if (anthropicApiKey) config.env.ANTHROPIC_API_KEY = anthropicApiKey
  if (groqApiKey) config.env.GROQ_API_KEY = groqApiKey

  config.agents = config.agents || {}
  config.agents.defaults = config.agents.defaults || {}
  config.agents.defaults.model = config.agents.defaults.model || {}

  if (!config.agents.defaults.model.primary) {
    if (config.env.ANTHROPIC_API_KEY) {
      config.agents.defaults.model.primary = 'anthropic/claude-opus-4-8'
    } else if (config.env.GROQ_API_KEY) {
      config.agents.defaults.model.primary = 'groq/llama-3.3-70b-versatile'
    }
  }

  writeConfig(config)

  const workspaceDir = resolveWorkspaceDir(config)
  fs.mkdirSync(workspaceDir, { recursive: true })
  const soulPath = path.join(workspaceDir, 'SOUL.md')

  const soulContent = [
    '# SOUL — Клод Бот',
    '',
    `Тон спілкування: ${personality || 'Спокійний'}.`,
    wakePhrase
      ? `\nФраза звертання (для голосового інтерфейсу): "${wakePhrase}".`
      : '',
    '',
  ].join('\n')

  fs.writeFileSync(soulPath, soulContent, 'utf-8')

  return { ok: true, configPath: getConfigPath(), soulPath }
}

module.exports = {
  getOpenClawDir,
  getConfigPath,
  readConfig,
  writeConfig,
  resolveWorkspaceDir,
  maskKey,
  getBrainSettings,
  saveBrainSettings,
  checkGatewayReachable,
}
