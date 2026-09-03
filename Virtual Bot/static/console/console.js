/* ============================================================
   Клод Бот — окрема консоль (/console)

   Три речі в одному вікні, щоб під час розмови не гадати:
   1) ПРОЦЕСИ — хто з ланцюга зараз живий (порт/health/pid);
   2) ХІД РОЗМОВИ — кожна репліка як маршрут: які мозки пробувались,
      скільки тривала кожна спроба, чому впала, які тули смикались;
   3) ЛОГИ — сирий потік рядків бекенду (той самий, що в панелі).

   Джерела: SSE /api/events (живе) + /api/trace, /api/console (історія
   при відкритті) + /api/processes (опитування раз на 3с).
   ============================================================ */

const $ = (id) => document.getElementById(id);

const MAX_ROWS = 300;    // карток/рядків у стрічці ходу
const MAX_LOGS = 800;    // рядків у буфері логів
const PROC_POLL_MS = 3000;

const state = {
  paused: false,
  booted: false,         // історія вже намальована?
  sessionId: "",         // Watch дивиться лише на активну розмову
  viewStartedAt: 0,       // не приймаємо старий turn під час перемикання
  bootBuffer: [],        // живі події, що прийшли ДО того (див. boot())
  pending: [],           // події, що прийшли на паузі
  turns: new Map(),      // turn_id -> {turn, el}
  logs: [],              // буфер логів (щоб фільтр працював заднім числом)
  logFilter: "",
  onlyProblems: false,
};
let viewLoadVersion = 0;

function activeSessionId() {
  try {
    const kind = localStorage.getItem("virtual_bot_active_session_kind") === "code" ? "code" : "chat";
    const key = kind === "code" ? "virtual_bot_code_session_id" : "virtual_bot_session_id";
    return localStorage.getItem(key) || "";
  } catch (err) {
    return "";
  }
}

function scopedUrl(path, sessionId) {
  return `${path}?session_id=${encodeURIComponent(sessionId)}`;
}

/* ---------- дрібні хелпери ---------- */

const pad2 = (n) => String(n).padStart(2, "0");

function hhmmss(epochSeconds) {
  const d = new Date((epochSeconds || 0) * 1000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function ms(value) {
  if (value === null || value === undefined) return "";
  return value < 1000 ? `${Math.round(value)} мс` : `${(value / 1000).toFixed(1)} с`;
}

const MARK = { ok: "✓", fail: "✗", skip: "–", start: "…" };
const STAGE_ICON = { tool: "⚙", asr: "🎤", tts: "🔊", vision: "👁", music: "♪", screen: "▣", ui: "▤", say: "💬" };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function follows() {
  return $("follow").checked;
}

function scrollDown(node) {
  if (follows()) node.scrollTop = node.scrollHeight;
}

/* ---------- хід розмови ---------- */

/**
 * Схлопує пару «start → ok/fail» одного мозку в ОДИН рядок.
 * Інакше кожна спроба займала б два рядки, і маршрут із чотирьох мозків
 * розтягувався б на вісім — саме те, що заважає читати краєм ока.
 */
function mergeSteps(steps) {
  const out = [];
  for (const step of steps) {
    if (step.state === "ok" || step.state === "fail") {
      const idx = out.findIndex(
        (s) => s.state === "start" && s.stage === step.stage && s.name === step.name
      );
      if (idx !== -1) { out[idx] = step; continue; }
    }
    out.push(step);
  }
  return out;
}

function stepRow(step, cls) {
  const row = el("li", cls || "step");
  row.dataset.state = step.state;
  const icon = STAGE_ICON[step.stage] || "";
  row.append(
    el("span", "step-mark", MARK[step.state] || "·"),
    el("span", "step-name", icon ? `${icon} ${step.name}` : step.name),
    el("span", "step-detail", step.detail || ""),
    el("span", "step-ms", ms(step.ms))
  );
  return row;
}

function renderTurn(turn) {
  let entry = state.turns.get(turn.id);
  if (!entry) {
    const card = el("article", "turn");
    const head = el("div", "turn-head");
    head.append(
      el("span", "turn-src", turn.source === "screen" ? "екран" : turn.source || "чат"),
      el("span", "turn-text", turn.text || "(порожньо)"),
      el("span", "turn-time", hhmmss(turn.t))
    );
    const steps = el("ul", "steps");
    const foot = el("div", "turn-foot");
    card.append(head, steps, foot);
    entry = { turn, el: card, stepsEl: steps, footEl: foot };
    state.turns.set(turn.id, entry);
    appendRow(card);
  }
  entry.turn = turn;
  entry.el.dataset.live = turn.done ? "0" : "1";

  entry.stepsEl.textContent = "";
  for (const step of mergeSteps(turn.steps || [])) entry.stepsEl.append(stepRow(step));

  entry.footEl.textContent = "";
  entry.footEl.classList.toggle("err", Boolean(turn.error));
  if (turn.error) {
    entry.footEl.append(el("span", null, "впало:"), el("b", null, turn.error));
  } else if (turn.done) {
    entry.footEl.append(
      el("span", null, "відповів"),
      el("b", null, turn.mode || "?"),
      el("span", null, turn.model ? `· ${turn.model}` : ""),
      el("span", null, turn.emotion ? `· ${turn.emotion}` : ""),
      el("span", null, `· ${ms(turn.ms)}`)
    );
  } else {
    entry.footEl.append(el("span", null, "думає…"));
  }
  return entry;
}

/* Незавершені вільні кроки: «⚙ тул …» чекає на свій «✓ 0.4 с». */
const loosePending = new Map();

function fillLoose(row, step) {
  row.textContent = "";
  row.dataset.state = step.state;
  const icon = STAGE_ICON[step.stage] || "";
  row.append(
    el("span", null, hhmmss(step.t)),
    el("span", null, MARK[step.state] || "·"),
    el("b", null, icon ? `${icon} ${step.name}` : step.name),
    el("span", null, step.detail || ""),
    el("span", null, ms(step.ms))
  );
}

/**
 * Крок поза ходом: тул від зовнішнього мозку, ASR, подія зору тощо.
 * Пару «start → ok/fail» схлопуємо в один рядок — так само, як усередині
 * ходу: два рядки на кожен тул перетворюють стрічку на кашу.
 */
function renderLoose(step) {
  const key = `${step.stage}/${step.name}`;
  if (step.state === "ok" || step.state === "fail") {
    const waiting = loosePending.get(key);
    if (waiting) {
      loosePending.delete(key);
      fillLoose(waiting, step);
      return;
    }
  }
  const row = el("div", "loose");
  fillLoose(row, step);
  if (step.state === "start") loosePending.set(key, row);
  appendRow(row);
}

function appendRow(node) {
  const flow = $("flow");
  const empty = flow.querySelector(".empty");
  if (empty) empty.remove();
  flow.append(node);
  while (flow.children.length > MAX_ROWS) {
    const gone = flow.firstElementChild;
    for (const [id, entry] of state.turns) if (entry.el === gone) state.turns.delete(id);
    gone.remove();
  }
  scrollDown(flow);
}

/* ---------- логи ---------- */

function logVisible(entry) {
  if (state.onlyProblems && entry.level !== "WARNING" && entry.level !== "ERROR" && entry.level !== "CRITICAL") {
    return false;
  }
  if (!state.logFilter) return true;
  const needle = state.logFilter.toLowerCase();
  return (entry.msg || "").toLowerCase().includes(needle)
      || (entry.name || "").toLowerCase().includes(needle);
}

function logRow(entry) {
  const row = el("div", "log-line");
  row.dataset.level = entry.level || "INFO";
  row.append(
    el("span", "log-t", hhmmss(entry.t)),
    el("span", "log-name", (entry.name || "").replace(/^virtual_bot\./, "")),
    el("span", "log-msg", entry.msg || "")
  );
  return row;
}

function appendLog(entry) {
  state.logs.push(entry);
  while (state.logs.length > MAX_LOGS) state.logs.shift();
  if (!logVisible(entry)) return;
  const box = $("logs");
  box.append(logRow(entry));
  while (box.children.length > MAX_LOGS) box.firstElementChild.remove();
  scrollDown(box);
}

function rerenderLogs() {
  const box = $("logs");
  box.textContent = "";
  for (const entry of state.logs) if (logVisible(entry)) box.append(logRow(entry));
  box.scrollTop = box.scrollHeight;
}

/* ---------- процеси ---------- */

function procState(p) {
  if (p.local === false) return p.healthy === true ? "ok" : "cloud";
  if (p.listening === false) return "off";
  if (p.healthy === false) return "warn";
  return "ok";
}

function renderProcesses(data) {
  const box = $("procs");
  box.textContent = "";
  let alive = 0;
  for (const p of data.processes || []) {
    const st = procState(p);
    if (st === "ok") alive += 1;
    const card = el("div", "proc");
    card.dataset.state = st;
    card.append(el("span", "dot"));

    const mid = el("div");
    const name = el("div", "proc-name");
    name.append(el("b", null, p.label));
    if (p.chain) name.append(el("span", "proc-chain", `мозок ${p.chain}`));
    mid.append(name, el("div", "proc-role", p.role || ""));
    let meta;
    if (p.local === false) {
      meta = "зовнішній шлюз";
    } else if (p.listening) {
      meta = p.pid ? `:${p.port} · pid ${p.pid} ${p.command || ""}` : `:${p.port} · слухає`;
      if (p.healthy === false) meta += " · health мовчить";
    } else {
      meta = `:${p.port} · не запущено`;
    }
    mid.append(el("div", "proc-meta", meta));
    card.append(mid);

    const right = el("div", "proc-right");
    right.append(el("b", null, p.latency_ms !== null && p.latency_ms !== undefined ? ms(p.latency_ms) : ""));
    card.append(right);
    box.append(card);
  }
  $("procNote").textContent = `${alive} живих · ${data.sse_clients ?? "?"} глядачів`;

  const brain = data.brain || {};
  const bb = $("brainbox");
  bb.textContent = "";
  const rows = [
    ["відповідав", brain.last_mode || "—"],
    ["модель", brain.last_model || "—"],
    ["модель Omni", brain.selected_omni_model || "—"],
  ];
  if (brain.openclaw_backoff_s > 0) rows.push(["OpenClaw у бекофі", `${brain.openclaw_backoff_s} с`]);
  if (brain.omni_backoff_s > 0) rows.push(["Omni у бекофі", `${brain.omni_backoff_s} с`]);
  for (const [k, v] of rows) {
    const line = el("div");
    if (k.includes("бекоф")) line.className = "hot";
    line.append(el("span", null, k), el("span", null, v));
    bb.append(line);
  }
}

async function pollProcesses() {
  try {
    const resp = await fetch("/api/processes", { cache: "no-store" });
    if (resp.ok) renderProcesses(await resp.json());
  } catch (err) {
    /* бекенд перезапускається — наступна спроба через 3с */
  }
}

/* ---------- живі події ---------- */

function handle(ev) {
  const kind = ev?.type;
  if (kind === "trace" || kind === "log") {
    const eventSession = kind === "trace"
      ? ev.turn?.session || (ev.turn_id && state.turns.get(ev.turn_id)?.turn.session) || ""
      : ev.session || "";
    /* Без активної сесії чекаємо наступний turn_start. Це залишає Watch
       порожнім у новій розмові й не повертає стару глобальну історію. */
    if (!state.sessionId && kind === "trace" && ev.event === "turn_start" && eventSession) {
      if ((ev.turn?.t || 0) < state.viewStartedAt) return;
      state.sessionId = eventSession;
    }
    if (!state.sessionId || eventSession !== state.sessionId) return;
  }
  // Поки вантажиться історія, живі події чекають: інакше рядок, що прийшов
  // за секунду до відповіді /api/console, ліг би ВИЩЕ за годинну історію —
  // і час у колонці стрибав би назад.
  if (!state.booted) {
    state.bootBuffer.push(ev);
    return;
  }
  if (state.paused) {
    state.pending.push(ev);
    if (state.pending.length > 500) state.pending.shift();
    return;
  }
  apply(ev);
}

function apply(ev) {
  switch (ev.type) {
    case "log":
      appendLog(ev);
      break;
    case "trace":
      if (ev.event === "turn_start" || ev.event === "turn_end") {
        renderTurn(ev.turn);
      } else if (ev.event === "step") {
        const entry = ev.turn_id ? state.turns.get(ev.turn_id) : null;
        if (entry) {
          entry.turn.steps = (entry.turn.steps || []).concat([ev.step]);
          renderTurn(entry.turn);
        } else {
          renderLoose(ev.step);   // хід уже витіснений з екрана або кроку без ходу
        }
      }
      break;
    case "vision":
      renderLoose({ t: Date.now() / 1000, stage: "vision", name: ev.event, state: "ok",
                    detail: `облич: ${ev.faces}`, ms: null });
      break;
    case "say":
      renderLoose({ t: Date.now() / 1000, stage: "say", name: "бот сам", state: "ok",
                    detail: ev.text || "", ms: null });
      break;
    case "music":
      renderLoose({ t: Date.now() / 1000, stage: "music", name: ev.action, state: "ok",
                    detail: (ev.track && ev.track.title) || "", ms: null });
      break;
    case "screen":
      renderLoose({ t: Date.now() / 1000, stage: "screen", name: "екран", state: "ok",
                    detail: ev.screen || "", ms: null });
      break;
    default:
      break;  /* emotion/reply/ui/tool уже видно в картці ходу — не дублюємо */
  }
}

function connect() {
  const source = new EventSource("/api/events");
  source.onopen = () => {
    $("liveDot").dataset.on = "1";
    $("barSub").textContent = "живий потік /api/events";
  };
  source.onerror = () => {
    $("liveDot").dataset.on = "0";
    $("barSub").textContent = "звʼязок втрачено — перепідключення…";
  };
  source.onmessage = (msg) => {
    try { handle(JSON.parse(msg.data)); } catch (err) { /* keep-alive або сміття */ }
  };
}

/* ---------- історія при відкритті ---------- */

async function loadHistory(version) {
  let lastLogT = 0;
  const sessionId = activeSessionId();
  state.sessionId = sessionId;
  try {
    const resp = await fetch(scopedUrl("/api/trace", sessionId), { cache: "no-store" });
    if (version !== viewLoadVersion) return lastLogT;
    if (resp.ok) {
      const data = await resp.json();
      const rows = [
        ...(data.turns || []).map((t) => ({ t: t.t, kind: "turn", data: t })),
        ...(data.events || []).map((s) => ({ t: s.t, kind: "step", data: s })),
      ].sort((a, b) => a.t - b.t);
      for (const row of rows) {
        if (row.kind === "turn") renderTurn(row.data); else renderLoose(row.data);
      }
    }
  } catch (err) { /* порожня консоль — не біда */ }

  try {
    const resp = await fetch(scopedUrl("/api/console", sessionId), { cache: "no-store" });
    if (version !== viewLoadVersion) return lastLogT;
    if (resp.ok) {
      const data = await resp.json();
      for (const entry of data.logs || []) {
        appendLog(entry);
        if (entry.t > lastLogT) lastLogT = entry.t;
      }
    }
  } catch (err) { /* те саме */ }
  return lastLogT;
}

function clearView(message = "Поки тихо. Наступна репліка зʼявиться тут.") {
  $("flow").textContent = "";
  $("logs").textContent = "";
  state.turns.clear();
  loosePending.clear();
  state.logs.length = 0;
  state.pending.length = 0;
  $("flow").append(el("p", "empty", message));
}

async function bootSessionView() {
  const version = ++viewLoadVersion;
  state.viewStartedAt = Date.now() / 1000;
  state.booted = false;
  state.bootBuffer.length = 0;
  clearView("Поточна розмова ще не має подій.");
  const lastLogT = await loadHistory(version);
  if (version !== viewLoadVersion) return;
  const queued = state.bootBuffer.splice(0);
  state.booted = true;
  for (const ev of queued) {
    if (ev.type === "log" && ev.t !== undefined && ev.t <= lastLogT) continue;
    handle(ev);
  }
}

/* ---------- керування ---------- */

$("pauseBtn").addEventListener("click", (e) => {
  state.paused = !state.paused;
  const btn = e.currentTarget;
  btn.dataset.paused = state.paused ? "1" : "0";
  btn.textContent = state.paused ? `Пауза (${state.pending.length})` : "Пауза";
  if (!state.paused) {
    const queued = state.pending.splice(0);
    for (const ev of queued) apply(ev);
    btn.textContent = "Пауза";
  }
});

$("clearBtn").addEventListener("click", () => {
  clearView("Очищено. Наступна подія зʼявиться тут.");
});

$("logFilter").addEventListener("input", (e) => {
  state.logFilter = e.target.value.trim();
  rerenderLogs();
});

$("onlyProblems").addEventListener("change", (e) => {
  state.onlyProblems = e.target.checked;
  rerenderLogs();
});

/* Показуємо, скільки подій накопичилось на паузі */
setInterval(() => {
  if (state.paused) $("pauseBtn").textContent = `Пауза (${state.pending.length})`;
}, 500);

/**
 * Порядок запуску: підписуємось ОДРАЗУ (щоб не проґавити подію, поки
 * вантажиться історія), але малюємо буфер лише після неї — і викидаємо з
 * нього лог-рядки, які вже приїхали в історії, щоб не задвоювались.
 */
async function boot() {
  connect();
  await bootSessionView();
}

/* Agent Talk змінює session_id у localStorage. Якщо Watch відкритий окремим
   вікном, storage-подія перемикає його без ручного перезавантаження. */
window.addEventListener("storage", (event) => {
  if (!["virtual_bot_session_id", "virtual_bot_code_session_id", "virtual_bot_active_session_kind"].includes(event.key)) return;
  void bootSessionView();
});

boot();
pollProcesses();
setInterval(pollProcesses, PROC_POLL_MS);
