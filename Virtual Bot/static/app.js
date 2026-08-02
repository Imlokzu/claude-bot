"use strict";

/* ============================================================
   Клод Бот — Віртуальний · логіка панелі керування
   Бекенд: FastAPI на 127.0.0.1:8100 (роздає цю статику сам,
   тому всі виклики API — відносні шляхи /api/...).
   MJPEG-потік зору береться НАПРЯМУ з 127.0.0.1:8000.
   ============================================================ */

const VISION_STREAM_URL = "http://127.0.0.1:8000/vision/stream.mjpg";
const STATUS_POLL_MS = 5000;

const $ = (id) => document.getElementById(id);

/* ---------- Вкладки дашборда ---------- */

(function initTabs() {
  const tabs = document.querySelectorAll(".dashboard-tab");
  const panels = document.querySelectorAll(".dashboard-panel");
  if (!tabs.length || !panels.length) return;

  function setTab(name) {
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === name));
    try { localStorage.setItem("dashboardTab", name); } catch (e) {}
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.dataset.tab));
  });

  const saved = localStorage.getItem("dashboardTab");
  if (saved && document.querySelector(`.dashboard-tab[data-tab="${saved}"]`)) {
    setTab(saved);
  }
})();

/* ---------- Сповіщення (неблокуючі toasts) ---------- */

function toast(message, type = "error", ttlMs = 5000) {
  const box = $("toasts");
  // Не плодимо однакові сповіщення підряд
  if (box.lastChild && box.lastChild.dataset.msg === message) return;
  const el = document.createElement("div");
  el.className = "toast " + (type === "error" ? "" : type);
  el.dataset.msg = message;
  el.textContent = message;
  el.title = "Натисніть, щоб закрити";
  el.addEventListener("click", () => el.remove());
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), ttlMs);
}

/* ---------- Обгортка над fetch ---------- */

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (e) {
    const err = new Error("бекенд недоступний");
    err.status = 0;
    throw err;
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* відповідь без JSON — лишаємо null */
  }
  if (!res.ok) {
    let msg =
      (data && (data.error || data.detail || data.message)) ||
      "HTTP " + res.status;
    // FastAPI на 422 віддає detail-МАСИВ обʼєктів — витягаємо людський текст
    if (Array.isArray(msg)) {
      msg = msg.map((it) => (it && it.msg) || JSON.stringify(it)).join("; ");
    }
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function postJSON(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ---------- 1. Обличчя (піксельний краб) ---------- */

const crab = new PixelCrab($("crabCanvas"), $("faceLabel"), $("faceScreen"));
// Для ручних тестів у консолі: window.crab.showDefeat() тощо
window.crab = crab;
let idleTimer = null;

/* Повернення до «очікування» через певний час після емоції */
function scheduleIdleReturn(ms = 15000) {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if ($("emotionTest").value === "") crab.setEmotion("idle");
  }, ms);
}

/* Селект «Тест емоції» — ручний перегляд емоцій */
(function initEmotionTest() {
  const sel = $("emotionTest");
  for (const [key, label] of Object.entries(EMOTION_LABELS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = label + " (" + key + ")";
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    clearTimeout(idleTimer);
    crab.setEmotion(sel.value === "" ? "idle" : sel.value);
  });
})();

/* ---------- 2. Чат (класичний UI — захист на випадок, якщо React-панель не завантажилась) ---------- */

const chatMessages = $("chatMessages");
const chatInput = $("chatInput");
const chatSend = $("chatSend");
const chatTyping = $("chatTyping");

function addMessage(role, text, isError = false, isAuto = false) {
  if (!chatMessages) return;
  $("chatEmpty")?.remove();
  const el = document.createElement("div");
  el.className = "message " + role + (isError ? " error" : "");
  const label = document.createElement("span");
  label.className = "msg-label";
  // isAuto — бот сказав це сам (подія з /api/events), без запиту користувача
  label.textContent = role === "user" ? "ТИ" : isAuto ? "БОТ · сам" : "БОТ";
  el.appendChild(label);
  el.appendChild(document.createTextNode(text));
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

if (chatMessages && chatInput && chatSend && chatTyping && $("chatForm")) {
  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text || chatSend.disabled) return;

    addMessage("user", text);
    chatInput.value = "";
    chatSend.disabled = true;
    chatTyping.classList.remove("hidden");
    $("emotionTest").value = ""; // чат перемикає обличчя в авто-режим
    crab.setEmotion("searching"); // краб «копається у файлах» — шукає у памʼяті

    try {
      const r = await postJSON("/api/chat", { message: text });
      // Порожній рядок теж вважаємо порожньою відповіддю (модель могла
      // надіслати сам лише тег емоції)
      const reply = typeof r.reply === "string" && r.reply.trim() !== "" ? r.reply : "(порожня відповідь)";
      addMessage("bot", reply);
      crab.setEmotion(r.emotion || "idle");
      speakText(reply, r.emotion); // озвучити голосом, якщо ввімкнено (Web Speech)
    } catch (err) {
      addMessage("bot", "Помилка чату: " + err.message, true);
      toast("Чат: " + err.message);
      // Краб «розпластується» на ~3 с, потім стає спантеличеним
      crab.showDefeat(3000, "confused");
    } finally {
      chatTyping.classList.add("hidden");
      chatSend.disabled = false;
      chatInput.focus();
      scheduleIdleReturn();
    }
  });

  /* Поки користувач друкує — бот «слухає» */
  chatInput.addEventListener("input", () => {
    if ($("emotionTest").value !== "" || chatSend.disabled) return;
    if (crab.emotion === "idle" && chatInput.value.trim() !== "") {
      crab.setEmotion("listening");
    } else if (crab.emotion === "listening" && chatInput.value.trim() === "") {
      crab.setEmotion("idle");
    }
  });
}

/* ---------- 2b. Голос: озвучка (TTS) + слухання (STT) через Web Speech API ----------
   Все у браузері: без бекенду, без ключів, без зовнішніх сервісів. Мозок лишається
   OpenClaw — голос лише озвучує його відповідь і диктує наш запит. */

const VOICE_LANG = "uk-UA";
let voiceOn = false;          // чи озвучувати відповіді
let ttsVoice = null;          // обраний українськй голос (як знайдеться)
let recognizing = false;      // чи слухаємо мікрофон зараз
let ttsRate = 1;              // швидкість озвучки (1 / 1.5 / 2×) — застосовується до відтворення

/* Ставить швидкість на <audio> зі збереженням висоти голосу (без «мультяшності») */
function applyRate(audio) {
  try { audio.playbackRate = ttsRate; audio.preservesPitch = true; audio.mozPreservesPitch = true; } catch (e) {}
}

const ttsOk = "speechSynthesis" in window;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const sttOk = !!SR;

/* Підбір українського (або словʼянського) голосу для озвучки */
function pickVoice() {
  if (!ttsOk) return;
  const voices = speechSynthesis.getVoices();
  ttsVoice =
    voices.find((v) => v.lang === "uk-UA") ||
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("uk")) ||
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("ru")) ||
    null;
}
if (ttsOk) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice; // голоси вантажаться асинхронно
}

let mimoTts = true;        // чи пробувати живий голос MiMo (вимкнеться, якщо недоступний)
let currentAudio = null;   // поточний <audio> живого голосу (щоб скасувати попередній)

/* Дізнаємось на старті, чи є живий голос MiMo (лише для підказки/рішення) */
(async function initTtsMode() {
  try {
    const r = await api("/api/tts/status");
    mimoTts = !!(r && r.enabled);
  } catch (e) {
    mimoTts = false;
  }
})();

/* Браузерний голос (запасний, якщо живий MiMo недоступний) */
function speakBrowser(text, emotion) {
  if (!ttsOk) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = VOICE_LANG;
    if (ttsVoice) u.voice = ttsVoice;
    u.rate = 1.02;
    u.pitch = 1.05;
    u.onstart = () => { if ($("emotionTest").value === "") crab.setEmotion("speaking"); };
    u.onend = () => {
      if ($("emotionTest").value === "") crab.setEmotion(emotion || "idle");
      scheduleIdleReturn();
    };
    speechSynthesis.speak(u);
  } catch (e) {
    /* озвучка не критична */
  }
}

/* Зупинити будь-яку поточну озвучку (живу й браузерну) */
function stopSpeaking() {
  if (currentAudio) { try { currentAudio.pause(); } catch (e) {} currentAudio = null; }
  if (ttsOk) { try { speechSynthesis.cancel(); } catch (e) {} }
}

/* Озвучити текст ЖИВИМ голосом MiMo (через /api/tts), з відкотом на браузерний.
   Поки говорить — краб у стані speaking. */
async function speakText(text, emotion) {
  if (!voiceOn || !text) return;
  stopSpeaking();
  if (!mimoTts) return speakBrowser(text, emotion); // MiMo нема — одразу браузер

  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) throw new Error("tts " + resp.status);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    applyRate(audio);
    currentAudio = audio;
    if ($("emotionTest").value === "") crab.setEmotion("speaking");
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      if ($("emotionTest").value === "") crab.setEmotion(emotion || "idle");
      scheduleIdleReturn();
    };
    audio.onerror = () => { URL.revokeObjectURL(url); speakBrowser(text, emotion); };
    await audio.play();
  } catch (e) {
    // MiMo недоступний (503/мережа) — відкат на браузерний голос
    speakBrowser(text, emotion);
  }
}

/* Кнопка «🔊» — вмикає/вимикає озвучку відповідей */
const voiceToggle = $("voiceToggle");
if (voiceToggle) {
  // Кнопку НЕ вимикаємо за браком браузерного TTS — живий голос MiMo працює через <audio>
  voiceToggle.addEventListener("click", () => {
    voiceOn = !voiceOn;
    voiceToggle.classList.toggle("on", voiceOn);
    voiceToggle.setAttribute("aria-pressed", String(voiceOn));
    voiceToggle.textContent = voiceOn ? "🔊" : "🔇";
    if (!voiceOn) stopSpeaking();
    const how = mimoTts ? "живим голосом ШІ" : "браузерним голосом";
    toast(voiceOn ? "Голос увімкнено — краб озвучуватиме " + how : "Голос вимкнено", "info", 2500);
  });
}

/* Кнопка «🎤» — слухати мікрофон і надиктувати повідомлення (uk-UA) */
const micBtn = $("micBtn");
let recognition = null;
if (micBtn) {
  if (!sttOk) {
    micBtn.disabled = true;
    micBtn.title = "Мікрофон недоступний у цьому браузері (спробуй Chrome)";
  } else {
    recognition = new SR();
    recognition.lang = VOICE_LANG;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add("on");
      if ($("emotionTest").value === "") crab.setEmotion("listening");
    };
    recognition.onresult = (ev) => {
      let txt = "";
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      if (chatInput) chatInput.value = txt;
      // фінальний результат → одразу надсилаємо (лише якщо є класична форма)
      if (ev.results[ev.results.length - 1].isFinal && txt.trim() && $("chatForm")) {
        $("chatForm").requestSubmit();
      }
    };
    recognition.onerror = (ev) => {
      recognizing = false;
      micBtn.classList.remove("on");
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        toast("Немає доступу до мікрофона — дозволь його у браузері", "error");
      }
    };
    recognition.onend = () => {
      recognizing = false;
      micBtn.classList.remove("on");
      if (chatSend && !chatSend.disabled && crab.emotion === "listening" && $("emotionTest").value === "") {
        crab.setEmotion("idle");
      }
    };
    micBtn.addEventListener("click", () => {
      if (recognizing) {
        recognition.stop();
        return;
      }
      try {
        if (chatInput) chatInput.value = "";
        recognition.start();
      } catch (e) {
        /* повторний start під час активного розпізнавання — ігноруємо */
      }
    });
  }
}

/* ---------- Вибір моделі Omni-роутера ---------- */

const modelSelect = $("modelSelect");
let modelPickerLoading = false; // прапорець проти паралельних/повторних ініціалізацій

function setModelPickerUnavailable() {
  if (!modelSelect) return;
  modelSelect.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = "— моделі недоступні —";
  modelSelect.appendChild(opt);
  modelSelect.disabled = true;
}

async function initModelPicker() {
  if (!modelSelect || modelPickerLoading) return;
  modelPickerLoading = true;
  try {
    const r = await api("/api/models");
    const models = (r && r.models) || [];
    if (models.length === 0) {
      setModelPickerUnavailable();
      return;
    }
    modelSelect.innerHTML = "";
    for (const m of models) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label || m.id;
      modelSelect.appendChild(opt);
    }
    // Виставляємо поточний вибір (лишається на значенні, лише якщо воно є у списку)
    if (r.selected) modelSelect.value = r.selected;
    modelSelect.dataset.current = modelSelect.value; // для відкату при помилці
    modelSelect.disabled = false;
  } catch (err) {
    setModelPickerUnavailable();
  } finally {
    modelPickerLoading = false;
  }
}

// Селектор моделі самовідновлюється: якщо перша ініціалізація не вдалася
// (disabled і ще нема dataset.current), пробуємо знову. Умова НЕ зачіпає
// тимчасовий disabled під час POST /api/model (там dataset.current уже є).
function ensureModelPicker() {
  if (modelSelect && modelSelect.disabled && !modelSelect.dataset.current) initModelPicker();
}

if (modelSelect) {
  modelSelect.addEventListener("change", async () => {
    const model = modelSelect.value;
    if (!model) return;
    const prev = modelSelect.dataset.current || "";
    const label = modelSelect.options[modelSelect.selectedIndex]?.textContent || model;
    modelSelect.disabled = true;
    try {
      const r = await postJSON("/api/model", { model });
      modelSelect.dataset.current = r.selected || model;
      toast("Модель бота: " + label, "ok", 3000);
    } catch (err) {
      toast("Модель: " + err.message);
      if (prev) modelSelect.value = prev; // відкат до попередньої моделі
    } finally {
      modelSelect.disabled = false;
    }
  });
}

/* ---------- Рядок активності: «що бот робить зараз» ----------
   Показує людяний опис дії за поточною емоцією краба. Коли OpenClaw
   почне стрімити реальну активність (tool use), вона ставитиме емоцію —
   і цей чип оновлюватиметься автоматично. */
const ACTIVITY_TEXT = {
  searching: "копається у файлах…",
  web: "шукає в мережі…",
  working: "працює над задачею…",
  writing: "пише нотатку…",
  loading: "обробляє…",
  thinking: "думає…",
  asking: "має запитання",
  speaking: "говорить…",
  listening: "слухає…",
  greeting: "вітається",
  celebrating: "святкує!",
};
const activityChip = $("activityChip");
const activityText = $("activityText");

function updateActivity() {
  const txt = ACTIVITY_TEXT[crab.emotion];
  if (txt) {
    if (activityText.textContent !== txt) activityText.textContent = txt;
    activityChip.classList.remove("hidden");
  } else {
    activityChip.classList.add("hidden");
  }
}
setInterval(updateActivity, 250);

/* ---------- 3. Зір ---------- */

const visionImg = $("visionImg");
const visionOverlay = $("visionOverlay");
const visionOverlayText = $("visionOverlayText");
const streamToggle = $("streamToggle");
const snapshotOut = $("snapshotOut");

let streaming = false;
let autoStream = true; // автозапуск потоку, коли Vision онлайн
let lastStreamErrorAt = 0;

function startStream() {
  streaming = true;
  visionImg.classList.remove("stream-off");
  // МJPEG напряму з сервісу Vision (порт 8000), НЕ через бекенд 8100
  visionImg.src = VISION_STREAM_URL + "?t=" + Date.now();
  visionOverlay.classList.add("hidden");
  streamToggle.textContent = "⏹ Зупинити";
}

function stopStream(reason) {
  streaming = false;
  visionImg.removeAttribute("src");
  visionImg.classList.add("stream-off");
  visionOverlay.classList.remove("hidden");
  visionOverlayText.textContent = reason || "Потік вимкнено";
  streamToggle.textContent = "▶ Потік";
}

visionImg.addEventListener("error", () => {
  if (!streaming) return;
  lastStreamErrorAt = Date.now();
  stopStream("Потік недоступний — Vision офлайн?");
});

streamToggle.addEventListener("click", () => {
  if (streaming) {
    autoStream = false; // користувач зупинив вручну — не перезапускаємо самі
    stopStream("Потік вимкнено");
  } else {
    autoStream = true;
    startStream();
  }
});

$("snapshotBtn").addEventListener("click", async () => {
  const btn = $("snapshotBtn");
  btn.disabled = true;
  try {
    const r = await api("/api/vision/snapshot");
    snapshotOut.textContent = JSON.stringify(r, null, 2);
    snapshotOut.classList.remove("hidden");
  } catch (err) {
    if (err.status === 503) {
      snapshotOut.textContent = "Vision офлайн: " + err.message;
      toast("Снапшот: сервіс Vision офлайн", "warn");
    } else {
      snapshotOut.textContent = "Помилка снапшота: " + err.message;
      toast("Снапшот: " + err.message);
    }
    snapshotOut.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 6. Статус (опитування кожні ~5 с) ---------- */

const MODE_NAMES = {
  omni: "Omni-роутер",
  openclaw: "OpenClaw",
  anthropic: "Anthropic API",
  chat2api: "Chat2API",
  demo: "Демо",
};

let backendWasOk = null; // null = ще не знаємо

function setStatusVal(id, on) {
  const el = $(id);
  if (on === null) {
    el.textContent = "—";
    el.className = "status-val";
  } else {
    el.textContent = on ? "● онлайн" : "○ офлайн";
    el.className = "status-val " + (on ? "on" : "off");
  }
}

function setBackendDot(ok) {
  const dot = $("backendDot");
  dot.className = "dot " + (ok === null ? "dot-unknown" : ok ? "dot-on" : "dot-off");
}

async function refreshStatus() {
  try {
    const s = await api("/api/status");
    setBackendDot(true);
    if (backendWasOk === false) {
      toast("З'єднання з бекендом відновлено", "ok");
      // Бекенд міг перезапуститись і скинути активну модель на типову —
      // пересинхронізуємо селектор із фактичним станом бекенду.
      initModelPicker();
    }
    backendWasOk = true;
    ensureModelPicker(); // самовідновлення селектора моделі, якщо він не завантажився

    setStatusVal("st-omni", !!s.omni);
    setStatusVal("st-openclaw", !!s.openclaw);
    setStatusVal("st-anthropic", !!s.anthropic);
    setStatusVal("st-chat2api", !!s.chat2api);
    setStatusVal("st-vision", !!s.vision);
    setStatusVal("st-display", !!s.display);

    const modeName = MODE_NAMES[s.mode] || s.mode || "—";
    $("st-mode").textContent = modeName;
    $("modeBadge").textContent = "МОЗОК: " + modeName.toUpperCase();

    // Автозапуск потоку зору, якщо Vision онлайн (не раніше ніж 10 с після збою)
    if (
      s.vision &&
      !streaming &&
      autoStream &&
      Date.now() - lastStreamErrorAt > 10000
    ) {
      startStream();
    }
    if (!s.vision && streaming) {
      stopStream("Vision офлайн");
    }
  } catch (err) {
    setBackendDot(false);
    if (backendWasOk === true) toast("Втрачено з'єднання з бекендом (8100)");
    backendWasOk = false;
    for (const id of ["st-omni", "st-openclaw", "st-anthropic", "st-chat2api", "st-vision", "st-display"]) {
      setStatusVal(id, null);
    }
    $("st-mode").textContent = "—";
    $("modeBadge").textContent = "МОЗОК: —";
  }
}

/* ---------- 5. Сервіси ---------- */

/* Обережний розбір стану сервісу: бекенд може віддати bool,
   рядок або об'єкт з полем running/status */
function parseServiceState(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    return ["running", "online", "true", "on", "started"].includes(v.toLowerCase());
  }
  if (typeof v === "object") {
    if (typeof v.running === "boolean") return v.running;
    if (typeof v.online === "boolean") return v.online;
    if (typeof v.status === "string") return parseServiceState(v.status);
    if (typeof v.state === "string") return parseServiceState(v.state);
  }
  return null;
}

function renderService(name, running) {
  const dot = $("svcDot-" + name);
  const state = $("svcState-" + name);
  dot.className =
    "dot " + (running === null ? "dot-unknown" : running ? "dot-on" : "dot-off");
  state.textContent =
    running === null ? "—" : running ? "запущено" : "зупинено";
}

async function refreshServices() {
  try {
    const data = await api("/api/services");
    const src = (data && data.services) || data || {};
    for (const name of ["vision", "display"]) {
      renderService(name, parseServiceState(src[name]));
    }
  } catch (err) {
    // Без toast-спаму — стан бекенда вже показує refreshStatus
    for (const name of ["vision", "display"]) renderService(name, null);
  }
}

document.querySelectorAll("[data-svc]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const name = btn.dataset.svc;
    const action = btn.dataset.action;
    btn.disabled = true;
    try {
      await api(`/api/services/${name}/${action}`, { method: "POST" });
      toast(
        (action === "start" ? "Запущено сервіс " : "Зупинено сервіс ") + name,
        "ok"
      );
      if (name === "vision" && action === "stop") stopStream("Vision зупинено");
      if (name === "vision" && action === "start") lastStreamErrorAt = 0;
    } catch (err) {
      toast(`Сервіс ${name} (${action}): ` + err.message);
    } finally {
      btn.disabled = false;
      // Даємо сервісу секунду на старт/зупинку, тоді оновлюємо стани
      setTimeout(() => {
        refreshServices();
        refreshStatus();
      }, 1000);
    }
  });
});


/* ---------- Консоль (логи бекенду: запити, мозок, помилки) ---------- */

const consoleLog = $("consoleLog");
const consoleAutoscroll = $("consoleAutoscroll");
const CONSOLE_MAX = 500;

function pad2(n) {
  return String(n).padStart(2, "0");
}
function fmtLogTime(t) {
  const d = new Date((t || 0) * 1000);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}
function shortLogName(name) {
  return (name || "").replace(/^virtual_bot\.?/, "") || "app";
}
function appendConsole(entry) {
  if (!consoleLog) return;
  const empty = consoleLog.querySelector(".console-empty");
  if (empty) empty.remove();
  const lvl = (entry.level || "INFO").toUpperCase();
  const line = document.createElement("div");
  line.className =
    "console-line" +
    (lvl === "WARNING" ? " warn" : lvl === "ERROR" || lvl === "CRITICAL" ? " error" : "");
  const time = document.createElement("span");
  time.className = "console-time";
  time.textContent = fmtLogTime(entry.t);
  const name = document.createElement("span");
  name.className = "console-name";
  name.textContent = shortLogName(entry.name);
  const msg = document.createElement("span");
  msg.className = "console-msg";
  msg.textContent = entry.msg || "";
  line.appendChild(time);
  line.appendChild(name);
  line.appendChild(msg);
  consoleLog.appendChild(line);
  while (consoleLog.children.length > CONSOLE_MAX) consoleLog.firstChild.remove();
  if (consoleAutoscroll && consoleAutoscroll.checked) {
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }
}
async function initConsole() {
  if (!consoleLog) return;
  try {
    const r = await api("/api/console");
    consoleLog.innerHTML = "";
    const logs = (r && r.logs) || [];
    if (logs.length === 0) {
      const e = document.createElement("div");
      e.className = "console-empty";
      e.textContent = "Поки тихо — тут зʼявляться запити, мозок, події та помилки…";
      consoleLog.appendChild(e);
    } else {
      for (const e of logs) appendConsole(e);
    }
  } catch (err) {
    /* бекенд ще не готовий — живі події SSE наповнять консоль */
  }
}
$("consoleClear")?.addEventListener("click", () => {
  if (consoleLog) consoleLog.innerHTML = "";
});

/* ---------- 6b. Голосовий режим ----------
   Окремий екран: тиснеш коло → говориш → показує транскрипцію → шле боту →
   показує відповідь і озвучує (живий голос MiMo). Кругообіг для розмови. */
(function voiceMode() {
  const overlay = $("voiceOverlay");
  const orb = $("voiceOrb");
  const orbIcon = $("voiceOrbIcon");
  const statusEl = $("voiceStatus");
  const convo = $("voiceConvo");
  const handsFree = $("voiceHandsFree");
  if (!overlay || !orb) return;

  let vState = "idle";      // idle | listening | thinking | speaking
  let vAudio = null;        // поточне живе аудіо (MiMo)
  let interimEl = null;     // елемент живої (проміжної) транскрипції

  // Запис голосу для Whisper-ASR (надійне розпізнавання української на сервері)
  let asrEnabled = true;    // /api/asr доступний? (перевіримо на старті)
  let mediaStream = null;   // потік мікрофона
  let mediaRec = null;      // MediaRecorder
  let recChunks = [];       // шматки аудіо
  let audioCtx = null, analyser = null, volRAF = 0;
  let spoke = false, silenceSince = 0, recStartAt = 0;
  const REC_MAX_MS = 15000;     // жорстка стеля запису
  const SILENCE_MS = 1500;      // стільки тиші ПІСЛЯ мовлення = кінець фрази
  const MIN_REC_MS = 600;       // мінімум запису перед авто-стопом
  const VOL_SPEAK = 0.012;      // поріг гучності «є голос» (нижчий — ловить звичайну мову)

  (async function initAsrMode() {
    try { const r = await api("/api/asr/status"); asrEnabled = !!(r && r.enabled); }
    catch (e) { asrEnabled = false; }
  })();

  // Вибір голосу краба (Piper multi-speaker): рендеримо кнопки, клік = застосувати + прослухати
  const picker = $("voicePicker");
  let currentVoice = null;
  (async function initVoicePicker() {
    if (!picker) return;
    let data;
    try { data = await api("/api/tts/status"); } catch (e) { return; }
    if (!data || !data.enabled || !Array.isArray(data.voices)) { picker.style.display = "none"; return; }
    currentVoice = data.selected;
    picker.innerHTML = "";
    for (const v of data.voices) {
      const btn = document.createElement("button");
      btn.className = "voice-pick" + (v.id === currentVoice ? " on" : "");
      btn.innerHTML = v.name + " <small>" + (v.hint || "") + "</small>";
      btn.addEventListener("click", async () => {
        currentVoice = v.id;
        picker.querySelectorAll(".voice-pick").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        try { await postJSON("/api/tts/voice", { speaker: v.id }); } catch (e) {}
        previewVoice(v.id, v.name);
      });
      picker.appendChild(btn);
    }
  })();

  // Регулятор швидкості озвучки (1× / 1.25× / 1.5× / 2×) — миттєво до відтворення
  const speedBox = $("voiceSpeed");
  if (speedBox) {
    speedBox.querySelectorAll("[data-rate]").forEach((btn) => {
      btn.addEventListener("click", () => {
        ttsRate = parseFloat(btn.dataset.rate) || 1;
        speedBox.querySelectorAll("[data-rate]").forEach((b) => b.classList.remove("on"));
        btn.classList.add("on");
        // застосувати до вже наявного відтворення одразу
        if (vAudio) applyRate(vAudio);
      });
    });
  }

  // Прослухати голос (короткий зразок) — не чіпає стрічку діалогу
  async function previewVoice(speaker, name) {
    stopAudio();
    try {
      const resp = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Привіт! Я Клод Бот. Тепер я говорю ось таким голосом.", speaker }),
      });
      if (!resp.ok) return;
      const url = URL.createObjectURL(await resp.blob());
      const audio = new Audio(url);
      applyRate(audio);
      vAudio = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (vAudio === audio) vAudio = null; };
      audio.play().catch(() => {});
    } catch (e) {}
  }

  function setState(s, text) {
    vState = s;
    orb.classList.remove("listening", "thinking", "speaking");
    if (s !== "idle") orb.classList.add(s);
    orbIcon.textContent = s === "listening" ? "🎤" : s === "thinking" ? "💭" : s === "speaking" ? "🔊" : "🎤";
    if (text != null) statusEl.textContent = text;
    // ведемо й обличчя краба (на випадок, якщо колись зробимо напівпрозорий оверлей)
    if (s === "listening") crab.setEmotion("listening");
    else if (s === "thinking") crab.setEmotion("searching");
    else if (s === "speaking") crab.setEmotion("speaking");
  }

  function addLine(who, text, cls) {
    const el = document.createElement("div");
    el.className = "voice-line " + (who === "you" ? "you" : "bot") + (cls ? " " + cls : "");
    const w = document.createElement("span");
    w.className = "vl-who";
    w.textContent = who === "you" ? "ТИ" : "КЛОД БОТ 🦀";
    el.appendChild(w);
    el.appendChild(document.createTextNode(text));
    convo.appendChild(el);
    convo.scrollTop = convo.scrollHeight;
    return el;
  }

  /* Озвучити текст живим голосом MiMo; повертає проміс, що резолвиться, коли договорив.
     Відкат на браузерний голос, якщо MiMo недоступний. */
  function speakLive(text, emotion) {
    return new Promise((resolve) => {
      if (!text) return resolve();
      const useBrowser = () => {
        if (!ttsOk) return resolve();
        try {
          speechSynthesis.cancel();
          const u = new SpeechSynthesisUtterance(text);
          u.lang = VOICE_LANG;
          if (ttsVoice) u.voice = ttsVoice;
          u.onend = resolve;
          u.onerror = resolve;
          speechSynthesis.speak(u);
        } catch (e) { resolve(); }
      };
      if (!mimoTts) return useBrowser();
      fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => { if (!r.ok) throw new Error("tts " + r.status); return r.blob(); })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          applyRate(audio);
          vAudio = audio;
          audio.onended = () => { URL.revokeObjectURL(url); if (vAudio === audio) vAudio = null; resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); useBrowser(); };
          audio.play().catch(() => useBrowser());
        })
        .catch(useBrowser);
    });
  }

  function stopAudio() {
    if (vAudio) { try { vAudio.pause(); } catch (e) {} vAudio = null; }
    if (ttsOk) { try { speechSynthesis.cancel(); } catch (e) {} }
  }

  /* Один хід: транскрипція вже показана → шлемо боту → відповідь + озвучка */
  async function sendToBot(text) {
    setState("thinking", "Клод Бот думає…");
    try {
      const r = await postJSON("/api/chat", { message: text });
      const reply = typeof r.reply === "string" && r.reply.trim() !== "" ? r.reply : "(порожня відповідь)";
      addLine("bot", reply);
      setState("speaking", "Клод Бот відповідає…");
      await speakLive(reply, r.emotion);
    } catch (err) {
      addLine("bot", "Помилка: " + err.message, "interim");
    } finally {
      setState("idle", handsFree.checked ? "Слухаю далі…" : "Натисни коло і говори…");
      if (handsFree.checked && overlay.classList.contains("hidden") === false) {
        setTimeout(() => startListening(), 500);
      }
    }
  }

  /* Живий індикатор гучності на колі + VAD (визначення кінця фрази) */
  function volumeLoop() {
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / buf.length); // 0..~1
    // масштаб кола за гучністю (видно, що мік чує)
    orb.style.transform = "scale(" + (1 + Math.min(rms * 1.8, 0.35)) + ")";
    const now = performance.now();
    if (rms > VOL_SPEAK) {
      if (!spoke) statusEl.textContent = "Чую тебе… говори";
      spoke = true; silenceSince = now;
    }
    // авто-стоп: після мовлення настала тиша (мін. запис минув), або перевищено стелю
    if ((spoke && now - recStartAt > MIN_REC_MS && now - silenceSince > SILENCE_MS)
        || now - recStartAt > REC_MAX_MS) {
      stopRecording();
      return;
    }
    volRAF = requestAnimationFrame(volumeLoop);
  }

  function cleanupRecording() {
    if (volRAF) { cancelAnimationFrame(volRAF); volRAF = 0; }
    orb.style.transform = "";
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; analyser = null; }
    if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
    mediaRec = null;
  }

  function stopRecording() {
    if (mediaRec && mediaRec.state !== "inactive") { try { mediaRec.stop(); } catch (e) {} }
  }

  /* Записати голос → відправити на Whisper (/api/asr) → показати текст → боту */
  async function startListening() {
    if (!window.isSecureContext) {
      setState("idle", "Голос працює лише на localhost або https. Відкрий http://127.0.0.1:8100");
      return;
    }
    if (vState === "listening") { stopRecording(); return; } // повторний клік = завершити фразу
    if (!asrEnabled || !window.MediaRecorder || !navigator.mediaDevices) {
      return startListeningBrowser(); // запасний шлях, якщо Whisper недоступний
    }
    stopAudio();
    setState("listening", "Дозволь мікрофон…");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setState("idle", "Немає дозволу на мікрофон. Натисни 🔒 біля адреси → Мікрофон → Дозволити.");
      return;
    }
    // аналізатор гучності
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") { try { await audioCtx.resume(); } catch (e) {} }
      const src = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
    } catch (e) { analyser = null; }

    recChunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
    try {
      mediaRec = mime ? new MediaRecorder(mediaStream, { mimeType: mime }) : new MediaRecorder(mediaStream);
    } catch (e) {
      cleanupRecording();
      setState("idle", "Запис не підтримується — спробуй Chrome");
      return;
    }
    const recMime = mime || "audio/webm";
    mediaRec.ondataavailable = (ev) => { if (ev.data && ev.data.size) recChunks.push(ev.data); };
    mediaRec.onstop = () => {
      cleanupRecording();
      const blob = new Blob(recChunks, { type: recMime });
      // ЗАВЖДИ шлемо на Whisper (не покладаємось на поріг гучності — хай ШІ вирішує).
      // Відхиляємо лише зовсім порожній запис (мік реально не дав аудіо).
      if (blob.size < 400) {
        setState("idle", "Запис порожній. Перевір: Chrome → 🔒 → Мікрофон, і що вибрано вбудований мік.");
        return;
      }
      transcribeAndSend(blob);
    };

    spoke = false; silenceSince = recStartAt = performance.now();
    // timeslice 200мс — деякі версії Chrome інакше не віддають дані до stop
    try { mediaRec.start(200); } catch (e) { cleanupRecording(); setState("idle", "Не вдалося почати запис"); return; }
    setState("listening", "Слухаю… говори, а коли договорив — тисни коло ще раз");
    volumeLoop();
  }

  /* Blob запису → Whisper на сервері → текст → показати «ТИ» → боту */
  async function transcribeAndSend(blob) {
    setState("thinking", "Розпізнаю…");
    const fd = new FormData();
    const ext = (blob.type || "").includes("ogg") ? "ogg" : "webm";
    fd.append("audio", blob, "voice." + ext);
    try {
      const resp = await fetch("/api/asr", { method: "POST", body: fd });
      if (!resp.ok) throw new Error("asr " + resp.status);
      const data = await resp.json();
      const text = (data.text || "").trim();
      if (!text) { setState("idle", "Не розібрав — натисни й спробуй ще"); return; }
      addLine("you", text);
      sendToBot(text);
    } catch (err) {
      setState("idle", "Помилка розпізнавання. Спробуй ще раз.");
    }
  }

  /* Запасний браузерний STT (лише якщо Whisper недоступний) */
  function startListeningBrowser() {
    if (!SR) { setState("idle", "Розпізнавання недоступне (потрібен Chrome)"); return; }
    stopAudio();
    const rec = new SR();
    rec.lang = VOICE_LANG; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onstart = () => setState("listening", "Слухаю… говори");
    rec.onresult = (ev) => {
      finalText = "";
      for (let i = 0; i < ev.results.length; i++) if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      const shown = Array.from(ev.results).map((r) => r[0].transcript).join(" ").trim();
      if (shown) { if (!interimEl) interimEl = addLine("you", shown, "interim"); else interimEl.childNodes[1].nodeValue = shown; }
    };
    rec.onerror = (ev) => setState("idle", ev.error === "not-allowed" ? "Дозволь мікрофон" : "Не почув — спробуй ще");
    rec.onend = () => {
      const t = finalText.trim();
      if (t) { if (interimEl) { interimEl.classList.remove("interim"); interimEl = null; } sendToBot(t); }
      else { if (interimEl) { interimEl.remove(); interimEl = null; } setState("idle", "Не почув голосу — спробуй ще"); }
    };
    try { rec.start(); } catch (e) { setState("idle", "Не вдалося почати"); }
  }

  orb.addEventListener("click", () => {
    if (vState === "speaking") { stopAudio(); setState("idle", "Натисни коло і говори…"); return; }
    if (vState === "thinking") return;
    startListening();
  });

  function open() {
    overlay.classList.remove("hidden");
    const canVoice = asrEnabled || SR;
    setState("idle", canVoice ? "Натисни коло і говори…" : "Голосовий ввід доступний лише у Chrome");
  }
  function close() {
    stopAudio();
    stopRecording();
    cleanupRecording();
    if (handsFree) handsFree.checked = false; // не слухати після закриття
    setState("idle");
    overlay.classList.add("hidden");
  }
  $("voiceModeBtn")?.addEventListener("click", open);
  $("voiceClose")?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) close();
  });
})();

/* ---------- 7. Живі події (SSE, /api/events) ---------- */

/* Емоція із зовнішньої події — та сама логіка, що після чату:
   скидає ручний «Тест емоції» та перезапускає авто-повернення в idle */
function applyExternalEmotion(emotion) {
  if (!emotion) return;
  $("emotionTest").value = "";
  crab.setEmotion(emotion);
  scheduleIdleReturn();
}

/* Бейдж подій зору у панелі «Зір» — м'яко зникає за кілька секунд */
const visionBadge = $("visionBadge");
let visionBadgeTimer = null;

function showVisionBadge(text) {
  visionBadge.textContent = text;
  visionBadge.classList.add("show");
  clearTimeout(visionBadgeTimer);
  visionBadgeTimer = setTimeout(() => visionBadge.classList.remove("show"), 4000);
}

/* Тиха службова крапка «Живі події» у статус-панелі */
function setEventsDot(ok) {
  $("eventsDot").className =
    "dot " + (ok === null ? "dot-unknown" : ok ? "dot-on" : "dot-off");
}

/* Один EventSource на сторінку: він сам перепідключається після збоїв,
   тому без власних retry-циклів і без toast-ів на onerror */
(function initEvents() {
  const es = new EventSource("/api/events");

  es.onopen = () => setEventsDot(true);
  es.onerror = () => setEventsDot(false);

  es.onmessage = (e) => {
    let ev;
    try {
      ev = JSON.parse(e.data);
    } catch (err) {
      return; // не-JSON у потоці — мовчки ігноруємо
    }
    if (!ev || typeof ev !== "object") return;

    if (ev.type === "log") {
      appendConsole(ev);
    } else if (ev.type === "emotion") {
      applyExternalEmotion(ev.emotion);
    } else if (ev.type === "say") {
      // Бот каже щось сам — бульбашка бота з позначкою «сам» + емоція
      const text =
        typeof ev.text === "string" && ev.text.trim() !== ""
          ? ev.text
          : "(порожня репліка)";
      addMessage("bot", text, false, true);
      applyExternalEmotion(ev.emotion);
    } else if (ev.type === "vision") {
      if (ev.event === "face_appeared") {
        const n = typeof ev.faces === "number" ? ev.faces : 1;
        showVisionBadge("👁 Бачу обличчя (" + n + ")");
      } else if (ev.event === "face_gone") {
        showVisionBadge("Нікого не бачу");
      } else if (ev.event === "motion") {
        showVisionBadge("Рух");
      }
    }
  };
})();

/* ---------- Майстер налаштування ---------- */

const wizardOverlay = $("wizardOverlay");
const WIZARD_STEPS = 6;
let wizardStep = 1;
let wizardMcpLoaded = false;
let wizardData = null;
// Обраний стан (картки/сегменти/тумблери)
const wzSel = { language: "uk", persona: "friendly" };

function openWizard() {
  wizardOverlay.classList.remove("hidden");
  showWizardStep(1);
}
function closeWizard() {
  wizardOverlay.classList.add("hidden");
}
function showWizardStep(n) {
  wizardStep = Math.max(1, Math.min(WIZARD_STEPS, n));
  document.querySelectorAll(".wizard-step").forEach((el) => {
    el.classList.toggle("hidden", Number(el.dataset.step) !== wizardStep);
  });
  // Рейка-степер: активний / пройдені
  document.querySelectorAll("#wizardStepper li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === wizardStep);
    li.classList.toggle("done", s < wizardStep);
  });
  $("wizardProgress").textContent = "Крок " + wizardStep + " / " + WIZARD_STEPS;
  $("wizardBack").style.visibility = wizardStep === 1 ? "hidden" : "visible";
  $("wizardNext").textContent = wizardStep === WIZARD_STEPS ? "Готово ✓" : "Далі →";
  if (wizardStep === 4) loadWizardMcp();
  if (wizardStep === 5) refreshWizardServices();
  if (wizardStep === 6) buildWizardSummary();
}
// Клік по кроку в рейці — перехід
document.querySelectorAll("#wizardStepper li").forEach((li) => {
  li.addEventListener("click", () => showWizardStep(Number(li.dataset.step)));
});

/* Рендер карток/сегментів/тумблерів вибору */
function renderCards(container, items, selectedId, onPick, opts) {
  opts = opts || {};
  container.innerHTML = "";
  for (const it of items) {
    const card = document.createElement("div");
    card.className = "wz-card" + (it.id === selectedId ? " sel" : "");
    card.dataset.id = it.id;
    if (it.icon) {
      const ico = document.createElement("span");
      ico.className = "wz-card-ico";
      ico.textContent = it.icon;
      card.appendChild(ico);
    }
    const body = document.createElement("div");
    body.className = "wz-card-body";
    const nm = document.createElement("div");
    nm.className = "wz-card-name";
    nm.textContent = it.label;
    body.appendChild(nm);
    if (it.hint) {
      const h = document.createElement("div");
      h.className = "wz-card-hint";
      h.textContent = it.hint;
      body.appendChild(h);
    }
    card.appendChild(body);
    card.addEventListener("click", () => {
      container.querySelectorAll(".wz-card").forEach((c) => c.classList.remove("sel"));
      card.classList.add("sel");
      onPick(it.id);
    });
    container.appendChild(card);
  }
}

function renderSegmented(container, items, selectedId, onPick) {
  container.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = it.id === selectedId ? "sel" : "";
    b.textContent = it.label;
    b.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      onPick(it.id);
    });
    container.appendChild(b);
  }
}

function fillSelect(sel, items, value) {
  sel.innerHTML = "";
  for (const it of items || []) {
    const o = document.createElement("option");
    o.value = it.id;
    o.textContent = it.label || it.id;
    sel.appendChild(o);
  }
  if (value) sel.value = value;
}

function setKeyState(el, on) {
  el.textContent = on ? "● задано" : "○ не задано";
  el.className = "wz-keystate " + (on ? "ok" : "no");
}

async function initSetup(autoOpenIfNew = true) {
  try {
    const r = await api("/api/setup");
    wizardData = r;
    const p = r.profile || {};
    $("wzName").value = p.name || "";
    // Мова та характер — картками
    wzSel.language = p.language || "uk";
    wzSel.persona = p.persona || "friendly";
    wzSel.reply_length = p.reply_length || "medium";
    renderCards($("wzLangCards"), r.languages, wzSel.language, (id) => { wzSel.language = id; });
    renderCards($("wzPersonaCards"), r.personas, wzSel.persona, (id) => { wzSel.persona = id; });
    renderSegmented($("wzLenSeg"), r.reply_lengths || [], wzSel.reply_length, (id) => { wzSel.reply_length = id; });
    $("wzEmoji").checked = p.use_emoji !== false;
    $("wzSpont").checked = p.spontaneous !== false;
    $("wzPersonaCustom").value = p.persona_custom || "";
    $("wzGreeting").value = p.greeting || "";
    fillSelect($("wzModel"), r.models, r.selected_model);
    const ks = r.keys_set || {};
    setKeyState($("wzOmniState"), !!ks.omni);
    setKeyState($("wzOcState"), !!ks.openclaw);
    if (autoOpenIfNew && !r.configured) openWizard();
  } catch (err) {
    /* бекенд ще не готовий — майстер можна відкрити кнопкою ⚙ */
  }
}

/* Крок 2: жива перевірка звʼязку (реальний запит до мозку) */
$("wzTestBtn")?.addEventListener("click", async () => {
  const res = $("wzTestResult");
  res.className = "wz-test-result pending";
  res.textContent = "перевіряю… (може зайняти ~40с через OpenClaw)";
  $("wzTestBtn").disabled = true;
  try {
    // спершу зберігаємо введені ключі (щоб тест був чесним)
    await saveWizardKeys();
    const model = $("wzModel").value;
    if (model) { try { await postJSON("/api/model", { model: model }); } catch (e) {} }
    const chat = await postJSON("/api/chat", { message: "Скажи коротко 'звʼязок працює'." });
    let mode = "?";
    try { mode = (await api("/api/status")).mode; } catch (e) {}
    res.className = "wz-test-result ok";
    res.textContent = "✓ мозок відповів (" + mode + "): " + (chat.reply || "").slice(0, 60);
  } catch (err) {
    res.className = "wz-test-result err";
    res.textContent = "✗ " + err.message;
  } finally {
    $("wzTestBtn").disabled = false;
  }
});

async function saveWizardKeys() {
  const body = {
    omni_key: $("wzOmniKey").value.trim(),
    openclaw_token: $("wzOcToken").value.trim(),
  };
  if (!body.omni_key && !body.openclaw_token) return;
  const r = await postJSON("/api/setup/keys", body);
  // очищаємо поля й оновлюємо стан
  $("wzOmniKey").value = ""; $("wzOcToken").value = "";
  const ks = r.keys_set || {};
  setKeyState($("wzOmniState"), !!ks.omni);
  setKeyState($("wzOcState"), !!ks.openclaw);
}

/* Крок 4: сервіси (запуск Vision/Display) */
async function refreshWizardServices() {
  try {
    const data = await api("/api/services");
    const src = (data && data.services) || data || {};
    for (const name of ["vision", "display"]) {
      const st = $("wzSvcState-" + name);
      const running = parseServiceState(src[name]);
      if (st) {
        st.textContent = running === null ? "" : running ? "● запущено" : "○ зупинено";
        st.className = "wz-mcp-state " + (running ? "ok" : "");
      }
    }
  } catch (e) { /* ігноруємо */ }
}
document.querySelectorAll("[data-wzsvc]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const name = btn.dataset.wzsvc;
    btn.disabled = true;
    const st = $("wzSvcState-" + name);
    if (st) { st.textContent = "запускаю…"; st.className = "wz-mcp-state pending"; }
    try {
      await api("/api/services/" + name + "/start", { method: "POST" });
      setTimeout(refreshWizardServices, 1200);
    } catch (err) {
      if (st) { st.textContent = "✗ " + err.message; st.className = "wz-mcp-state err"; }
    } finally {
      btn.disabled = false;
    }
  });
});

/* Крок 5: підсумок */
function labelOf(list, id) {
  const it = (list || []).find((x) => x.id === id);
  return it ? it.label : id;
}
function buildWizardSummary() {
  const ul = $("wzSummary");
  ul.innerHTML = "";
  const d = wizardData || {};
  const custom = $("wzPersonaCustom").value.trim();
  const modelLabel = ($("wzModel").selectedOptions[0] || {}).textContent || "";
  const rows = [
    ["Ім'я", $("wzName").value.trim() || "Клод Бот"],
    ["Мова", labelOf(d.languages, wzSel.language)],
    ["Характер", custom || labelOf(d.personas, wzSel.persona)],
    ["Довжина", labelOf(d.reply_lengths, wzSel.reply_length)],
    ["Емодзі", $("wzEmoji").checked ? "так" : "ні"],
    ["Спонтанні емоції", $("wzSpont").checked ? "так" : "ні"],
    ["Модель", modelLabel],
    ["Omni-ключ", $("wzOmniState").textContent],
    ["OpenClaw токен", $("wzOcState").textContent],
  ];
  for (const [k, v] of rows) {
    const li = document.createElement("li");
    const ks = document.createElement("span"); ks.className = "k"; ks.textContent = k;
    const vs = document.createElement("span"); vs.className = "v"; vs.textContent = v;
    li.appendChild(ks); li.appendChild(vs);
    ul.appendChild(li);
  }
}

const wzMcpEls = {}; // id -> {btn, state} для пресетів

async function loadWizardMcp() {
  if (wizardMcpLoaded) return;
  const list = $("wzMcpList");
  const presetsBox = $("wzPresets");
  try {
    const r = await api("/api/setup/suggestions");
    // Рекомендовані — вгорі
    const mcp = (r.mcp || []).slice().sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    list.innerHTML = "";
    for (const m of mcp) {
      const row = document.createElement("div");
      row.className = "wz-mcp" + (m.recommended ? " recommended" : "");
      const info = document.createElement("div");
      info.className = "wz-mcp-info";
      const name = document.createElement("div");
      name.className = "wz-mcp-name";
      name.textContent = m.name;
      if (m.recommended) {
        const rb = document.createElement("span");
        rb.className = "wz-badge rec";
        rb.textContent = "маст-хев";
        name.appendChild(rb);
      }
      if (m.needs_key) {
        const b = document.createElement("span");
        b.className = "wz-badge";
        b.textContent = "потрібен ключ";
        name.appendChild(b);
      }
      const desc = document.createElement("div");
      desc.className = "wz-mcp-desc";
      desc.textContent = m.desc;
      const note = document.createElement("div");
      note.className = "wz-mcp-note";
      note.textContent = m.note;
      const state = document.createElement("div");
      state.className = "wz-mcp-state";
      info.appendChild(name);
      info.appendChild(desc);
      info.appendChild(note);
      // Поля для ключів (якщо треба) — реально передаються при вмиканні
      const keyInputs = {};
      for (const envKey of m.env || []) {
        const inp = document.createElement("input");
        inp.type = "password";
        inp.className = "wz-mcp-key";
        inp.placeholder = envKey + " (ключ)";
        inp.autocomplete = "off";
        info.appendChild(inp);
        keyInputs[envKey] = inp;
      }
      info.appendChild(state);
      const btn = document.createElement("button");
      btn.className = "btn btn-small";
      btn.textContent = "Увімкнути";
      btn.addEventListener("click", () => enableMcp(m.id, btn, state));
      row.appendChild(info);
      row.appendChild(btn);
      list.appendChild(row);
      wzMcpEls[m.id] = { btn: btn, state: state, keyInputs: keyInputs };
    }
    // Пресети — набори в один клік
    presetsBox.innerHTML = "";
    for (const p of r.presets || []) {
      const pb = document.createElement("button");
      pb.className = "wz-preset";
      const pn = document.createElement("div");
      pn.className = "wz-preset-name";
      pn.textContent = "⚡ " + p.name;
      const pd = document.createElement("div");
      pd.className = "wz-preset-desc";
      pd.textContent = p.desc;
      pb.appendChild(pn);
      pb.appendChild(pd);
      pb.addEventListener("click", () => enablePreset(p, pb));
      presetsBox.appendChild(pb);
    }
    $("wzSkillsNote").textContent = r.skills_note || "";
    wizardMcpLoaded = true;
  } catch (err) {
    list.textContent = "Не вдалося завантажити пропозиції.";
  }
}

async function enablePreset(preset, pbtn) {
  pbtn.disabled = true;
  const original = pbtn.querySelector(".wz-preset-name").textContent;
  pbtn.querySelector(".wz-preset-name").textContent = "⏳ " + preset.name + "…";
  // Вмикаємо кожен MCP по черзі, оновлюючи його рядок (прогресивно)
  for (const id of preset.mcp) {
    const el = wzMcpEls[id];
    if (el && !el.btn.disabled) {
      await enableMcp(id, el.btn, el.state);
    }
  }
  pbtn.querySelector(".wz-preset-name").textContent = "✓ " + preset.name;
  toast("Пресет «" + preset.name + "» застосовано", "ok", 3000);
}

async function enableMcp(id, btn, state) {
  btn.disabled = true;
  state.className = "wz-mcp-state pending";
  state.textContent = "додаю в OpenClaw… (проба до 2 хв)";
  // збираємо введені ключі для цього MCP
  const env = {};
  const els = wzMcpEls[id];
  if (els && els.keyInputs) {
    for (const k in els.keyInputs) {
      const v = els.keyInputs[k].value.trim();
      if (v) env[k] = v;
    }
  }
  try {
    const r = await postJSON("/api/setup/mcp/enable", { id: id, env: env });
    if (r.ok) {
      state.className = "wz-mcp-state ok";
      state.textContent = "✓ додано в OpenClaw";
      btn.textContent = "Готово";
    } else {
      state.className = "wz-mcp-state err";
      state.textContent = "✗ " + (r.output || "не вдалося").slice(0, 180);
      btn.disabled = false;
    }
  } catch (err) {
    state.className = "wz-mcp-state err";
    state.textContent = "✗ " + err.message;
    btn.disabled = false;
  }
}

async function saveWizard() {
  const body = {
    name: $("wzName").value.trim(),
    language: wzSel.language,
    persona: wzSel.persona,
    persona_custom: $("wzPersonaCustom").value.trim(),
    greeting: $("wzGreeting").value.trim(),
    reply_length: wzSel.reply_length,
    use_emoji: $("wzEmoji").checked,
    spontaneous: $("wzSpont").checked,
  };
  try {
    try { await saveWizardKeys(); } catch (e) { /* ключі — best-effort */ }
    await postJSON("/api/setup", body);
    const model = $("wzModel").value;
    if (model) {
      try { await postJSON("/api/model", { model: model }); } catch (e) { /* модель — не критично */ }
    }
    toast("Налаштування збережено ✓", "ok", 3000);
    closeWizard();
    refreshStatus();
    initModelPicker();
  } catch (err) {
    toast("Збереження: " + err.message);
  }
}

$("setupBtn")?.addEventListener("click", openWizard);
$("wizardClose")?.addEventListener("click", closeWizard);
$("wizardBack")?.addEventListener("click", () => showWizardStep(wizardStep - 1));
$("wizardNext")?.addEventListener("click", () => {
  if (wizardStep < WIZARD_STEPS) showWizardStep(wizardStep + 1);
  else saveWizard();
});

/* ---------- Старт ---------- */

refreshStatus();
refreshServices();
refreshMemoryList();
initModelPicker();
initConsole();
initSetup();
setInterval(refreshStatus, STATUS_POLL_MS);
setInterval(refreshServices, STATUS_POLL_MS * 2);
