// Клод Бот — реальний сетап через офіційний CLI `openclaw`, а не через ручне
// написання конфігів. Онбординг (провайдер, ключі, gateway, daemon,
// bootstrap-файли workspace) робить сам `openclaw onboard` — це вже написаний
// і протестований код команди OpenClaw, нема сенсу дублювати цю логіку тут.
//
// Довідка з якої взяті прапори non-interactive онбордингу:
// https://docs.openclaw.ai/start/wizard-cli-automation

const { spawn, execFile } = require('node:child_process')

function getVersion() {
  return new Promise((resolve) => {
    execFile('openclaw', ['--version'], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(stdout.trim())
    })
  })
}

function runCommand(command, args, onData) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { shell: false })
    } catch (err) {
      resolve({ ok: false, code: -1, stdout: '', stderr: err.message })
      return
    }

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      onData?.(chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      onData?.(chunk.toString())
    })
    child.on('error', (err) => {
      onData?.(`\n[!] ${err.message}\n`)
      resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\n${err.message}` })
    })
    child.on('close', (code) => {
      resolve({ ok: code === 0, code, stdout, stderr })
    })
  })
}

// Встановлює сам CLI, якщо його ще нема. Використовує той самий npm, яким
// запущений Electron-застосунок.
function installOpenClaw(onData) {
  return runCommand('npm', ['install', '-g', 'openclaw@latest'], onData)
}

// Реальний non-interactive онбординг. Все, що раніше писалося вручну в
// openclaw.json/SOUL.md (Крок "Мозок"), тепер робить сам openclaw onboard:
// провайдер + ключ, gateway (порт/bind), встановлення daemon-сервісу,
// bootstrap-файли workspace (SOUL.md, IDENTITY.md, USER.md і т.д.).
function runOnboarding({ anthropicApiKey, groqApiKey }, onData) {
  const args = [
    'onboard',
    '--non-interactive',
    '--mode', 'local',
    '--gateway-port', '18789',
    '--gateway-bind', 'loopback',
    '--install-daemon',
    '--daemon-runtime', 'node',
    '--skip-skills',
    '--json',
  ]

  if (anthropicApiKey) {
    args.push('--auth-choice', 'apiKey', '--anthropic-api-key', anthropicApiKey)
  } else if (groqApiKey) {
    args.push('--auth-choice', 'groq-api-key', '--groq-api-key', groqApiKey)
  }

  return runCommand('openclaw', args, onData)
}

module.exports = {
  getVersion,
  installOpenClaw,
  runOnboarding,
  runCommand,
}
