import { useEffect, useState, type ComponentType } from 'react'
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/react'
import { ArrowLeft, Bot, BrainCircuit, Camera, Check, ChevronDown, CircleCheck, CirclePower, Cpu, Database, Gauge, HardDrive, Home, Image, Info, Mic, MonitorUp, Network, Radio, RefreshCw, Router, ScanLine, Settings2, ShieldCheck, Smartphone, Speaker, Usb, Wifi, Wrench, type LucideProps } from 'lucide-react'

type Nav = 'home' | 'vision' | 'brain' | 'memory' | 'tools' | 'device'

type BrainSettings = {
  ok: boolean
  error?: string
  configPath?: string
  soulPath?: string
  anthropicKeySet?: boolean
  anthropicKeyMasked?: string
  groqKeySet?: boolean
  groqKeyMasked?: string
  primaryModel?: string
}

type VisionSnapshot = {
  faces_detected: number
  face_boxes: number[][]
  motion_detected: boolean
  motion_score: number
  mode: string
}

type VisionSettings = {
  motion_min_area_ratio: number
  min_face_size: [number, number]
  mode: string
}

declare global {
  interface Window {
    claudeBot?: {
      getBrainSettings: () => Promise<BrainSettings>
      saveBrainSettings: (payload: {
        anthropicApiKey: string
        groqApiKey: string
        personality: string
        wakePhrase: string
      }) => Promise<{ ok: boolean; error?: string; configPath?: string; soulPath?: string }>
      checkGatewayConnection: () => Promise<{ reachable: boolean; host?: string; port?: number; error?: string }>

      getOpenClawVersion: () => Promise<string | null>
      installOpenClaw: () => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>
      runOnboarding: (payload: { anthropicApiKey: string; groqApiKey: string }) => Promise<{ ok: boolean; code: number; stdout: string; stderr: string }>
      onSetupLog: (callback: (chunk: string) => void) => () => void

      ensureVisionStarted: () => Promise<{ ok: boolean; alreadyRunning?: boolean; baseUrl?: string; error?: string }>
      getVisionBaseUrl: () => Promise<string>
      onVisionLog: (callback: (chunk: string) => void) => () => void
    }
  }
}

const navItems: { id: Nav; label: string; icon: ComponentType<LucideProps> }[] = [
  { id: 'home', label: 'Головна', icon: Home },
  { id: 'vision', label: 'Зір', icon: Camera },
  { id: 'brain', label: 'Мозок', icon: BrainCircuit },
  { id: 'memory', label: 'Памʼять', icon: Database },
  { id: 'tools', label: 'Інструменти', icon: Wrench },
  { id: 'device', label: 'Пристрій', icon: Cpu },
]

function Toggle({ on, setOn }: { on: boolean; setOn: (v: boolean) => void }) {
  return <button onClick={() => setOn(!on)} className={`relative h-7 w-12 rounded-full transition ${on ? 'bg-[#cddabf]' : 'bg-[#3b403c]'}`}><span className={`absolute top-1 h-5 w-5 rounded-full bg-[#3c4d43] transition-all ${on ? 'left-6' : 'left-1'}`} /></button>
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <div className="border-l border-[#9eae9e] pl-4"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d9e1d5]">{label}</p><p className={`mt-1 text-xl font-medium ${accent ? 'text-[#cddabf]' : ''}`}>{value}</p></div>
}

function MobileApp() {
  const [nav, setNav] = useState<Nav>('home')
  const [talking, setTalking] = useState(false)
  const [tracking, setTracking] = useState(true)
  const [localVision, setLocalVision] = useState(true)
  const [tools, setTools] = useState({ alarm: true, reminders: true, music: false, search: true })

  // Vision Agent (FastAPI+OpenCV, сусідній процес) — Electron сам стартує
  // його при відкритті застосунку; тут лише опитуємо /vision/snapshot, щоб
  // вкладка "Зір" показувала реальну камеру, а не статичний макет.
  const [visionBaseUrl, setVisionBaseUrl] = useState<string | null>(null)
  const [visionStatus, setVisionStatus] = useState<'unknown' | 'starting' | 'online' | 'offline'>('unknown')
  const [visionError, setVisionError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<VisionSnapshot | null>(null)
  const [frameImageUrl, setFrameImageUrl] = useState<string | null>(null)
  const [motionSensitivity, setMotionSensitivity] = useState(0.01)

  const startVisionAgent = () => {
    if (!window.claudeBot) return
    setVisionStatus('starting')
    setVisionError(null)
    window.claudeBot
      .ensureVisionStarted()
      .then(result => {
        if (result.ok && result.baseUrl) {
          setVisionBaseUrl(result.baseUrl)
          setVisionStatus('online')
        } else {
          setVisionStatus('offline')
          setVisionError(result.error ?? null)
        }
      })
      .catch((err: Error) => {
        setVisionStatus('offline')
        setVisionError(err.message)
      })
  }

  useEffect(() => {
    startVisionAgent()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!visionBaseUrl) return
    let cancelled = false

    fetch(`${visionBaseUrl}/vision/settings`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data: VisionSettings) => {
        if (!cancelled) setMotionSensitivity(data.motion_min_area_ratio)
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setVisionStatus('offline')
          setVisionError(err.message)
        }
      })

    const poll = () => {
      fetch(`${visionBaseUrl}/vision/snapshot`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        .then((data: VisionSnapshot) => {
          if (cancelled) return
          setSnapshot(data)
          setVisionStatus('online')
          setVisionError(null)
        })
        .catch((err: Error) => {
          if (!cancelled) {
            setVisionStatus('offline')
            setVisionError(err.message)
          }
        })
    }

    poll()
    const interval = window.setInterval(poll, 1500)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [visionBaseUrl])

  useEffect(() => {
    if (!visionBaseUrl) return
    let cancelled = false
    let currentUrl: string | null = null

    // MJPEG (<img src=".../stream.mjpg">) не рендериться в деяких WebKit-based
    // прев'ю (Figma Make тощо) — той самий відомий брак підтримки
    // multipart/x-mixed-replace, що й у Safari. Тому тягнемо окремі кадри
    // через fetch+blob. Самопідлаштовуваний цикл (не фіксований setInterval)
    // — наступний запит стартує одразу після попереднього, а не за годинником:
    // на реальному Pi через Wi-Fi round-trip ~50-65мс, тож це дає ~15 fps
    // замість штучних 2.5 fps з фіксованого 400мс інтервалу.
    const pollFrame = () => {
      if (cancelled) return
      fetch(`${visionBaseUrl}/vision/snapshot.jpg`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.blob()
        })
        .then(blob => {
          if (cancelled) return
          const nextUrl = URL.createObjectURL(blob)
          setFrameImageUrl(nextUrl)
          if (currentUrl) URL.revokeObjectURL(currentUrl)
          currentUrl = nextUrl
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) window.setTimeout(pollFrame, 30)
        })
    }

    pollFrame()
    return () => {
      cancelled = true
      if (currentUrl) URL.revokeObjectURL(currentUrl)
    }
  }, [visionBaseUrl])

  const updateMotionSensitivity = (value: number) => {
    setMotionSensitivity(value)
    if (!visionBaseUrl) return
    fetch(`${visionBaseUrl}/vision/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motion_min_area_ratio: value }),
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      })
      .catch((err: Error) => {
        setVisionStatus('offline')
        setVisionError(err.message)
      })
  }
  const [notice, setNotice] = useState<string | null>(null)
  const announce = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(null), 2200)
  }
  // "Мозок" (Brain) — реальні налаштування OpenClaw (~/.openclaw/openclaw.json + SOUL.md),
  // а не статичний макет. anthropicApiKey/groqApiKey зберігають лише те, що користувач
  // щойно ввів у цій сесії (порожньо, якщо ключ уже збережений — тоді показуємо маску).
  const [brainMeta, setBrainMeta] = useState<BrainSettings | null>(null)
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [groqApiKey, setGroqApiKey] = useState('')
  const [personality, setPersonality] = useState('Спокійний')
  const [wakePhrase, setWakePhrase] = useState('Привіт, Клод')
  const [brainSaving, setBrainSaving] = useState(false)

  // Реальна перевірка, чи OpenClaw Gateway взагалі слухає на 127.0.0.1:18789
  // (TCP-рівень — без токена й без потреби вмикати /v1/chat/completions).
  const [gatewayStatus, setGatewayStatus] = useState<'unknown' | 'checking' | 'online' | 'offline'>('unknown')
  const [gatewayError, setGatewayError] = useState<string | null>(null)

  const checkGateway = () => {
    if (!window.claudeBot) return
    setGatewayStatus('checking')
    window.claudeBot
      .checkGatewayConnection()
      .then(result => {
        setGatewayStatus(result.reachable ? 'online' : 'offline')
        setGatewayError(result.reachable ? null : result.error ?? null)
      })
      .catch((err: Error) => {
        setGatewayStatus('offline')
        setGatewayError(err.message)
      })
  }

  const loadBrainSettings = () => {
    if (!window.claudeBot) return
    window.claudeBot
      .getBrainSettings()
      .then(data => {
        setBrainMeta(data)
        if (!data.ok) announce(`Помилка читання конфігу: ${data.error}`)
      })
      .catch((err: Error) => announce(`Помилка читання конфігу: ${err.message}`))
  }

  // "Встановлення OpenClaw" — реальний сетап через офіційний CLI (npm install
  // -g openclaw + openclaw onboard --non-interactive), а не через ручний
  // запис конфігів. Уся ця логіка живе в electron/openclaw-cli.cjs, тут лише
  // виклики + стрім логу.
  const [openclawVersion, setOpenclawVersion] = useState<string | null | 'checking'>('checking')
  const [setupBusy, setSetupBusy] = useState<'idle' | 'installing' | 'onboarding'>('idle')
  const [setupLog, setSetupLog] = useState<string[]>([])

  const checkOpenClawVersion = () => {
    if (!window.claudeBot) return
    setOpenclawVersion('checking')
    window.claudeBot.getOpenClawVersion().then(setOpenclawVersion)
  }

  useEffect(() => {
    loadBrainSettings()
    checkGateway()
    checkOpenClawVersion()

    const unsubscribe = window.claudeBot?.onSetupLog(chunk => {
      setSetupLog(prev => [...prev, chunk].slice(-500))
    })
    return () => unsubscribe?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const installOpenClaw = async () => {
    if (!window.claudeBot) return
    setSetupBusy('installing')
    setSetupLog([])
    try {
      const result = await window.claudeBot.installOpenClaw()
      announce(result.ok ? 'OpenClaw встановлено' : `Помилка встановлення (код ${result.code})`)
      checkOpenClawVersion()
    } finally {
      setSetupBusy('idle')
    }
  }

  const runFullSetup = async () => {
    if (!window.claudeBot) return
    if (!anthropicApiKey && !groqApiKey) {
      announce('Введи Claude або Groq API key вище перед сетапом')
      return
    }
    setSetupBusy('onboarding')
    setSetupLog([])
    try {
      const result = await window.claudeBot.runOnboarding({ anthropicApiKey, groqApiKey })
      announce(result.ok ? 'Сетап OpenClaw завершено' : `Сетап завершився з помилкою (код ${result.code})`)
      loadBrainSettings()
      checkGateway()
    } finally {
      setSetupBusy('idle')
    }
  }

  const saveBrainSettings = async () => {
    if (!window.claudeBot) {
      announce('Немає доступу до Electron API (запущено поза застосунком)')
      return
    }
    setBrainSaving(true)
    try {
      const result = await window.claudeBot.saveBrainSettings({
        anthropicApiKey,
        groqApiKey,
        personality,
        wakePhrase,
      })
      if (result.ok) {
        setAnthropicApiKey('')
        setGroqApiKey('')
        loadBrainSettings()
        announce(`Збережено в ${result.configPath}`)
      } else {
        announce(`Помилка збереження: ${result.error}`)
      }
    } catch (err) {
      announce(`Помилка збереження: ${(err as Error).message}`)
    } finally {
      setBrainSaving(false)
    }
  }

  const botOnline = gatewayStatus === 'online' || visionStatus === 'online'
  const today = new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })

  const home = <>
    <div className="mb-5 flex items-start justify-between"><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d9e1d5]">Сьогодні · {today}</p><h2 className="mt-1 text-3xl font-medium tracking-tight">Клод Бот</h2></div><button onClick={() => announce('Профіль відкрито')} aria-label="Відкрити профіль" className="grid h-11 w-11 place-items-center rounded-full border border-[#9ba99b] text-sm transition hover:bg-[#8fa286] active:scale-95">AK</button></div>
    <section className="relative overflow-hidden rounded-[26px] border border-[#9ba99b] bg-[#6c806f] p-5"><div className="absolute -right-10 -top-10 h-40 w-40 rounded-full border border-[#a9bfa3]" /><div className="absolute -right-2 top-0 h-24 w-24 rounded-full bg-[#cddabf] opacity-10 blur-3xl" /><div className="relative flex items-center justify-between"><div><div className={`mb-7 inline-flex items-center gap-2 rounded-full bg-[#8fa286] px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[#cddabf]`}><span className={`h-1.5 w-1.5 rounded-full bg-[#cddabf] ${botOnline ? 'animate-pulse' : ''}`} /> {botOnline ? 'онлайн' : 'офлайн'}</div><h3 className="text-2xl font-medium">Клод Бот</h3><p className="mt-1 text-sm text-[#eef2e8]">{visionStatus === 'online' ? 'Слухає навколишній світ' : 'Камера й мозок ще не підключені'}</p></div><div className="grid h-20 w-20 place-items-center rounded-full border border-[#bdcdb7] bg-[#435549]"><div className="grid h-12 w-12 place-items-center rounded-full bg-[#cddabf] text-2xl text-[#3c4d43]"><Bot size={22} /></div></div></div><div className="relative mt-6 flex justify-between border-t border-[#9eae9e] pt-4"><Stat label="Vision Agent" value={visionStatus === 'online' ? 'Онлайн' : 'Офлайн'} accent={visionStatus === 'online'} /><Stat label="OpenClaw Gateway" value={gatewayStatus === 'online' ? 'Онлайн' : 'Офлайн'} accent={gatewayStatus === 'online'} /></div></section>
    <button onClick={() => setTalking(!talking)} className={`mt-5 flex w-full items-center justify-between rounded-2xl px-5 py-4 text-left transition ${talking ? 'bg-[#cddabf] text-[#3c4d43]' : 'bg-[#fffaf0] text-[#3c4d43]'}`}><span><span className="block text-lg font-medium">{talking ? 'Слухаю…' : 'Поговорити'}</span><span className="block text-xs opacity-60">Натисніть і утримуйте, щоб говорити</span></span><span className={`grid h-11 w-11 place-items-center rounded-full ${talking ? 'bg-[#3c4d43] text-[#cddabf]' : 'bg-[#cddabf]'}`}>{talking ? <CirclePower size={19} /> : <Mic size={19} />}</span></button>
    <section className="mt-5"><h3 className="mb-3 font-medium">Остання активність</h3><div className="rounded-2xl bg-[#6c806f] px-4 py-6 text-center text-xs text-[#d9e1d5]">Журнал активності ще не підключено — з'явиться, коли OpenClaw матиме API для логів агента.</div></section>
  </>

  const vision = <>
    <Heading eyebrow="OpenCV Vision Agent" title="Бачити уважно." />
    <section className="mb-4 flex items-center justify-between rounded-2xl border border-[#9eae9e] bg-[#6c806f] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${visionStatus === 'online' ? 'bg-[#cddabf] animate-pulse' : visionStatus === 'starting' ? 'bg-[#e4d3a6]' : 'bg-[#dfb5ad]'}`} />
        <span className="text-sm">
          {visionStatus === 'online' && `Vision Agent онлайн · ${snapshot?.mode ?? 'local'}`}
          {visionStatus === 'offline' && `Камера недоступна${visionError ? ` — ${visionError}` : ''}`}
          {visionStatus === 'starting' && 'Запускаю Vision Agent…'}
          {visionStatus === 'unknown' && 'Стан камери невідомий'}
        </span>
      </div>
      <button onClick={startVisionAgent} className="font-mono text-[10px] uppercase text-[#cddabf] transition hover:opacity-70">Перевірити</button>
    </section>
    <div className="mb-4 overflow-hidden rounded-2xl border border-[#9eae9e] bg-[#2f3a33]">
      {frameImageUrl ? (
        // fetch+blob кожні 400мс, а не <img src=".../stream.mjpg"> напряму —
        // MJPEG (multipart/x-mixed-replace) не рендериться в деяких
        // WebKit-based прев'ю (той самий відомий брак підтримки, що й у
        // Safari), а цей спосіб працює скрізь.
        <img
          src={frameImageUrl}
          alt="Живий кадр з камери"
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div className="grid aspect-video w-full place-items-center text-xs text-[#d9e1d5]">
          {visionStatus === 'online' ? 'Чекаю перший кадр…' : 'Камера недоступна'}
        </div>
      )}
    </div>
    <Panel>
      <div className="mb-3 flex justify-between"><p className="text-sm">Чутливість руху</p><p className="font-mono text-[10px] text-[#cddabf]">{(motionSensitivity * 100).toFixed(1)}%</p></div>
      <input
        type="range"
        min={0.002}
        max={0.05}
        step={0.001}
        value={motionSensitivity}
        onChange={e => updateMotionSensitivity(Number(e.target.value))}
        className="w-full accent-[#cddabf]"
      />
      <div className="mt-4 flex items-center justify-between border-t border-[#9eae9e] pt-4 text-sm">
        <span>Рух зараз</span>
        <span className={snapshot?.motion_detected ? 'text-[#cddabf]' : 'text-[#d9e1d5]'}>
          {snapshot ? (snapshot.motion_detected ? `Так · ${(snapshot.motion_score * 100).toFixed(1)}%` : 'Ні') : '—'}
        </span>
      </div>
      <Row label="Face tracking" detail="Стежити за обличчям"><Toggle on={tracking} setOn={setTracking} /></Row>
      <div className="border-t border-[#9eae9e] pt-4">
        <p className="font-mono text-[10px] uppercase tracking-wider text-[#d9e1d5]">Обличчя в кадрі зараз: {snapshot?.faces_detected ?? '—'}</p>
        <p className="mt-3 font-mono text-[10px] leading-4 text-[#d9e1d5]">Реєстрація конкретних людей (face recognition) — ще не реалізована, поки лише кількість облич з Haar Cascade.</p>
      </div>
    </Panel>
    <Panel><Row label="Локальна детекція" detail="Швидко та приватно"><Toggle on={localVision} setOn={setLocalVision} /></Row></Panel>
  </>

  const brain = <>
    <Heading eyebrow="Налаштування LLM" title="Мозок бота." />
    {!window.claudeBot && <section className="mb-4 rounded-2xl border border-[#dfb5ad] bg-[#6c806f] p-4 text-sm text-[#fff4ef]">Electron API недоступний — запущено, схоже, не в застосунку (напр. у браузері). Збереження працюватиме тільки всередині Claude Bot Studio.</section>}

    <Panel>
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#d9e1d5]">Встановлення OpenClaw</p>
          <p className="mt-1 text-sm">
            {openclawVersion === 'checking' && 'Перевіряю, чи встановлений openclaw…'}
            {openclawVersion === null && 'openclaw CLI не знайдено'}
            {typeof openclawVersion === 'string' && openclawVersion !== 'checking' && `Встановлено: ${openclawVersion}`}
          </p>
        </div>
        {openclawVersion === null && (
          <button onClick={installOpenClaw} disabled={setupBusy !== 'idle'} className="rounded-2xl bg-[#fffaf0] px-4 py-2 text-xs font-medium text-[#3c4d43] transition hover:bg-[#e9f0df] disabled:cursor-not-allowed disabled:opacity-50">
            {setupBusy === 'installing' ? 'Встановлюю…' : 'Встановити OpenClaw'}
          </button>
        )}
      </div>

      {openclawVersion !== null && (
        <div className="mt-4 border-t border-[#9eae9e] pt-4">
          <p className="text-xs leading-5 text-[#eef2e8]">Повний сетап (провайдер, gateway, daemon, workspace) — робить сам <span className="font-mono">openclaw onboard</span>, не ми вручну. Введи Claude або Groq ключ вище і натисни:</p>
          <button onClick={runFullSetup} disabled={setupBusy !== 'idle'} className="mt-3 w-full rounded-2xl bg-[#cddabf] py-3 text-sm font-medium text-[#3c4d43] transition hover:bg-[#e3efd7] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50">
            {setupBusy === 'onboarding' ? 'Виконую openclaw onboard…' : 'Запустити повний сетап'}
          </button>
        </div>
      )}

      {setupLog.length > 0 && (
        <pre className="mt-4 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#2f3a33] p-3 font-mono text-[10px] leading-4 text-[#cddabf]">{setupLog.join('')}</pre>
      )}
    </Panel>

    <section className="mb-4 flex items-center justify-between rounded-2xl border border-[#9eae9e] bg-[#6c806f] px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${gatewayStatus === 'online' ? 'bg-[#cddabf] animate-pulse' : gatewayStatus === 'checking' ? 'bg-[#e4d3a6]' : 'bg-[#dfb5ad]'}`} />
        <span className="text-sm">
          {gatewayStatus === 'online' && 'OpenClaw Gateway онлайн (127.0.0.1:18789)'}
          {gatewayStatus === 'offline' && `Gateway недоступний${gatewayError ? ` — ${gatewayError}` : ''}`}
          {gatewayStatus === 'checking' && 'Перевіряю зʼєднання…'}
          {gatewayStatus === 'unknown' && 'Стан Gateway невідомий'}
        </span>
      </div>
      <button onClick={checkGateway} className="font-mono text-[10px] uppercase text-[#cddabf] transition hover:opacity-70">Перевірити</button>
    </section>
    <Panel>
      <Field
        label="Claude API key"
        value={anthropicApiKey}
        placeholder={brainMeta?.anthropicKeySet ? brainMeta.anthropicKeyMasked : 'sk-ant-...'}
        onChange={setAnthropicApiKey}
      />
      <Field
        label="Groq API key"
        value={groqApiKey}
        placeholder={brainMeta?.groqKeySet ? brainMeta.groqKeyMasked : 'gsk_...'}
        onChange={setGroqApiKey}
      />
      {brainMeta?.configPath && <p className="mt-3 font-mono text-[10px] leading-4 text-[#d9e1d5]">Конфіг: {brainMeta.configPath}{brainMeta.primaryModel ? ` · модель: ${brainMeta.primaryModel}` : ''}</p>}
    </Panel>
    <Panel>
      <p className="font-mono text-[10px] uppercase tracking-wider text-[#d9e1d5]">Характер</p>
      <div className="mt-3 grid grid-cols-3 gap-2">{['Спокійний','Грайливий','Лаконічний'].map((x)=><button key={x} onClick={()=>setPersonality(x)} className={`rounded-xl border px-2 py-3 text-xs transition ${personality===x ? 'border-[#cddabf] bg-[#8fa286] text-[#cddabf]' : 'border-[#9ba99b] text-[#eef2e8]'}`}>{x}</button>)}</div>
      <Field label="Wake word" value={wakePhrase} onChange={setWakePhrase} />
      <p className="mt-1 font-mono text-[10px] leading-4 text-[#d9e1d5]">Записується в SOUL.md агента — не запускає розпізнавання голосу саме по собі.</p>
    </Panel>
    <button onClick={saveBrainSettings} disabled={brainSaving} className="w-full rounded-2xl bg-[#cddabf] py-4 text-sm font-medium text-[#3c4d43] transition hover:bg-[#e3efd7] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50">{brainSaving ? 'Зберігаю…' : 'Зберегти налаштування'}</button>
  </>

  const memory = <><Heading eyebrow="Локальна памʼять" title="Згадувати важливе." /><Panel><p className="text-sm text-[#eef2e8]">Пам'ять (RAG-нотатки people/topics) ще не підключена — цей екран запрацює, коли OpenClaw матиме API для читання нотаток агента.</p></Panel></>

  const toolsView = <><Heading eyebrow="Tool use" title="Дії у світі." /><Panel><p className="text-sm text-[#eef2e8]">Tool use (будильник, нагадування, музика, пошук) ще не підключено до жодного бекенда — вмикачі нижче поки нічим не керують.</p></Panel><Panel>{([['alarm','Будильник'],['reminders','Нагадування'],['music','Музика'],['search','Пошук']] as const).map(([key,label])=><Row key={key} label={label} detail="Не підключено"><Toggle on={tools[key]} setOn={v=>setTools({...tools,[key]:v})} /></Row>)}</Panel><Panel><Field label="Telegram Bot Token" value="" placeholder="Вставте токен бота" /></Panel></>

  const cameraStatusLabel = visionStatus === 'online' ? 'Підключено' : visionStatus === 'starting' ? 'Запускається' : 'Не підключено'
  const deviceRows: [ComponentType<LucideProps>, string, string][] = [[Camera,'Камера',cameraStatusLabel],[Mic,'Мікрофон','Підключено'],[Speaker,'Динамік','Підключено'],[Gauge,'Шасі','Не підключено']]
  const device = <><Heading eyebrow="ClaudeBot-7F2A" title="Пристрій." /><Panel>{deviceRows.map(([Icon,l,d])=><div key={l} className="flex items-center gap-3 border-b border-[#9eae9e] py-3 last:border-0"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#8fa286] text-[#cddabf]"><Icon size={16}/></span><div className="flex-1"><p className="text-sm">{l}</p><p className="text-xs text-[#d9e1d5]">{d}</p></div><span className={d === 'Підключено' ? 'text-[#cddabf]' : 'text-[#d9c4b7]'}>{d === 'Підключено' ? <Check size={16}/> : <span>—</span>}</span></div>)}</Panel><button onClick={() => announce('Перевіряємо оновлення…')} className="mb-2 w-full rounded-2xl bg-[#fffaf0] py-3.5 text-sm font-medium text-[#3c4d43] transition hover:bg-[#e9f0df] active:scale-[.98]">Оновити прошивку</button><div className="grid grid-cols-2 gap-2"><button onClick={() => announce('Бот перезавантажується')} className="rounded-2xl border border-[#9ba99b] py-3 text-sm transition hover:bg-[#8fa286] active:scale-[.98]">Перезавантажити</button><button onClick={() => announce('Потрібне підтвердження вимкнення')} className="rounded-2xl border border-[#dfb5ad] py-3 text-sm text-[#fff4ef] transition hover:bg-[#c99892] active:scale-[.98]">Вимкнути</button></div></>
  const page = { home, vision, brain, memory, tools: toolsView, device }[nav]
  return <div className="relative flex h-full flex-col overflow-hidden bg-[#3c4d43] text-[#fffaf0]"><main className="flex-1 overflow-y-auto px-5 pb-24 pt-7 [scrollbar-width:none]"><div className="mx-auto max-w-md">{nav !== 'home' && <button onClick={()=>setNav('home')} className="mb-5 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#cddabf]"><ArrowLeft size={14} />Назад</button>}{page}</div></main><>{notice && <div className="pointer-events-none absolute bottom-24 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#fffaf0] px-4 py-2 text-xs font-medium text-[#3c4d43] shadow-lg">{notice}</div>}<nav className="mx-3 mb-3 flex items-center justify-around rounded-[28px] border border-[#9ba99b] bg-[#435549]/95 px-2 py-2 shadow-lg shadow-[#3c4d43]/20">{navItems.map(x=><button key={x.id} onClick={()=>setNav(x.id)} aria-label={x.label} title={x.label} className={`grid h-11 w-11 place-items-center rounded-full transition-all active:scale-90 ${nav===x.id ? 'bg-[#cddabf] text-[#3c4d43] shadow-sm' : 'text-[#dbe7d6] hover:bg-[#8fa286]'}`}><x.icon size={20} strokeWidth={1.8} /></button>)}</nav></></div>
}

function Heading({eyebrow,title}:{eyebrow:string;title:string}) { return <div className="mb-6"><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d9e1d5]">{eyebrow}</p><h2 className="mt-1 text-3xl font-medium tracking-tight">{title}</h2></div> }
function Panel({children}:{children:React.ReactNode}) { return <section className="mb-4 rounded-2xl border border-[#9eae9e] bg-[#6c806f] p-4">{children}</section> }
function Row({label,detail,children}:{label:string;detail:string;children:React.ReactNode}) { return <div className="flex items-center justify-between border-b border-[#9eae9e] py-3 first:pt-0 last:border-0 last:pb-0"><div><p className="text-sm">{label}</p><p className="mt-0.5 text-xs text-[#d9e1d5]">{detail}</p></div>{children}</div> }
function Field({label,value,placeholder,onChange}:{label:string;value:string;placeholder?:string;onChange?:(v:string)=>void}) {
  const controlled = onChange !== undefined
  return <label className="block border-b border-[#9eae9e] py-3 last:border-0">
    <span className="font-mono text-[10px] uppercase tracking-wider text-[#d9e1d5]">{label}</span>
    {controlled
      ? <input className="mt-1 block w-full bg-transparent text-sm outline-none placeholder:text-[#b7c5b3]" value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)} />
      : <input className="mt-1 block w-full bg-transparent text-sm outline-none placeholder:text-[#b7c5b3]" defaultValue={value} placeholder={placeholder} />}
  </label>
}
function DesktopWizard() {
  const [stage, setStage] = useState<'configure' | 'flash' | 'discover' | 'pair'>('configure')
  const [device, setDevice] = useState('Raspberry Pi 5')
  const [image, setImage] = useState('Claude Bot OS')
  const [storage, setStorage] = useState('SanDisk Extreme · 31.9 GB')
  const [customize, setCustomize] = useState(false)
  const [progress, setProgress] = useState(0)
  const [paired, setPaired] = useState(false)
  const flashStages = [
    ['Завантаження образу', '1.8 GB / 1.8 GB'],
    ['Запис на SD-картку', 'Безпечно не виймайте носій'],
    ['Перевірка запису', 'Звіряємо контрольні суми'],
    ['Створення first-boot конфігурації', 'Wi‑Fi, hostname та безпечний доступ'],
  ]
  const activeFlash = progress < 30 ? 0 : progress < 72 ? 1 : progress < 90 ? 2 : 3
  const startFlash = () => { setStage('flash'); setProgress(15) }
  const advanceFlash = () => { if (progress >= 100) setStage('discover'); else setProgress(Math.min(100, progress + (progress < 30 ? 22 : progress < 72 ? 34 : progress < 90 ? 18 : 10))) }
  const side = [
    { label: 'Підготувати', icon: Settings2, done: stage !== 'configure' },
    { label: 'Записати', icon: HardDrive, done: ['discover','pair'].includes(stage) },
    { label: 'Знайти в мережі', icon: Network, done: stage === 'pair' },
    { label: 'Звʼязати телефон', icon: ShieldCheck, done: paired },
  ]
  return <div className="min-h-full bg-[#f6f0e5] p-6 text-[#3b4a3e] sm:p-9"><div className="mx-auto max-w-6xl">
    <header className="mb-8 flex items-center justify-between border-b border-[#cbdac6] pb-6"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#6c806f] text-[#fffaf0]"><Bot size={22}/></span><div><h1 className="text-lg font-semibold tracking-tight">Claude Bot Studio</h1><p className="font-mono text-[10px] uppercase tracking-[.14em] text-[#758675]">Локальний майстер налаштування · v0.9.4</p></div></div><div className="hidden items-center gap-2 rounded-full border border-[#c6d7c2] bg-[#fffaf2] px-3 py-2 text-xs text-[#596d5f] sm:flex"><ShieldCheck size={14} className="text-[#54755a]"/> Дані лишаються у вашій мережі</div></header>
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <aside className="rounded-3xl bg-[#e5ebdf] p-4 lg:min-h-[610px]"> <p className="px-3 pb-3 font-mono text-[10px] uppercase tracking-[.15em] text-[#758675]">Налаштування бота</p>{side.map((item,i)=>{const Icon=item.icon;const current=(stage==='configure'&&i===0)||(stage==='flash'&&i===1)||(stage==='discover'&&i===2)||(stage==='pair'&&i===3);return <button key={item.label} onClick={()=> i===0?setStage('configure'): item.done && setStage(i===1?'flash':i===2?'discover':'pair')} className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${current?'bg-[#fffaf2] shadow-sm':'hover:bg-[#d5dfd1]'}`}><span className={`grid h-8 w-8 place-items-center rounded-full ${item.done?'bg-[#cddabf] text-[#3c4d43]':current?'bg-[#6c806f] text-[#fffaf0]':'bg-[#d2dbcf] text-[#758675]'}`}>{item.done?<Check size={15}/>:<Icon size={16}/>}</span><span className="text-sm font-medium">{item.label}</span></button>})}<div className="mt-8 rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] p-3"><div className="flex items-center gap-2"><Wifi size={15} className="text-[#54755a]"/><span className="font-mono text-[10px] uppercase tracking-wider">Мережа готова</span></div><p className="mt-2 text-xs leading-5 text-[#657968]">Після запису бот знайдеться за адресою <b>claudebot.local</b>.</p></div></aside>
      <main className="min-w-0">
        {stage==='configure' && <><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#758675]">01 · ПІДГОТОВКА</p><h2 className="mt-2 text-4xl font-semibold tracking-tight">Зберемо вашого бота.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-[#596d5f]">Як у Raspberry Pi Imager: виберіть плату, підготовлений образ і картку памʼяті. Потім додамо мережеві параметри для першого запуску.</p></div><button onClick={()=>setCustomize(!customize)} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${customize?'border-[#6c806f] bg-[#6c806f] text-[#fffaf0]':'border-[#aebfa9] bg-[#fffaf2] hover:bg-[#e5ebdf]'}`}><Settings2 size={14}/> {customize?'Налаштування відкриті':'Редагувати параметри'}</button></div>
          <div className="mt-7 grid gap-4 md:grid-cols-3"><Choice title="1 · Плата" icon={Cpu} value={device} options={['Raspberry Pi 5','Raspberry Pi 4','Raspberry Pi Zero 2 W']} onChange={setDevice}/><Choice title="2 · Образ ОС" icon={Image} value={image} options={['Claude Bot OS','Raspberry Pi OS Lite','Власний .img файл']} onChange={setImage}/><Choice title="3 · Носій" icon={Usb} value={storage} options={['SanDisk Extreme · 31.9 GB','Samsung EVO · 63.8 GB']} onChange={setStorage}/></div>
          <section className="mt-5 rounded-3xl border border-[#c6d7c2] bg-[#fffaf2] p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e4eddc] text-[#54755a]"><Info size={18}/></span><div><h3 className="font-medium">Claude Bot OS · готово для першого запуску</h3><p className="mt-1 text-sm text-[#657968]">Raspberry Pi OS Lite + голосовий сервіс, локальна панель керування та mDNS-пошук вже в образі.</p></div></div>{customize && <div className="mt-5 grid gap-3 border-t border-[#d6e0d1] pt-5 sm:grid-cols-2"><MiniInput label="WI‑FI НАЗВА" value="Kyiv Home 5G"/><MiniInput label="WI‑FI ПАРОЛЬ" value="••••••••••••"/><MiniInput label="HOSTNAME" value="claudebot.local"/><MiniInput label="ЧАСОВИЙ ПОЯС" value="Europe / Kyiv"/></div>}</section>
          <div className="mt-5 flex items-center justify-between rounded-3xl bg-[#6c806f] p-5 text-[#fffaf0]"><div><p className="font-mono text-[10px] uppercase tracking-wider text-[#d9e6d6]">Готово до запису</p><p className="mt-1 text-sm">Усі дані на <b>{storage.split(' · ')[0]}</b> буде стерто.</p></div><button onClick={startFlash} className="inline-flex items-center gap-2 rounded-2xl bg-[#cddabf] px-5 py-3 text-sm font-semibold text-[#3c4d43] transition hover:bg-[#e3efd7] active:scale-[.98]">Записати образ <MonitorUp size={17}/></button></div>
        </>}
        {stage==='flash' && <><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#758675]">02 · ЗАПИС ОБРАЗУ</p><h2 className="mt-2 text-4xl font-semibold tracking-tight">Готуємо SD-картку.</h2><p className="mt-3 text-sm text-[#596d5f]">Не відʼєднуйте карту до завершення перевірки — це захищає від пошкодженого запуску.</p><section className="mt-7 rounded-3xl border border-[#c6d7c2] bg-[#fffaf2] p-6"><div className="flex items-end justify-between"><div><p className="font-mono text-[10px] uppercase tracking-wider text-[#758675]">Загальний прогрес</p><p className="mt-1 text-4xl font-semibold">{progress}%</p></div><HardDrive size={34} className="text-[#6c806f]"/></div><div className="mt-5 h-3 overflow-hidden rounded-full bg-[#e0e8dc]"><div className="h-full rounded-full bg-[#8ea683] transition-all duration-500" style={{width:`${progress}%`}}/></div><div className="mt-6 space-y-1">{flashStages.map(([title,detail],i)=><div key={title} className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${i===activeFlash?'bg-[#e8f0e2]':i<activeFlash?'text-[#657968]':'text-[#9ba99b]'}`}><span>{i<activeFlash?<CircleCheck size={18} className="text-[#54755a]"/>:i===activeFlash?<RefreshCw size={18} className="animate-spin text-[#6c806f]"/>:<span className="block h-[18px] w-[18px] rounded-full border border-current"/>}</span><div className="flex-1"><p className="text-sm font-medium">{title}</p><p className="text-xs opacity-70">{detail}</p></div>{i===activeFlash && <span className="font-mono text-[10px]">В процесі</span>}</div>)}</div></section><button onClick={advanceFlash} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#6c806f] px-5 py-3 text-sm font-medium text-[#fffaf0] transition hover:bg-[#596d5f]">{progress>=100?'Продовжити до пошуку':'Продовжити запис'} <ChevronDown className="-rotate-90" size={16}/></button></>}
        {stage==='discover' && <><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#758675]">03 · ПЕРШИЙ ЗАПУСК</p><h2 className="mt-2 text-4xl font-semibold tracking-tight">Бот уже в мережі.</h2><p className="mt-3 text-sm text-[#596d5f]">Шукаємо пристрій через локальний mDNS / Bonjour. Ніяких зовнішніх серверів.</p><section className="mt-7 overflow-hidden rounded-3xl border border-[#c6d7c2] bg-[#fffaf2]"><div className="flex items-center justify-between bg-[#e8f0e2] px-5 py-3"><span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-[#54755a]"><Radio size={14} className="animate-pulse"/> 1 пристрій знайдено</span><button onClick={()=>setStage('discover')} className="text-[#54755a]"><RefreshCw size={15}/></button></div><button onClick={()=>setStage('pair')} className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-[#f3f7ee]"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#6c806f] text-[#fffaf0]"><Bot size={26}/></span><span className="flex-1"><b className="block">Клод Бот</b><span className="mt-1 block font-mono text-xs text-[#657968]">claudebot.local · 192.168.1.114</span><span className="mt-2 inline-flex items-center gap-1 text-xs text-[#54755a]"><CircleCheck size={13}/> Готовий до звʼязування</span></span><ChevronDown className="-rotate-90" size={19}/></button></section><button onClick={()=>setStage('pair')} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#6c806f] px-5 py-3 text-sm font-medium text-[#fffaf0]">Підключити Клод Бота <ChevronDown className="-rotate-90" size={16}/></button></>}
        {stage==='pair' && <><p className="font-mono text-[10px] uppercase tracking-[.18em] text-[#758675]">04 · ПРИВАТНИЙ ДОСТУП</p><h2 className="mt-2 text-4xl font-semibold tracking-tight">Додайте телефон.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-[#596d5f]">Відскануйте код у мобільному застосунку. Пара створюється тільки між вашим телефоном і цим ботом у локальній мережі.</p><section className="mt-7 grid max-w-2xl gap-5 rounded-3xl bg-[#6c806f] p-6 text-[#fffaf0] sm:grid-cols-[150px_1fr]"><div className="grid aspect-square grid-cols-7 gap-1 rounded-xl bg-[#fffaf2] p-3">{Array.from({length:49},(_,i)=><i key={i} className={`${(i*i+i*7)%5<2?'bg-[#435549]':'bg-[#fffaf2]'}`}/>)}</div><div><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#d9e6d6]">Одноразовий код пари</p><p className="mt-2 font-mono text-3xl tracking-[.18em] text-[#e7efd9]">482 917</p><p className="mt-4 text-sm text-[#e6eee3]">Дійсний ще 04:43. Після підтвердження телефон отримає доступ до налаштувань бота.</p><div className="mt-4 flex items-center gap-2 text-xs text-[#d9e6d6]"><Router size={14}/> Зʼєднання зашифроване у локальній мережі</div></div></section><button onClick={()=>setPaired(!paired)} className={`mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-medium transition ${paired?'bg-[#cddabf] text-[#3c4d43]':'border border-[#6c806f] hover:bg-[#e5ebdf]'}`}>{paired?<><Check size={16}/> Телефон успішно підключено</>:'Я ввів код у застосунку'}</button></>}
      </main>
    </div>
  </div></div>
}
function Choice({title,icon:Icon,value,options,onChange}:{title:string;icon:ComponentType<LucideProps>;value:string;options:string[];onChange:(value:string)=>void}) { const [open,setOpen]=useState(false);return <div className="relative rounded-3xl border border-[#c6d7c2] bg-[#fffaf2] p-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e5ebdf] text-[#54755a]"><Icon size={18}/></span><p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-[#758675]">{title}</p><button onClick={()=>setOpen(!open)} className="mt-1 flex w-full items-center justify-between text-left text-sm font-medium">{value}<ChevronDown size={16}/></button>{open&&<div className="absolute inset-x-2 top-[105px] z-10 rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] p-1 shadow-lg">{options.map(option=><button key={option} onClick={()=>{onChange(option);setOpen(false)}} className="block w-full rounded-xl px-3 py-2 text-left text-xs hover:bg-[#e5ebdf]">{option}</button>)}</div>}</div> }
function MiniInput({label,value}:{label:string;value:string}) {return <label className="rounded-2xl bg-[#f1f5ed] px-3 py-2"><span className="block font-mono text-[9px] tracking-wider text-[#758675]">{label}</span><input className="mt-1 w-full bg-transparent text-sm outline-none" defaultValue={value}/></label>}
function PhoneSetup({onDone}:{onDone:()=>void}) {
  const [step,setStep]=useState(0)
  const [scanned,setScanned]=useState(false)
  const [name,setName]=useState('Андрій')
  const [notifications,setNotifications]=useState(true)
  const [microphone,setMicrophone]=useState(true)
  const steps=['Сканування','Підтвердження','Ваш профіль','Доступи']
  const next=()=>setStep(Math.min(3,step+1))
  return <div className="flex h-full flex-col bg-[#f6f0e5] text-[#3b4a3e]"><header className="px-6 pb-4 pt-7"><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="grid h-9 w-9 place-items-center rounded-2xl bg-[#6c806f] text-[#fffaf0]"><Bot size={18}/></span><span className="text-sm font-semibold">Claude Bot</span></div><span className="font-mono text-[10px] text-[#758675]">{step+1} / 4</span></div><div className="mt-5 flex gap-1.5">{steps.map((_,i)=><span key={i} className={`h-1.5 flex-1 rounded-full ${i<=step?'bg-[#6c806f]':'bg-[#d4ddd0]'}`}/>)}</div></header><main className="flex-1 overflow-y-auto px-6 pb-6 [scrollbar-width:none]">
    {step===0&&<><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#758675]">Додати пристрій</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Зіскануйте код<br/>із компʼютера.</h2><p className="mt-3 text-sm leading-6 text-[#657968]">Відкрийте Claude Bot Studio на ПК та перейдіть до «Звʼязати телефон».</p><button onClick={()=>setScanned(!scanned)} className={`relative mt-7 grid aspect-square w-full place-items-center overflow-hidden rounded-[34px] border-2 border-dashed transition ${scanned?'border-[#6c806f] bg-[#e1ebd9]':'border-[#aebfa9] bg-[#fffaf2] active:scale-[.98]'}`}>{scanned?<div className="text-center"><span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#6c806f] text-[#fffaf0]"><Check size={30}/></span><b className="mt-4 block text-lg">Код зчитано</b><span className="mt-1 block text-xs text-[#657968]">ClaudeBot-7F2A знайдено</span></div>:<><div className="absolute inset-7 rounded-[24px] border-2 border-[#6c806f]"/><div className="absolute left-7 right-7 h-0.5 bg-[#6c806f] shadow-[0_0_18px_5px_rgba(108,128,111,.22)]"/><span className="grid h-16 w-16 place-items-center rounded-full bg-[#e1ebd9] text-[#54755a]"><ScanLine size={28}/></span><span className="absolute bottom-7 text-xs text-[#657968]">Торкніться для демо-сканування</span></>}</button><button onClick={()=>setScanned(true)} className="mt-4 w-full text-center text-xs font-medium text-[#54755a] underline underline-offset-4">Ввести 6-значний код вручну</button></>}
    {step===1&&<><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#758675]">Пристрій знайдено</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Це ваш бот?</h2><section className="mt-7 rounded-[28px] bg-[#6c806f] p-5 text-[#fffaf0]"><div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#cddabf] text-[#3c4d43]"><Bot size={27}/></span><div><h3 className="text-lg font-semibold">Клод Бот</h3><p className="mt-1 font-mono text-[10px] text-[#d9e6d6]">claudebot.local</p></div><CircleCheck className="ml-auto text-[#e7efd9]" size={20}/></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-[#aabca8] pt-4"><div><p className="font-mono text-[9px] uppercase text-[#d9e6d6]">Мережа</p><p className="mt-1 text-sm">Kyiv Home 5G</p></div><div><p className="font-mono text-[9px] uppercase text-[#d9e6d6]">ID пристрою</p><p className="mt-1 text-sm">7F2A-91E</p></div></div></section><div className="mt-5 rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] p-4"><div className="flex gap-3"><ShieldCheck className="shrink-0 text-[#54755a]" size={19}/><p className="text-xs leading-5 text-[#657968]">Пара створюється в локальній мережі. Ваші API-ключі та памʼять бота не передаються в хмару.</p></div></div></>}
    {step===2&&<><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#758675]">Ваш профіль</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Як бот має до вас звертатись?</h2><div className="mt-7 flex flex-col items-center"><button onClick={()=>setName(name==='Андрій'?'Олексій':'Андрій')} className="grid h-24 w-24 place-items-center rounded-full bg-[#e1c7b8] text-2xl font-semibold text-[#3c4d43] transition hover:scale-105">{name.slice(0,1)}</button><button onClick={()=>setName(name==='Андрій'?'Олексій':'Андрій')} className="mt-3 text-xs font-medium text-[#54755a]">Змінити фото</button></div><label className="mt-7 block rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] px-4 py-3"><span className="font-mono text-[10px] uppercase tracking-wider text-[#758675]">Ваше імʼя</span><input value={name} onChange={e=>setName(e.target.value)} className="mt-1 block w-full bg-transparent text-lg font-medium outline-none"/></label><div className="mt-5"><p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[#758675]">Стиль спілкування</p><div className="grid grid-cols-3 gap-2">{['Теплий','Спокійний','Дотепний'].map((m,i)=><button key={m} className={`rounded-2xl border py-3 text-xs transition ${i===0?'border-[#6c806f] bg-[#e5ebdf] text-[#3c4d43]':'border-[#c6d7c2] bg-[#fffaf2] hover:bg-[#e5ebdf]'}`}>{m}</button>)}</div></div></>}
    {step===3&&<><p className="font-mono text-[10px] uppercase tracking-[.16em] text-[#758675]">Майже готово</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">Оберіть доступи.</h2><p className="mt-3 text-sm leading-6 text-[#657968]">Їх можна змінити в налаштуваннях будь-коли.</p><div className="mt-7 space-y-3"><Permission icon={Mic} title="Мікрофон" text="Розмовляйте з ботом через телефон" on={microphone} setOn={setMicrophone}/><Permission icon={Smartphone} title="Сповіщення" text="Нагадування та стан бота" on={notifications} setOn={setNotifications}/><div className="rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] p-4"><div className="flex gap-3"><Database className="mt-0.5 shrink-0 text-[#54755a]" size={19}/><div><p className="text-sm font-medium">Локальна памʼять</p><p className="mt-1 text-xs leading-5 text-[#657968]">Нотатки та знайомства зберігаються на Клод Боті, не на телефоні.</p></div><Check className="ml-auto text-[#54755a]" size={18}/></div></div></div></>}
  </main><footer className="border-t border-[#d4ddd0] bg-[#f6f0e5] px-6 py-5"><button disabled={step===0&&!scanned} onClick={step===3?onDone:next} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6c806f] py-4 text-sm font-semibold text-[#fffaf0] transition enabled:hover:bg-[#596d5f] enabled:active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40">{step===3?'Відкрити мого бота':'Продовжити'} <ChevronDown className="-rotate-90" size={17}/></button>{step>0&&<button onClick={()=>setStep(step-1)} className="mt-3 w-full text-xs font-medium text-[#657968]">Назад</button>}</footer></div>
}
function Permission({icon:Icon,title,text,on,setOn}:{icon:ComponentType<LucideProps>;title:string;text:string;on:boolean;setOn:(value:boolean)=>void}) {return <div className="flex items-center gap-3 rounded-2xl border border-[#c6d7c2] bg-[#fffaf2] p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e5ebdf] text-[#54755a]"><Icon size={19}/></span><div className="flex-1"><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs text-[#657968]">{text}</p></div><Toggle on={on} setOn={setOn}/></div>}

export default function App(){ const [mode,setMode]=useState<'mobile'|'desktop'>('mobile'); const [mobileReady,setMobileReady]=useState(true); return <div className="min-h-screen bg-[#dfe7dc] p-4 sm:p-8"><header style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:12,maxWidth:1152,margin:'0 auto 12px auto'}}><Show when="signed-out"><SignInButton /><SignUpButton /></Show><Show when="signed-in"><UserButton /></Show></header><div className="mx-auto mb-6 flex max-w-6xl justify-center"><div className="rounded-full border border-[#a8b8a5] bg-[#3b4a3e] p-1 text-xs text-[#dbe7d6]"><button onClick={()=>setMode('mobile')} className={`rounded-full px-4 py-2 ${mode==='mobile'?'bg-[#cddabf] text-[#3c4d43]':''}`}>Mobile app</button><button onClick={()=>setMode('desktop')} className={`rounded-full px-4 py-2 ${mode==='desktop'?'bg-[#cddabf] text-[#3c4d43]':''}`}>Desktop setup</button></div></div>{mode==='mobile'?<div className="mx-auto h-[800px] max-w-[390px] overflow-hidden rounded-[38px] border-[8px] border-[#657967] shadow-2xl shadow-black/50">{mobileReady?<MobileApp/>:<PhoneSetup onDone={()=>setMobileReady(true)}/>}</div>:<div className="mx-auto min-h-[760px] max-w-6xl overflow-hidden rounded-3xl border border-[#a8b8a5] shadow-2xl shadow-black/40"><DesktopWizard/></div>}</div> }
