"use strict";

/* streaming-markdown: локальна копія у vendor/ (без CDN — Pi може бути без
   мережі). Парсер інкрементальний: дописує токени в DOM по чанках, а не
   переганяє щоразу весь текст. */
import * as smd from "./vendor/smd.min.js";
/* Піксельні цифри й іконки — своя графіка, спільна мова з крабом */
import { drawGlyphString, makeIcon, paintIcon, hasPixelIcon } from "./pixel-ui.js";
/* Розбір ключового слова — окремо і без DOM, щоб логіку можна було
   перевіряти напряму, не маючи мікрофона (див. wake.js) */
import { parseWake, findWake } from "./wake.js";
import { ReplyTurn } from "./reply.js";
/* Контурні іконки та їхні кольори — у icons.js */
import { makeSvgIcon, ICON_COLORS } from "./icons.js";
/* Дві мови інтерфейсу (uk/en) — словник і хелпери в i18n.js */
import { t, getLang, setLang, onLangChange, applyStatic, emotionLabels, fmtDate, LANGS } from "./i18n.js";

/* ============================================================
   Клод Бот — ЕКРАН ПРИСТРОЮ (/screen)

   Навігація зроблена за моделлю смартгодинника (Wear OS / Apple Watch),
   адаптованою під 320×240 і резистивний тач без фізичних кнопок:

     циферблат ──свайп ліворуч/праворуч──> карусель тайлів
         │                                   (тайл сам НЕ гортається)
         ├── свайп ВГОРУ  ──> шухляда застосунків
         ├── свайп ВНИЗ   ──> швидкі дії      (як quick settings)
         └── свайп ПРАВОРУЧ ──> назад (dismiss), з тайла 0 — нікуди

   Принципи тайлів (developer.android.com/design/ui/wear):
   один тайл — одна думка, дані з першого погляду, видно свіжість,
   одна головна дія. Через 20 с бездіяльності — повернення на циферблат,
   через 3 хв — «сон» (затемнення + сонний краб), як ambient mode.
   ============================================================ */

const $ = (id) => document.getElementById(id);

const STAGE_W = 320;
const DEFAULT_IDLE_HOME_MS = 20000;   // повернення на циферблат
const DEFAULT_IDLE_SLEEP_MS = 180000; // «сон» екрана
const SWIPE_MIN = 28;         // поріг жесту в пікселях сцени

const stage = $("stage");
const rail = $("rail");
// Every tile in the page, and the ones the carousel shows right now. The
// person picks which tiles appear and in what order (Settings → Screens),
// so `tiles` changes at runtime; look tiles up by data-tile, never by a
// fixed index.
const allTiles = Array.from(rail.querySelectorAll(".tile"));
let tiles = allTiles.slice();
function chatTile() {
  return Math.max(0, tiles.findIndex((el) => el.dataset.tile === "chat"));
}
const layerQuick = $("layerQuick");
const dimmer = $("dimmer");

let tileIndex = 0;
let layer = null;      // null | "apps" | "quick"
let asleep = false;
let bright = 100;      // яскравість 15..100 (повзунок у швидких діях)
let volume = 70;       // гучність голосу 0..100
let idleHomeMs = DEFAULT_IDLE_HOME_MS;
let idleSleepMs = DEFAULT_IDLE_SLEEP_MS;
let clockFormat = "24";
let showClockDate = true;
let reducedMotion = false;
let idleTimer = 0;
let sleepTimer = 0;
let sayAt = 0;         // коли бот сказав останню репліку
let statusAt = 0;      // коли востаннє оновлювався /api/status

/* ---------- Масштаб сцени ----------
   На справжньому 320×240 множник = 1 (пікселі один в один). На десктопі
   вписуємо у вікно, щоб можна було все перевірити без заліза. */

function fitStage() {
  const k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / 240);
  stage.style.transform = "translate(-50%, -50%) scale(" + k + ")";
}
window.addEventListener("resize", fitStage);
fitStage();

/* ---------- Краб ----------
   Той самий PixelCrab, що й у панелі: canvas, а не DOM-анімація. */

const crab = new PixelCrab($("crabCanvas"), $("faceLabel"), tiles[0], { scale: 8 });
window.crab = crab;

let emotionTimer = 0;
function setEmotion(emotion) {
  if (!emotion) return;
  crab.setEmotion(emotion);
  clearTimeout(emotionTimer);
  // Емоція не висить вічно: за 15 с бот повертається в «очікування»
  emotionTimer = setTimeout(() => crab.setEmotion(asleep ? "sleepy" : "idle"), 15000);
}

/* ---------- Навігація ---------- */

function renderDots() {
  const box = $("dots");
  box.innerHTML = "";
  for (let i = 0; i < tiles.length; i++) {
    const d = document.createElement("i");
    if (i === tileIndex) d.className = "on";
    box.appendChild(d);
  }
}

function goTile(i, wrapped) {
  tileIndex = Math.max(0, Math.min(tiles.length - 1, i));
  // Стрибок через усю стрічку (кінець → початок) робимо БЕЗ анімації:
  // інакше екран пролітає повз усі тайли, і це читається як збій, а не як
  // «по колу». Прибираємо перехід рівно на один кадр.
  if (wrapped) {
    rail.style.transition = "none";
    requestAnimationFrame(() => { rail.style.transition = ""; });
  }
  rail.style.transform = "translate3d(" + (-tileIndex * STAGE_W) + "px, 0, 0)";
  renderDots();
  // Дані підтягуємо лише для видимого тайла — на Pi це не дрібниця
  if (tiles[tileIndex].dataset.tile === "state") refreshStatus();
  if (tiles[tileIndex].dataset.tile === "weather") loadWeather(false);
}

/* ---------- «Матове скло» під шарами ----------
   Android малює шторку через backdrop-filter: blur() — розмиття рахується
   ЩОКАДРУ. У нас під шаром живий краб на canvas, тож фон змінюється
   постійно: на A53 це найдорожчий варіант із можливих, ще й одночасно з
   анімацією виїзду.

   Тому знімаємо фон ОДИН РАЗ у мить відкриття: зменшуємо краба до 48×36,
   розмиваємо на офскріні (там блюр дешевий саме через розмір) і кладемо
   як звичайну картинку. Виглядає як скло, коштує один малюнок, а не кадр. */

const frostCanvas = document.createElement("canvas");
frostCanvas.width = 48;
frostCanvas.height = 36;
const frostCtx = frostCanvas.getContext("2d");

function makeFrost() {
  const css = getComputedStyle(document.documentElement);
  frostCtx.fillStyle = css.getPropertyValue("--bg").trim() || "#16181a";
  frostCtx.fillRect(0, 0, frostCanvas.width, frostCanvas.height);
  // Кольорову пляму дає краб — решта тайла й так рівний фон
  // Краба беремо крупно й трохи насичено: він єдине джерело кольору на
  // цьому екрані (на телефоні цю роль грають шпалери), інакше «скло»
  // виходить рівно-сірим і ефекту не видно
  frostCtx.filter = "blur(3px) saturate(1.6) brightness(1.15)";
  try {
    frostCtx.drawImage($("crabCanvas"), -2, 2, 52, 32);
  } catch (e) { /* полотно ще не готове — лишиться рівний фон */ }
  frostCtx.filter = "none";
  return frostCanvas.toDataURL("image/png");
}

function applyFrost(el) {
  el.style.backgroundImage = "url(" + makeFrost() + ")";
}

function openLayer(name) {
  // Знімок робимо ДО показу шару, поки видно те, що маємо розмити
  if (name === "apps") { renderApps(); applyFrost(layerApps); }
  else if (name === "quick") applyFrost(layerQuick);
  layer = name;
  const appsIsOpen = name === "apps";
  layerApps.classList.toggle("open", appsIsOpen);
  layerApps.setAttribute("aria-hidden", String(!appsIsOpen));
  layerApps.toggleAttribute("inert", !appsIsOpen);
  layerQuick.classList.toggle("open", name === "quick");
  stage.classList.toggle("layered", !!name);
}

function goHome() {
  openLayer(null);
  closeApps();
  goTile(0);
}

/* Наступний/попередній ПО КОЛУ: з останнього вправо — на перший */
function goTileCyclic(step) {
  const last = tiles.length - 1;
  let next = tileIndex + step;
  let wrapped = false;
  if (next > last) { next = 0; wrapped = true; }
  else if (next < 0) { next = last; wrapped = true; }
  goTile(next, wrapped);
}

/* ---------- Which tiles, in what order ----------
   The carousel is the person's, not ours: they choose which screens it
   shows and in what order (Settings → Screens). The face is always first —
   it is home, where idle returns and where the conversation happens.
   Stored as {order, hidden} so a tile added in a later version shows up
   (at the end) instead of being silently hidden by an old saved list. */

const TILES_KEY = "botScreenTiles";
const HOME_TILE = "face";
// New tiles start hidden only if the person never saw them in the order:
// people who set up their carousel should not find it rearranged.
const DEFAULT_HIDDEN_TILES = [];

function tileLayout() {
  const ids = allTiles.map((el) => el.dataset.tile);
  let saved = null;
  try { saved = JSON.parse(readPref(TILES_KEY, "null")); } catch (e) { saved = null; }
  const order = [];
  const known = new Set(ids);
  for (const id of (saved && Array.isArray(saved.order) ? saved.order : [])) {
    if (known.has(id) && !order.includes(id)) order.push(id);
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const hidden = new Set(
    (saved && Array.isArray(saved.hidden) ? saved.hidden : DEFAULT_HIDDEN_TILES).filter((id) => known.has(id)),
  );
  hidden.delete(HOME_TILE);
  const home = order.indexOf(HOME_TILE);
  if (home > 0) { order.splice(home, 1); order.unshift(HOME_TILE); }
  return { order, hidden };
}

function saveTileLayout(layout) {
  writePref(TILES_KEY, JSON.stringify({ order: layout.order, hidden: Array.from(layout.hidden) }));
}

/* Rebuilds the carousel from the saved layout. Moving the DOM nodes (not
   cloning) keeps every listener and canvas inside the tiles alive. */
function applyTileLayout() {
  const current = tiles[tileIndex] ? tiles[tileIndex].dataset.tile : HOME_TILE;
  const layout = tileLayout();
  const byId = new Map(allTiles.map((el) => [el.dataset.tile, el]));
  tiles = [];
  for (const id of layout.order) {
    const el = byId.get(id);
    if (!el) continue;
    rail.appendChild(el);
    const off = layout.hidden.has(id);
    el.classList.toggle("tile-off", off);
    if (!off) tiles.push(el);
  }
  const back = tiles.findIndex((el) => el.dataset.tile === current);
  goTile(back === -1 ? 0 : back);
}

function moveTile(id, step) {
  const layout = tileLayout();
  const at = layout.order.indexOf(id);
  const to = at + step;
  // Nothing moves above home, and home itself does not move
  if (id === HOME_TILE || at < 0 || to < 1 || to >= layout.order.length) return;
  layout.order.splice(at, 1);
  layout.order.splice(to, 0, id);
  saveTileLayout(layout);
  applyTileLayout();
}

function setTileShown(id, shown) {
  if (id === HOME_TILE) return;
  const layout = tileLayout();
  if (shown) layout.hidden.delete(id);
  else layout.hidden.add(id);
  saveTileLayout(layout);
  applyTileLayout();
}

/* ---------- Бездіяльність: додому → сон ---------- */

function wake() {
  if (asleep) {
    asleep = false;
    crab.setEmotion("idle");
  }
  applyDim();
  clearTimeout(idleTimer);
  clearTimeout(sleepTimer);
  // Розмова — це теж «взаємодія»: не смикаємо екран на циферблат, поки
  // користувач пише або поки бот ще відповідає.
  if (chatBusy || listening) return;
  if (idleHomeMs > 0) idleTimer = setTimeout(goHome, idleHomeMs);
  if (idleSleepMs > 0) sleepTimer = setTimeout(sleep, idleSleepMs);
}

function sleep() {
  asleep = true;
  goHome();
  crab.setEmotion("sleepy");
  applyDim();
  syncQuickButtons();
}

function applyDim() {
  // Сон темніший за будь-яку яскравість; 100% = без затемнення взагалі
  const opacity = asleep ? 0.85 : (100 - bright) / 100 * 0.85;
  dimmer.style.opacity = String(opacity);
}

/* ---------- Жести ----------
   Pointer Events: один код для тача на Pi і для миші при перевірці.
   Координати ділимо на масштаб сцени, щоб поріг був однаковий і на
   справжньому екрані, і на розтягнутому десктопному прев'ю. */

let ptrStart = null;

function stageScale() {
  return stage.getBoundingClientRect().width / STAGE_W || 1;
}

function releaseStagePointer(pointerId) {
  if (pointerId == null || typeof stage.hasPointerCapture !== "function") return;
  try {
    if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId);
  } catch (e) {}
}

/* Повзунки й прокручувані області лишаємо їхнім власним жестам. Усе інше,
   включно з картками та кнопками, може бути початком свайпу: тап і далі
   обробляється самим контролом, а навігація спрацьовує лише після порогу. */
function isInteractive(el) {
  return !!(el && el.closest &&
    el.closest("input, textarea, select, .chat-log, .feed, .qs-slider, .face-photo, .say-text"));
}

stage.addEventListener("pointerdown", (e) => {
  if (ptrStart || isInteractive(e.target)) return;
  const onButton = !!e.target.closest?.("button");
  ptrStart = { x: e.clientX, y: e.clientY, t: Date.now(), pointerId: e.pointerId };
  if (!onButton) {
    try { stage.setPointerCapture(e.pointerId); } catch (e) {}
  }
});

function finishStagePointer(e) {
  const s = ptrStart;
  if (!s || s.pointerId !== e.pointerId) return;
  ptrStart = null;
  releaseStagePointer(s.pointerId);
  wake();

  const k = stageScale();
  const dx = (e.clientX - s.x) / k;
  const dy = (e.clientY - s.y) / k;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  // Не жест, а тап — хай його доопрацьовують кнопки (у них свої обробники)
  if (adx < SWIPE_MIN && ady < SWIPE_MIN) return;

  if (adx > ady) {
    if (layerApp.classList.contains("open")) { closeAppLayer(); return; }
    if (appsOpen()) { closeApps(); return; }
    if (layer) { openLayer(null); return; }      // горизонталь у шарі = назад
    goTileCyclic(dx < 0 ? 1 : -1);
  } else if (dy < 0) {
    // Свайп ВГОРУ: з каруселі — шухляда застосунків; зі шторки — назад
    if (layer === "quick") openLayer(null);
    else if (!layer) openLayer("apps");
  } else {
    // Свайп ВНИЗ: з каруселі — швидкі дії; із шухляди — назад
    if (layer === "apps") openLayer(null);
    else if (!layer) openLayer("quick");
  }
}

stage.addEventListener("pointerup", finishStagePointer);
function cancelStagePointer(e) {
  if (ptrStart?.pointerId !== e.pointerId) return;
  releaseStagePointer(ptrStart.pointerId);
  ptrStart = null;
}
stage.addEventListener("pointercancel", cancelStagePointer);
window.addEventListener("pointerup", finishStagePointer);
window.addEventListener("pointercancel", cancelStagePointer);
stage.addEventListener("lostpointercapture", (e) => {
  if (ptrStart?.pointerId === e.pointerId) ptrStart = null;
});

// Клавіші — лише для перевірки з десктопа, на Pi їх немає
window.addEventListener("keydown", (e) => {
  // У полі вводу стрілки — це курсор, а не навігація екраном
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  wake();
  if (e.key === "ArrowRight") goTileCyclic(1);
  else if (e.key === "ArrowLeft") goTileCyclic(-1);
  else if (e.key === "ArrowUp") openLayer(layer === "quick" ? null : "apps");
  else if (e.key === "ArrowDown") openLayer(layer === "apps" ? null : "quick");
  else if (e.key === "Escape") goHome();
});

/* ---------- Годинник ---------- */

function two(n) { return n < 10 ? "0" + n : String(n); }

const clockCanvas = $("clockCanvas");
const clockCtx = clockCanvas.getContext("2d");
const faceClockCtx = $("faceClockCanvas").getContext("2d");

function tickClock() {
  const d = new Date();
  const hours = clockFormat === "12" ? (d.getHours() % 12 || 12) : d.getHours();
  const hhmm = (clockFormat === "12" ? String(hours) : two(hours)) + ":" + two(d.getMinutes());
  // Той самий піксельний шрифт, лише дрібніший — щоб шапка циферблата
  // не була єдиним місцем із системним шрифтом
  drawGlyphString(faceClockCtx, hhmm, {
    body: crab.colors.shadow,
    skip: d.getSeconds() % 2 === 0 ? "" : ":",
  });
  // Двокрапка блимає щосекунди — «живий» годинник без зайвого малювання
  drawGlyphString(clockCtx, hhmm, {
    body: crab.colors.body,
    shadow: crab.colors.shadow,
    skip: d.getSeconds() % 2 === 0 ? "" : ":",
  });
  // Порядок «число — місяць — день тижня» у мовах різний — збирає i18n
  $("clockDate").textContent = showClockDate ? fmtDate(d) : "";
  updateAges();
}
tickClock();
setInterval(tickClock, 1000);

/* Скільки минуло — «щойно / 5 хв / 2 год» (свіжість даних видно завжди) */
function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return t("ago.now");
  if (s < 3600) return t("ago.min", { n: Math.floor(s / 60) });
  if (s < 86400) return t("ago.hour", { n: Math.floor(s / 3600) });
  return t("ago.day", { n: Math.floor(s / 86400) });
}

function updateAges() {
  $("sayAge").textContent = sayAt ? ago(sayAt) : "";
  $("stAge").textContent = statusAt ? t("ago.updated", { ago: ago(statusAt) }) : "";
}

/* ---------- Тайл «Стан» ---------- */

const BRAIN_LABELS = { openclaw: "OpenClaw", omni: "Omni", anthropic: "Anthropic", chat2api: "Chat2API" };
/* Назви мозків — власні імена й не перекладаються; «демо» — єдине слово */
function brainLabel(mode) {
  if (BRAIN_LABELS[mode]) return BRAIN_LABELS[mode];
  if (mode === "demo") return t("state.demo");
  if (mode === "offline") return t("state.nobrain");
  // «unknown» — справжньої відповіді ще не було. Пінг сюди не рахується:
  // порт може відповідати, а шлюз не вміти відповісти.
  if (mode === "unknown") return t("state.unknown");
  return mode;
}

function setState(el, on, text) {
  el.textContent = text;
  el.className = "v " + (on ? "on" : "off");
}

let statusBusy = false;
async function refreshStatus() {
  if (statusBusy) return;
  statusBusy = true;
  try {
    const r = await fetch("/api/status");
    if (!r.ok) throw new Error("status " + r.status);
    const s = await r.json();
    setState($("stBrain"), s.mode !== "demo" && s.mode !== "offline" && s.mode !== "unknown", brainLabel(s.mode) || "—");
    setState($("stVision"), !!s.vision, s.vision ? t("state.online") : t("state.offline"));
    setState($("stDisplay"), !!s.display, s.display ? t("state.online") : t("state.offline"));
    statusAt = Date.now();
  } catch (err) {
    setState($("stBrain"), false, t("state.noLink"));
    setState($("stVision"), false, "—");
    setState($("stDisplay"), false, "—");
  } finally {
    statusBusy = false;
    updateAges();
  }
}

$("stRefresh").addEventListener("click", refreshStatus);
refreshStatus();
// Тихе оновлення, лише поки тайл стану на екрані й ми не спимо
setInterval(() => {
  if (!asleep && !layer && tiles[tileIndex].dataset.tile === "state") refreshStatus();
}, 30000);

/* ---------- Живі події бота (той самий SSE, що й у панелі) ---------- */

let linkAlive = false;   // памʼятаємо стан: після зміни мови підпис треба перемалювати

function setLink(on) {
  linkAlive = !!on;
  $("linkDot").classList.toggle("on", linkAlive);
  setState($("stLink"), linkAlive, linkAlive ? t("state.alive") : t("common.none"));
}
setLink(false);

(function initEvents() {
  const es = new EventSource("/api/events");
  es.onopen = () => setLink(true);
  es.onerror = () => setLink(false);   // EventSource перепідключається сам

  es.onmessage = (e) => {
    let ev;
    try { ev = JSON.parse(e.data); } catch (err) { return; }
    if (!ev || typeof ev !== "object") return;

    if (ev.type === "screen") {
      // Мозок попросив показати екран (тул open_screen) — слухаємось
      showScreen(ev.screen);
      return;
    }
    if (ev.type === "music") {
      // Мозок увімкнув музику (тул play_music) або зупинив — Now Playing
      onMusicEvent(ev);
      return;
    }
    if (ev.type === "timer") {
      onTimerEvent(ev);
      return;
    }
    if (ev.type === "weather") {
      onWeatherEvent(ev);
      return;
    }
    if (ev.type === "video") {
      // Мозок керує ВІДЕО-плеєром (тули play_video / video_control):
      // застосунок youtube, картинка на весь екран
      onVideoCommand(ev);
      return;
    }
    if (ev.type === "emotion") {
      setEmotion(ev.emotion);
    } else if (ev.type === "reply") {
      // Відповідь у чаті (з панелі або з цього ж екрана): у тайл «Бот сказав»
      // і в стрічку — але БЕЗ пробудження, бо це відповідь на чиюсь дію,
      // а не сам бот подав голос.
      const text = typeof ev.text === "string" && ev.text.trim() ? ev.text.trim() : "";
      if (text) {
        showSaid(text);
        // The screen already spoke its own reply while it streamed
        // (sendChat → feedSpeech); this event only covers the others.
        if (text !== spokenReplyText.trim()) sayBubbles(replyBubbles(ev, text));
        else if (!speechWanted()) showCaption(text, "bot");
      }
      setEmotion(ev.emotion || "speaking");
    } else if (ev.type === "say") {
      const text = typeof ev.text === "string" && ev.text.trim() ? ev.text.trim() : t("say.noText");
      showSaid(text);
      showCaption(text, "bot");
      speak(text);
      setEmotion(ev.emotion || "speaking");
      // Бот заговорив — це варте пробудження екрана
      if (asleep) wake();
    } else if (ev.type === "vision") {
      // Зір лишається видимим на обличчі — коротким субтитром, без журналу
      if (ev.event === "face_appeared") showCaption(t("face.seeYou"), "bot");
      else if (ev.event === "face_gone") showCaption(t("face.seeNobody"), "bot");
    }
    // type "log" навмисно ігноруємо: технічні рядки — це для панелі, не для
    // екрана бота, інакше стрічка перетворюється на консоль.
  };
})();

/* ---------- Стиль іконок ----------
   Три набори на вибір, бо смак у цього різний, а екран один:
     pixel — кольорові 16×16 assets із Pxlkit у шухляді та наші glyphs
             для дрібних кнопок;
     line  — звичайні контурні, як у будь-якому телефоні;
     color — ті самі контурні, але кожна зі своїм відтінком.
   Вибір глобальний: інакше половина екрана лишалася б в іншому стилі. */

const ICON_KEY = "botScreenIcons";
const ICON_TINT_KEY = "botScreenIconTint";
const DEFAULT_ICON_TINT = "#d98263";
const ICON_TINTS = [
  { value: "#d98263", key: "tint.coral" },
  { value: "#7fa8d8", key: "tint.blue" },
  { value: "#79b07a", key: "tint.green" },
  { value: "#b48ad8", key: "tint.purple" },
  { value: "#d7a65b", key: "tint.gold" },
  { value: "#5fb0a8", key: "tint.teal" },
];
/* id стилю → ключ підпису: id зберігається у налаштуваннях, підпис залежить
   від мови, тому в константі лежить саме ключ, а не готовий текст */
/* auto — ПЕРШИЙ і типовий: на темній темі стандартні (наші піксельні), на
   світлій — монохромні. Фіксований білий тут не годиться в принципі: світла
   тема має тло #efe7d9, і білі іконки на ньому просто зникають. */
const ICON_STYLES = {
  auto: "iconstyle.auto",
  pixel: "iconstyle.pixel",
  pack: "iconstyle.pack",
  line: "iconstyle.line",
  color: "iconstyle.color",
  white: "iconstyle.white",
};
/* Монохром — це стиль, а не ще один відтінок у палітрі: у піксельному паку
   кольори вмальовані в самі файли (це різнобарвний піксель-арт), і
   «побілити» його можна лише filter'ом, який на A53 коштує кадрів і
   перетворює малюнок на білу пляму. Контур же просто малюється потрібним
   кольором — безкоштовно. */
const MONO_FALLBACK = "#f2f5f7";

/* Колір монохромних іконок беремо з --text ПОТОЧНОЇ теми, а не з константи.
   Тоді він сам стає білим на темній і темним на світлій — і, головне,
   переживає користувацькі скіни, які теж перевизначають --text. Хардкод
   двох значень довелося б правити щоразу, коли зʼявиться третя тема. */
function monoStroke() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--text").trim();
  return value || MONO_FALLBACK;
}

/* Що реально малюємо: auto розкривається за темою. Усі рендери питають
   САМЕ цю функцію, а `iconStyle` лишається тим, що вибрав користувач —
   інакше в налаштуваннях підсвічувався б «Піксельні» замість «Авто». */
function activeIconStyle() {
  if (iconStyle !== "auto") return iconStyle;
  return document.documentElement.dataset.theme === "light" ? "white" : "pixel";
}
const PIXEL_ICON_ASSETS = {
  face: "face.svg",
  clock: "clock.svg",
  mic: "say.svg",
  bubble: "chat.svg",
  gauge: "state.svg",
  sliders: "quick.svg",
  camera: "camera.svg",
  server: "services.svg",
  monitor: "panel.svg",
  settings: "settings.svg",
  memory: "memory.svg",
  history: "chats.svg",
  store: "store.svg",
  music: "music.svg",
  // Іконки застосунків із магазину. Без них у шухляді ці дві плитки падали
  // у векторний фолбек — серед піксельних сусідів вони єдині виглядали
  // «з іншого набору».
  pencil: "pencil.svg",
  youtube: "youtube.svg",
};
/* Іконки з паку Pixel: готові кольорові кружечки, витягнуті з APK і
   зменшені до 64px. Діють ТІЛЬКИ в шухляді: у швидких діях іконка
   малюється 20px, і повноколірний логотип там перетворюється на кляксу,
   а на «плюс», «список» чи «контраст» у паку картинок і немає. Тому за
   межами шухляди цей стиль поводиться як контурний. */
const PACK_ICON_SLOTS = [
  "face", "clock", "mic", "bubble", "gauge", "sliders", "camera", "server",
  "monitor", "settings", "memory", "history", "store", "music", "pencil",
  "youtube",
];

const PIXEL_ICON_TINTS = {
  face: "#4ecdc4",
  clock: "#5b9bd5",
  mic: "#e74c3c",
  bubble: "#7ec8e3",
  gauge: "#3b82f6",
  sliders: "#5b9bd5",
  camera: "#00cc6a",
  server: "#889099",
  monitor: "#5b9bd5",
  settings: "#5b9bd5",
  memory: "#d7a65b",
  history: "#5b9bd5",
  store: "#d7a65b",
  music: "#d98263",
};
let iconStyle = "auto";
let iconTint = DEFAULT_ICON_TINT;

/* Створює іконку в поточному стилі. big — велика сітка для шухляди. */
function uiIcon(name, opts) {
  const o = opts || {};
  if (activeIconStyle() === "pixel") {
    return makeIcon(name, o.cell || 3, o.tint || iconColors(!!o.on)[0], "", !!o.big);
  }
  const svg = makeSvgIcon(name);
  if (o.big) svg.classList.add("svgicon-big");
  svg.style.stroke = strokeFor(name);
  svg.dataset.colored = activeIconStyle() === "color" ? "1" : "";
  return svg;
}

/* Великі іконки шухляди беруться з локального pixel-паку, коли обрано
   піксельний стиль. Для двох інших стилів лишається векторний renderer. */
function drawerIcon(name, on) {
  if (activeIconStyle() === "pack" && PACK_ICON_SLOTS.includes(name)) {
    const image = document.createElement("img");
    image.className = "pack-icon";
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.decoding = "async";
    image.draggable = false;
    image.src = "/static/screen/assets/pack-icons/" + name + ".png";
    // Немає файлу — падаємо на контурну, а не лишаємо порожнє коло
    image.addEventListener("error", () => {
      const svg = makeSvgIcon(name);
      svg.classList.add("svgicon-big");
      svg.style.stroke = iconTint;
      image.replaceWith(svg);
    }, { once: true });
    return image;
  }
  if (activeIconStyle() === "pixel" && (PIXEL_ICON_ASSETS[name] || hasPixelIcon(name) || name === "server")) {
    const asset = PIXEL_ICON_ASSETS[name];
    const fallback = () => {
      const fallbackName = name === "server" ? "gear" : name;
      const icon = makeIcon(
        fallbackName,
        3,
        on ? iconColors(true)[0] : (PIXEL_ICON_TINTS[name] || iconTint),
        "",
        true,
      );
      icon.setAttribute("aria-hidden", "true");
      return icon;
    };
    if (!asset) return fallback();

    const image = document.createElement("img");
    image.className = "pixel-pack-icon";
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    image.decoding = "async";
    image.draggable = false;
    image.src = "/static/screen/assets/pixel-icons/" + asset;
    image.addEventListener("error", () => {
      image.replaceWith(fallback());
    }, { once: true });
    return image;
  }
  const svg = makeSvgIcon(name);
  svg.classList.add("svgicon-big");
  svg.style.stroke = strokeFor(name);
  return svg;
}

/* Колір контуру для поточного стилю. Один хелпер на всі місця, де раніше
   стояв той самий тернарник: інакше додавання стилю треба було б не забути
   в трьох файлах-місцях, і одне з них щоразу лишалось старим. */
function strokeFor(name) {
  const style = activeIconStyle();
  if (style === "white") return monoStroke();
  if (style === "pack") return iconTint;
  if (style === "color") return ICON_COLORS[name] || iconTint;
  return iconTint;
}

/* Фон круглої плитки в шухляді: у кольоровому стилі — у тон іконці */
function iconTileBg(name) {
  if (activeIconStyle() !== "color") return "";
  const c = ICON_COLORS[name];
  return c ? "color-mix(in srgb, " + c + " 26%, var(--line))" : "";
}

const iconSheet = () => $("iconSheet");

function openIconSheet() {
  const sheet = iconSheet();
  if (!sheet) return;
  sheet.querySelectorAll(".mode-row").forEach((row) => {
    row.classList.toggle("on", row.dataset.icons === iconStyle);
  });
  sheet.classList.remove("hidden");
  wake();
}

function setIconStyle(style) {
  if (!ICON_STYLES[style]) return;
  iconStyle = style;
  writePref(ICON_KEY, style);
  rebuildIcons();
}

function setIconTint(color) {
  if (!ICON_TINTS.some((item) => item.value === color)) return;
  iconTint = color;
  writePref(ICON_TINT_KEY, color);
  rebuildIcons();
}

function removePref(key) {
  try { localStorage.removeItem(key); } catch (e) { /* приватний режим */ }
}

/* Іконки, створені один раз (повзунки, олівець, мікрофон, шапка чату),
   самі себе не перемалюють — після зміни стилю збираємо їх наново. */
function rebuildIcons() {
  const slots = [
    ["brightIco", "sun", 3], ["volIco", "speaker", 3], ["quickEdit", "pencil", 2],
    ["micIco", "mic", 3], ["faceMicIco", "mic", 2],
    ["sessionsIco", "list", 2], ["chatNewIco", "plus", 2],
    ["npProvYoutubeIco", "youtube", 2], ["npProvRadioIco", "radio", 2],
  ];
  for (const [id, name, cell] of slots) {
    const host = $(id);
    if (!host) continue;
    const old = host.querySelector(".pxicon, .svgicon");
    if (old) old.remove();
    host.appendChild(uiIcon(name, { cell: cell, on: id === "micIco" || id === "faceMicIco" }));
  }
  renderQuickTiles();
  if (typeof renderApps === "function" && appsOpen()) renderApps();
  document.querySelectorAll("#iconSheet .mode-row").forEach((row) => {
    row.classList.toggle("on", row.dataset.icons === iconStyle);
  });
}

/* ---------- Швидкі дії: шторка як на телефоні ----------
   Дрібні плитки + два повзунки. Обидва повзунки керують РЕАЛЬНИМИ речами:
   яскравість — затемненням екрана, гучність — гучністю голосу Piper, яким
   бот озвучує свої репліки. Порядок плиток користувач переставляє сам. */

const THEME_KEY = "botScreenTheme";
const BRIGHT_KEY = "botScreenBright";
const VOL_KEY = "botScreenVol";
const VOICE_KEY = "botScreenVoice";
const SPEED_KEY = "botScreenVoiceSpeed";
const ORDER_KEY = "botScreenQuickOrder";
const IDLE_HOME_KEY = "botScreenIdleHome";
const IDLE_SLEEP_KEY = "botScreenIdleSleep";
const CLOCK_FORMAT_KEY = "botScreenClockFormat";
const CLOCK_DATE_KEY = "botScreenClockDate";
const MOTION_KEY = "botScreenMotion";

/* Варіанти тримають ключ, а не готовий підпис: список перемальовується при
   зміні мови, а value лишається тим самим — його читає validOption і prefs */
const IDLE_HOME_OPTIONS = [
  { value: "10000", key: "opt.sec", n: 10 },
  { value: "20000", key: "opt.sec", n: 20 },
  { value: "40000", key: "opt.sec", n: 40 },
  { value: "0", key: "opt.noHome" },
];
const IDLE_SLEEP_OPTIONS = [
  { value: "60000", key: "opt.min1" },
  { value: "180000", key: "opt.min3" },
  { value: "300000", key: "opt.min5" },
  { value: "0", key: "opt.noSleep" },
];
const CLOCK_FORMAT_OPTIONS = [
  { value: "24", key: "opt.h24" },
  { value: "12", key: "opt.h12" },
];

let voiceOn = false;
// Темп голосу. Piper типово говорить неквапно — для короткої репліки це добре,
// для абзацу вже втомлює, тому 1.5× і 2× виведені в швидкі дії.
// Темпи залежать від ПРОВАЙДЕРА: у Piper це 1/1.5/2× (--length-scale), а
// ElevenLabs вище 1.2× не дає взагалі. Тому список приходить із
// /api/tts/status, а тут лишається лише розумний дефолт до першої відповіді.
let VOICE_SPEEDS = [1, 1.5, 2];
let voiceSpeed = 1;
let ttsAvailable = false;
let editing = false;
let picked = null;      // id плитки, обраної першою в режимі перестановки

const quickGrid = $("quickGrid");
const brightRange = $("brightRange");
const volRange = $("volRange");

/* Плитки: id → що це і що робить. Порядок за замовчуванням — цей масив. */
const QUICK_TILES = {
  sleep:  { labelKey: "quick.sleep", icon: "moon", toggle: () => (asleep ? wake() : sleep()), isOn: () => asleep },
  theme:  { labelKey: "quick.theme", icon: "contrast", toggle: toggleTheme, isOn: () => document.documentElement.dataset.theme === "light" },
  voice:  { labelKey: "quick.voice", icon: "speaker", toggle: toggleVoice, isOn: () => voiceOn, enabled: () => ttsAvailable },
  // Підпис динамічний («1.5×»): на 320×240 саме значення інформативніше за
  // слово «Швидкість», яке однаково не влазить повністю.
  speed:  { labelKey: "quick.speed", icon: "speaker", label: () => fmtSpeed(voiceSpeed),
            toggle: cycleVoiceSpeed, isOn: () => voiceSpeed > 1,
            enabled: () => ttsAvailable && voiceOn },
  apps:   { labelKey: "quick.screens", icon: "grid", toggle: () => { openLayer(null); openApps(); }, isOn: () => false },
  icons:  { labelKey: "quick.settings", icon: "settings", toggle: () => { openLayer(null); openSettings(); }, isOn: () => false },
  // Чат живе в тайлі 4, але керувати ним хочеться з будь-якого місця —
  // особливо коли говориш «в обличчя» на циферблаті.
  chatNew: { labelKey: "quick.chatNew", icon: "plus",
             toggle: () => { openLayer(null); startNewChat(); }, isOn: () => false },
  chatPick: { labelKey: "quick.chatPick", icon: "list",
              toggle: () => { openLayer(null); goTile(chatTile()); showSessions(); }, isOn: () => false },
  full:   { labelKey: "quick.full", icon: "expand", toggle: toggleFullscreen, isOn: () => !!document.fullscreenElement },
  reload: { labelKey: "quick.reload", icon: "power", toggle: () => location.reload(), isOn: () => false },
};
const DEFAULT_ORDER = Object.keys(QUICK_TILES);
let quickOrder = DEFAULT_ORDER.slice();

function readPref(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* приватний режим */ }
}

function validOption(value, options, fallback) {
  const normalized = String(value);
  return options.some((item) => item.value === normalized) ? normalized : String(fallback);
}

function applyMotion(value) {
  reducedMotion = value === "reduced";
  document.documentElement.dataset.motion = reducedMotion ? "reduced" : "full";
}

/* ---- Голос: Piper через /api/tts, гучність — цим самим повзунком ---- */

const voiceAudio = new Audio();
let voiceUrl = null;

/* ---------- Черга озвучки ----------
   Раніше бот читав ГОТОВУ відповідь: поки мозок домовляв останнє речення,
   екран молчав — на довгій відповіді це десятки секунд тиші, хоча перше
   речення вже стояло на екрані. Тепер речення йдуть в озвучку по мірі
   стріму, а черга тримає порядок: другий шматок не обриває перший.

   Синтез наступного шматка стартує ПАРАЛЕЛЬНО з озвучкою цього — інакше
   між реченнями чути паузу рівно на мережеву затримку TTS. */

// ~30-50 токенів: коротше різати немає сенсу, бо перше речення ще не склалось
const SPEAK_MIN_CHARS = 90;
// Текст без жодного розділового знака все одно віддаємо в озвучку: краще
// прочитати довгий рядок, ніж чекати кінця «стіни» молча.
const SPEAK_MAX_CHARS = 700;

let speechQueue = [];
let speechRunning = false;
let speechEpoch = 0;              // нова репліка ⇒ хвіст попередньої не грає
let speechEnded = null;           // resolve поточного playBlob
let spokenReplyText = "";         // що вже озвучив сам екран (щоб не читати двічі)

function speechAudioDone() {
  const resolve = speechEnded;
  speechEnded = null;
  if (resolve) resolve();
}
voiceAudio.addEventListener("ended", speechAudioDone);
voiceAudio.addEventListener("error", speechAudioDone);

/* Скидає озвучку: нова репліка не має догравати хвіст попередньої */
function speechReset() {
  speechEpoch += 1;
  speechQueue = [];
  try { voiceAudio.pause(); } catch (e) { /* ще нічого не грало */ }
  speechAudioDone();
  botSpeaking = false;
  musicDucked = false;
  syncMusicVolume();
}

async function ttsBlob(text) {
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Стеля — 1000 символів (стільки бере бекенд), ріжемо по межі речення:
      // обірване на півслові звучить як збій.
      body: JSON.stringify({ text: cutForSpeech(text, 1000), speed: voiceSpeed }),
    });
    if (!r.ok) return null;                  // 503 — голос просто мовчить
    return await r.blob();
  } catch (e) {
    return null;                             // мережа моргнула — наступний шматок спробує
  }
}

function playBlob(blob) {
  return new Promise((resolve) => {
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    voiceUrl = URL.createObjectURL(blob);
    speechEnded = resolve;
    voiceAudio.src = voiceUrl;
    voiceAudio.volume = volume / 100;
    voiceAudio.play().catch(() => speechAudioDone());
  });
}

async function speechPump() {
  if (speechRunning) return;
  speechRunning = true;
  const epoch = speechEpoch;
  // Поки бот говорить — музика притихає, щоб було чутно мову
  musicDucked = true;
  syncMusicVolume();
  // Прапорець ставимо ДО play(): у відкритому мікрофоні бот інакше почує
  // власну озвучку й почне відповідати сам собі
  botSpeaking = true;
  captionSpeechStarted();
  try {
    // Each queue item is {text, onStart}. The next item is synthesised while
    // this one plays; onStart fires when its audio actually begins, which is
    // what lets the caption follow the voice one message at a time.
    let ready = null;                        // {item, audio} already synthesised
    while (epoch === speechEpoch && (ready || speechQueue.length)) {
      let current = ready;
      if (!current) {
        const item = speechQueue.shift();
        current = { item, audio: await ttsBlob(item.text) };
      }
      ready = null;
      if (epoch !== speechEpoch) break;
      let ahead = null;
      if (speechQueue.length) {
        const next = speechQueue.shift();
        ahead = ttsBlob(next.text).then((audio) => ({ item: next, audio }));
      }
      if (typeof current.item.onStart === "function") {
        try { current.item.onStart(); } catch (e) { /* a caption must not stop the voice */ }
      }
      if (current.audio) await playBlob(current.audio);
      if (ahead) ready = await ahead;
    }
  } finally {
    speechRunning = false;
    if (epoch === speechEpoch) {
      botSpeaking = false;
      musicDucked = false;
      syncMusicVolume();
      captionSpeechEnded();
      startFollowUp();
    }
  }
}

/* Queues a piece of text for speech without cutting what is playing.
   onStart runs when this piece starts to sound. */
function speechSay(raw, onStart) {
  // Image markup is never read aloud, or it would dictate "exclamation
  // mark bracket h-t-t-p-s…" instead of the reply. Links and the rest of
  // the markdown are stripped by the backend (tts_text.clean_for_speech).
  const text = splitImages(String(raw || "")).text;
  if (!speechWanted() || !text.trim()) return false;
  speechQueue.push({ text, onStart });
  speechPump();
  return true;
}

/* Whether replies are spoken at all right now */
function speechWanted() {
  return voiceOn && ttsAvailable;
}

/* Де закінчується останнє ЦІЛЕ речення: читати з півслова гірше, ніж
   зачекати ще пів секунди стріму. */
function speechCutIndex(text) {
  let best = -1;
  for (const mark of [".", "!", "?", "…", ";", ":", "\n"]) {
    best = Math.max(best, text.lastIndexOf(mark));
  }
  return best;
}

/* ---- Ядро Now Playing: оголошення вгорі файлу, бо гучність (applyVolume)
   і ducking під час мови бота потрібні ДО відкриття будь-якого тайла.
   Повний плеєр (шіт, списки, перемотка) — унизу, поруч із магазином. ---- */

const musicAudio = new Audio();
musicAudio.preload = "none";
// Налагодження з консолі/тестів: новий Audio() не потрапляє в DOM
window.musicAudio = musicAudio;

const PROVIDER_KEY = "botScreenMusicProvider";
const PROVIDERS = {
  youtube: { label: "YouTube", icon: "youtube" },   // власна назва, не перекладається
  radio: { labelKey: "music.radio", icon: "radio" },
};

const musicState = {
  provider: "youtube",
  track: null,          // {provider, id, title, uploader, duration, url?}
  queue: [],            // черга для prev/next (тільки youtube)
  playing: false,
  live: false,          // радіо: без перемотки й тривалості
  seeking: false,       // палець на повзунку — не смикаємо значення
};

let musicDucked = false;

/* ---------- Швидкість відтворення (ютуб/подкасти) ----------
   playbackRate міняє темп, не висоту: preservesPitch тримає тембр, інакше
   на 2× ведучий звучить бурундуком. Для радіо це не діє — живий потік. */
const RATE_KEY = "botScreenMusicRate";
const MUSIC_RATES = [1, 1.25, 1.5, 1.75, 2];
let musicRate = 1;

function applyMusicRate() {
  const live = !!(musicState && musicState.live);
  const rate = live ? 1 : musicRate;
  try {
    musicAudio.preservesPitch = true;
    musicAudio.mozPreservesPitch = true;
    musicAudio.webkitPreservesPitch = true;
    musicAudio.playbackRate = rate;
  } catch (e) { /* браузер без playbackRate — просто грає як грає */ }
}

function setMusicRate(rate) {
  if (!MUSIC_RATES.includes(rate)) return;
  musicRate = rate;
  writePref(RATE_KEY, String(rate));
  applyMusicRate();
  renderNpRates();
}

/* «1.25×», а не «1.3×»: fmtSpeed округлює до десятих (для темпу озвучки
   1/1.5/2 це байдуже), а тут чверті — саме те, чим користуються. */
function fmtRate(v) {
  return String(v) + "\u00d7";
}

function renderNpRates() {
  const host = $("npRates");
  if (!host) return;
  const live = !!(musicState && musicState.live);
  host.innerHTML = "";
  for (const rate of MUSIC_RATES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "np-rate" + (!live && rate === musicRate ? " on" : "");
    btn.textContent = fmtRate(rate);
    btn.disabled = live || !musicState.track;
    btn.addEventListener("click", (e) => { e.stopPropagation(); wake(); setMusicRate(rate); });
    host.appendChild(btn);
  }
}

function syncMusicVolume() {
  // Той самий повзунок гучності, що й у голосу бота; ducking — тимчасово
  const base = volume / 100;
  musicAudio.volume = musicDucked ? Math.max(0.05, base * 0.25) : base;
}

async function checkTts() {
  try {
    const r = await fetch("/api/tts/status");
    const d = await r.json();
    ttsAvailable = !!d.enabled;
    if (Array.isArray(d.speeds) && d.speeds.length) {
      VOICE_SPEEDS = d.speeds.map(Number).filter((v) => v > 0);
      // Збережений темп може бути з іншого провайдера (1.5× у ElevenLabs
      // немає) — тоді беремо перший доступний, а не мовчимо про підміну
      if (!VOICE_SPEEDS.includes(voiceSpeed)) {
        voiceSpeed = VOICE_SPEEDS[0];
        writePref(SPEED_KEY, voiceSpeed);
        renderQuickTiles();
      }
    }
  } catch (e) {
    ttsAvailable = false;
  }
  if (!ttsAvailable) {
    voiceOn = false;
    volRange.disabled = true;
    $("volVal").textContent = t("common.none");
  }
  renderQuickTiles();
}

/* Обрізає текст для озвучки по межі речення: краще недоказати фразу, ніж
   обірвати її посеред слова — на слух друге читається як поломка. */
function cutForSpeech(text, limit) {
  if (text.length <= limit) return text;
  const head = text.slice(0, limit);
  const end = Math.max(head.lastIndexOf("."), head.lastIndexOf("!"),
                       head.lastIndexOf("?"), head.lastIndexOf("…"));
  // Занадто ранню крапку ігноруємо: інакше репліка з абревіатурою на початку
  // озвучилась би одним словом.
  return end > limit * 0.5 ? head.slice(0, end + 1) : head;
}

/* A finished reply in one piece: drop the tail of the previous one, read this */
function speak(raw) {
  speechReset();
  speechSay(raw);
}

/* Messages of a `reply` event. Older backends send only the joined text. */
function replyBubbles(ev, text) {
  const list = Array.isArray(ev.bubbles) ? ev.bubbles.map((b) => String(b || "").trim()).filter(Boolean) : [];
  return list.length ? list : [text];
}

/* A finished multi-message reply: spoken one message at a time with the
   caption switching as each one starts; shown whole when nobody listens. */
function sayBubbles(bubbles) {
  speechReset();
  if (!speechWanted()) {
    showCaption(bubbles.join("\n\n"), "bot");
    return;
  }
  showCaption(bubbles[0], "bot");
  bubbles.forEach((text, i) => {
    speechSay(text, i ? () => showCaption(text, "bot") : null);
  });
}

/* «1.5×» без зайвого нуля: 1× / 1.5× / 2× */
function fmtSpeed(v) {
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + "\u00d7";
}

function cycleVoiceSpeed() {
  if (!ttsAvailable || !voiceOn) return;
  const i = VOICE_SPEEDS.indexOf(voiceSpeed);
  voiceSpeed = VOICE_SPEEDS[(i + 1) % VOICE_SPEEDS.length];
  writePref(SPEED_KEY, voiceSpeed);
  // Уже озвучена репліка лишається у старому темпі — наступна піде в новому.
  // Перезапитувати аудіо на льоту не варто: це зайвий синтез заради півсекунди.
}

function toggleVoice() {
  if (!ttsAvailable) return;
  voiceOn = !voiceOn;
  writePref(VOICE_KEY, voiceOn ? "1" : "0");
  if (!voiceOn) voiceAudio.pause();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  writePref(THEME_KEY, next);
  applyTheme();
}

/* Одна точка на всі місця, де міняється тема (шторка, налаштування, старт).
   repaintPixels перемальовує лише піксельні КАНВИ; контурні іконки — це svg
   зі stroke, вписаним у стиль елемента, і самі вони не змінюються. Без
   rebuildIcons монохром лишався білим на світлій темі, тобто зникав. */
function applyTheme() {
  repaintPixels();
  rebuildIcons();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* ---- Перемальовування піксельної графіки під поточну тему ---- */

function iconColors(on) {
  const css = getComputedStyle(document.documentElement);
  const accent = iconTint || css.getPropertyValue("--accent").trim() || "#d17a58";
  const muted = css.getPropertyValue("--muted").trim() || "#8e9498";
  return on ? [accent, ""] : [muted, ""];
}

function repaintPixels() {
  document.querySelectorAll(".qs-tile").forEach((btn) => {
    const canvas = btn.querySelector(".pxicon");
    const def = QUICK_TILES[btn.dataset.id];
    if (canvas && def) paintIcon(canvas, iconColors(def.isOn())[0], "");
  });
  document.querySelectorAll(".qs-slider-ico .pxicon, .layer-edit .pxicon").forEach((c) => {
    paintIcon(c, iconColors(false)[0], "");
  });
  tickClock();                                // годинник бере кольори краба
}

/* ---- Сітка плиток ---- */

function renderQuickTiles() {
  quickGrid.innerHTML = "";
  for (const id of quickOrder) {
    const def = QUICK_TILES[id];
    if (!def) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "qs-tile";
    btn.dataset.id = id;
    const on = def.isOn();
    btn.classList.toggle("on", on);
    if (def.enabled && !def.enabled()) btn.disabled = true;
    btn.appendChild(uiIcon(def.icon, { on: on }));
    const lbl = document.createElement("span");
    lbl.textContent = def.label ? def.label() : t(def.labelKey);
    btn.appendChild(lbl);
    btn.addEventListener("click", () => onQuickTile(id, btn));
    quickGrid.appendChild(btn);
  }
}

/* Один тап = дія; у режимі ✎ той самий тап = вибір/обмін місцями.
   Обмін двома дотиками, а не перетягуванням: на резистивному тачі
   drag-and-drop зривається, а два тапи — ні. */
function onQuickTile(id, btn) {
  wake();
  if (editing) {
    if (picked === null) {
      picked = id;
      btn.classList.add("picked");
      return;
    }
    if (picked !== id) {
      const a = quickOrder.indexOf(picked);
      const b = quickOrder.indexOf(id);
      quickOrder[a] = id;
      quickOrder[b] = picked;
      writePref(ORDER_KEY, JSON.stringify(quickOrder));
    }
    picked = null;
    renderQuickTiles();
    return;
  }
  const def = QUICK_TILES[id];
  if (def && def.toggle) def.toggle();
  renderQuickTiles();
}

$("quickEdit").addEventListener("click", () => {
  editing = !editing;
  picked = null;
  $("quickEdit").classList.toggle("on", editing);
  layerQuick.classList.toggle("editing", editing);
  $("quickHint").classList.toggle("show", editing);
  renderQuickTiles();
  wake();
});

/* ---- Повзунки ---- */

function applyBright(v) {
  bright = Math.max(15, Math.min(100, Number(v) || 100));
  brightRange.value = String(bright);
  $("brightVal").textContent = bright + "%";
  applyDim();
}

function applyVolume(v) {
  volume = Math.max(0, Math.min(100, Number(v) || 0));
  volRange.value = String(volume);
  if (ttsAvailable) $("volVal").textContent = volume + "%";
  voiceAudio.volume = volume / 100;
  syncMusicVolume();
}

brightRange.addEventListener("input", () => {
  applyBright(brightRange.value);
  writePref(BRIGHT_KEY, bright);
  wake();
});

volRange.addEventListener("input", () => {
  applyVolume(volRange.value);
  writePref(VOL_KEY, volume);
  wake();
});

/* ---- Стан із localStorage ---- */

(function initPrefs() {
  const theme = readPref(THEME_KEY, null);
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

  idleHomeMs = Number(validOption(readPref(IDLE_HOME_KEY, String(DEFAULT_IDLE_HOME_MS)), IDLE_HOME_OPTIONS, DEFAULT_IDLE_HOME_MS));
  idleSleepMs = Number(validOption(readPref(IDLE_SLEEP_KEY, String(DEFAULT_IDLE_SLEEP_MS)), IDLE_SLEEP_OPTIONS, DEFAULT_IDLE_SLEEP_MS));
  clockFormat = validOption(readPref(CLOCK_FORMAT_KEY, "24"), CLOCK_FORMAT_OPTIONS, "24");
  showClockDate = readPref(CLOCK_DATE_KEY, "1") !== "0";
  const savedMotion = readPref(MOTION_KEY, "full");
  applyMotion(savedMotion === "reduced" ? "reduced" : "full");

  // "auto" і тут: цей рядок читається РАНІШЕ за той, що в асинхронному
  // блоці нижче, і саме він визначає стиль першого рендера. Поки тут
  // лишалось "pixel", типове «авто» ніколи не доживало до екрана.
  const savedIconStyle = readPref(ICON_KEY, "auto");
  if (ICON_STYLES[savedIconStyle]) iconStyle = savedIconStyle;
  const savedIconTint = readPref(ICON_TINT_KEY, DEFAULT_ICON_TINT);
  if (ICON_TINTS.some((item) => item.value === savedIconTint)) iconTint = savedIconTint;

  applyBright(readPref(BRIGHT_KEY, 100));
  applyVolume(readPref(VOL_KEY, 70));
  // Типово УВІМКНЕНО: бот із головою, але без голосу — це половина бота.
  // Хто не хоче звуку, вимикає у швидких діях, і вибір запамʼятовується.
  voiceOn = readPref(VOICE_KEY, "1") === "1";
  const savedSpeed = parseFloat(readPref(SPEED_KEY, "1"));
  if (VOICE_SPEEDS.includes(savedSpeed)) voiceSpeed = savedSpeed;
  const savedRate = parseFloat(readPref(RATE_KEY, "1"));
  if (MUSIC_RATES.includes(savedRate)) musicRate = savedRate;

  const saved = readPref(ORDER_KEY, null);
  if (saved) {
    try {
      const list = JSON.parse(saved);
      // Беремо лише відомі id і дописуємо ті, що з’явилися після збереження
      if (Array.isArray(list)) {
        const known = list.filter((id) => QUICK_TILES[id]);
        quickOrder = known.concat(DEFAULT_ORDER.filter((id) => !known.includes(id)));
      }
    } catch (e) { /* зіпсований запис — лишаємо типовий порядок */ }
  }

  // Іконки повзунків і кнопки ✎
  $("brightIco").appendChild(uiIcon("sun", { cell: 3 }));
  $("volIco").appendChild(uiIcon("speaker", { cell: 3 }));
  $("quickEdit").appendChild(uiIcon("pencil", { cell: 2 }));

  renderQuickTiles();
  tickClock();
  checkTts();
})();

/* Сумісність зі старим кодом сну/пробудження */
function syncQuickButtons() {
  renderQuickTiles();
}

document.addEventListener("fullscreenchange", renderQuickTiles);


/* ---------- Кнопки «назад» у шарах ----------
   Свайп лишається, але не єдиним способом вийти: на резистивному тачі жест
   часто зривається, а підпис «свайп вниз — назад» — це не кнопка. */

document.querySelectorAll("[data-back]").forEach((btn) => {
  btn.addEventListener("click", () => {
    openLayer(null);
    wake();
  });
});

/* ---------- Чат просто на екрані ----------
   Той самий мозок і той самий /api/chat, що й у панелі: stream:true, а
   відповідь малюється streaming-markdown у міру надходження чанків. */

const chatLog = $("chatLog");

const SESSION_KEY = "botScreenSession";
let chatBusy = false;

/* Сесія стала: історія розмови на екрані переживає перезавантаження */
let sessionId = (function initSession() {
  let sid = null;
  try { sid = localStorage.getItem(SESSION_KEY); } catch (e) { sid = null; }
  if (!sid) {
    sid = "screen-" + Math.random().toString(16).slice(2, 10);
    try { localStorage.setItem(SESSION_KEY, sid); } catch (e) {}
  }
  return sid;
})();

function chatScrollDown() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function addMsg(role, text) {
  const empty = $("chatEmpty");
  if (empty) empty.remove();
  const el = document.createElement("div");
  el.className = "msg " + role;
  if (text != null) el.textContent = text;
  chatLog.appendChild(el);
  // Довгі розмови не мають рости нескінченно — на Pi це пам'ять і лейаут
  while (chatLog.children.length > 40) chatLog.removeChild(chatLog.firstChild);
  chatScrollDown();
  return el;
}

/* fromVoice — репліку сказали в мікрофон. Летить у /api/chat як voice:true,
   і мозок отримує в промпті застереження, що текст пройшов через ASR і може
   бути перекручений. Без цього прапорця бот бачив «кван» як невідоме слово й
   перепитував замість того, щоб зрозуміти «Qwen».

   spoken — ЧИ ОЗВУЧАТЬ відповідь. Це не те саме, що fromVoice: надиктувати
   можна з вимкненим синтезом, а набрати з клавіатури — з увімкненим. Від
   нього залежить, чи попросять мозок писати одиниці словами: «120 км/год»
   синтез читає як «ка-ем-скісна-риска-год», і це чути. */
async function sendChat(message, fromVoice) {
  chatBusy = true;
  micButtons.forEach((b) => { b.classList.add("busy"); b.disabled = true; });
  const userEl = addMsg("user", message);

  /* One status line under the reply while the bot works: "thinking",
     "searching the web · …". Bubbles are inserted ABOVE it, so a narration
     line ("one sec, checking") stays visible while the tool runs below it. */
  const statusEl = addMsg("bot", t("busy.thinking"));
  statusEl.classList.add("pending");
  const status = (label) => {
    setBusy(label);
    if (statusEl.isConnected) statusEl.textContent = label;
  };
  const dropStatus = () => { if (statusEl.isConnected) statusEl.remove(); };

  let scrollPending = false;
  const scrollSoon = () => {
    // At most once a frame: on the A53 every chunk would otherwise reflow
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => { scrollPending = false; chatScrollDown(); });
  };

  /* The face caption.
     Voice on: it follows the VOICE — the message being spoken is the one
     on screen, and the next replaces it when its audio starts. That is
     what makes live mode read like a conversation, not a document.
     Voice off: it shows the whole reply, messages as paragraphs — nothing
     paces the reader, so replacing bubbles would flash words past them. */
  let captionBubble = null;
  const captionAll = (live) => {
    const text = turn.texts().join("\n\n");
    if (text) showCaption(text, "bot", live);
  };
  const captionFollow = (b) => {
    if (speechWanted()) {
      if (captionBubble === null) captionBubble = b;   // first words: show at once
      if (captionBubble === b) showCaption(b.text, "bot", !b.closed);
    } else {
      captionAll(true);
    }
  };
  const captionOnVoice = (b) => () => {
    captionBubble = b;
    if (b.text.trim()) showCaption(b.text, "bot", !b.closed);
  };

  /* Speech per bubble. The first whole sentence (from SPEAK_MIN_CHARS) is
     spoken while the brain is still writing the rest; a finished bubble is
     spoken whole, and the gap between two queue items is the natural pause
     between two messages. */
  const feedSpeech = (b, final) => {
    if (!speechWanted()) return;
    const pending = b.text.slice(b.spoken);
    if (!pending.trim()) { if (final) b.spoken = b.text.length; return; }
    if (final) {
      b.spoken = b.text.length;
      speechSay(pending, captionOnVoice(b));
      return;
    }
    if (pending.length < SPEAK_MIN_CHARS) return;
    let cut = speechCutIndex(pending);
    // A wall of text without punctuation: no point waiting any longer
    if (cut < 0 && pending.length >= SPEAK_MAX_CHARS) cut = pending.length - 1;
    if (cut < 0) return;
    b.spoken += cut + 1;
    speechSay(pending.slice(0, cut + 1), captionOnVoice(b));
  };

  const turn = new ReplyTurn({
    onOpen(b) {
      clearBusy();
      b.el = document.createElement("div");
      b.el.className = "msg bot" + (b.note ? " note" : "");
      chatLog.insertBefore(b.el, statusEl.isConnected ? statusEl : null);
      b.parser = smd.parser(smd.default_renderer(b.el));
      b.drawn = "";
      if (!b.note) dropStatus();      // the answer has started: nothing left to wait for
      scrollSoon();
    },
    onAppend(b, chunk) {
      smd.parser_write(b.parser, chunk);
      b.drawn += chunk;
      captionFollow(b);
      feedSpeech(b, false);
      scrollSoon();
    },
    onSet(b) {
      // Notes arrive as snapshots: extend the parser when the snapshot
      // only grew, redraw when it changed.
      if (b.text.startsWith(b.drawn)) {
        smd.parser_write(b.parser, b.text.slice(b.drawn.length));
      } else {
        try { smd.parser_end(b.parser); } catch (e) { /* already closed */ }
        b.el.textContent = "";
        b.parser = smd.parser(smd.default_renderer(b.el));
        smd.parser_write(b.parser, b.text);
      }
      b.drawn = b.text;
      captionFollow(b);
      scrollSoon();
    },
    onClose(b) {
      try { smd.parser_end(b.parser); } catch (e) { /* already closed */ }
      feedSpeech(b, true);
      if (!speechWanted()) captionAll(false);
    },
    onRemove(b) {
      try { smd.parser_end(b.parser); } catch (e) { /* already closed */ }
      if (b.el) b.el.remove();
      if (captionBubble === b) captionBubble = null;
    },
  });

  const showReaction = (emoji) => {
    if (!emoji || userEl.querySelector(".msg-react")) return;
    const badge = document.createElement("span");
    badge.className = "msg-react";
    badge.textContent = emoji;
    userEl.appendChild(badge);
  };

  status(t("busy.thinking"));

  let finished = false;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message, stream: true, session_id: sessionId,
        voice: !!fromVoice,
        spoken: speechWanted(),
      }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let payload;
        try { payload = JSON.parse(raw); } catch (err) { continue; }
        if (eventType === "delta" && payload.chunk) {
          turn.delta(payload.chunk);
        } else if (eventType === "break") {
          turn.split();
        } else if (eventType === "note") {
          turn.note(payload.id, payload.bubbles);
        } else if (eventType === "reaction") {
          showReaction(payload.emoji);
        } else if (eventType === "emotion") {
          setEmotion(payload.emotion);
        } else if (eventType === "tool_start" || eventType === "tool_progress") {
          turn.work();
          if (!statusEl.isConnected) chatLog.appendChild(statusEl);
          status(toolBusyLabel(payload));
        } else if (eventType === "tool_done" || eventType === "tool_result") {
          // The tool finished; the brain thinks again (and may take another)
          status(t("busy.thinking"));
        } else if (eventType === "done") {
          const spokenBefore = turn.bubbles.some((b) => !b.note && b.spoken > 0);
          const { replaced } = turn.done(payload.bubbles || []);
          // What was already said aloud may have been a DIFFERENT text (the
          // brain dropped the gateway's reply and took another). Then the
          // new answer is read from the start instead of just its tail.
          if (replaced.length && spokenBefore) {
            speechReset();
            captionBubble = null;
            for (const b of turn.bubbles) {
              if (!b.note) { b.spoken = 0; feedSpeech(b, true); }
            }
          }
          showReaction(payload.reaction);
          if (!turn.texts().length && payload.reaction) {
            // Reaction-only reply: the emoji is the whole answer
            showCaption(payload.reaction, "bot");
          } else if (!speechWanted()) {
            captionAll(false);
          }
          // The `reply` SSE event for this same text must not read it twice
          spokenReplyText = typeof payload.reply === "string" ? payload.reply : turn.texts().join("\n\n");
          setEmotion(payload.emotion);
          finished = true;
        } else if (eventType === "error") {
          throw new Error(payload.error || t("chat.brainError"));
        }
      }
    }
    turn.closeAll();
    dropStatus();
    if (!turn.texts().length && !userEl.querySelector(".msg-react")) {
      addMsg("bot", t("chat.emptyReply")).classList.add("pending");
    }
  } catch (err) {
    turn.closeAll();
    dropStatus();
    if (!turn.texts().length) addMsg("bot", "✗ " + err.message);
    crab.showDefeat();
  } finally {
    if (!finished) turn.closeAll();
    chatBusy = false;
    clearBusy();
    micButtons.forEach((b) => { b.classList.remove("busy"); b.disabled = false; });
    chatScrollDown();
    wake();
    onReplyFinished();
  }
}

/* ---------- Голос: три режими розмови ----------
   Поля вводу тут немає: на 2.4" клавіатура — знущання. Вхід — мікрофон.

   Режими (перемикач — довгий дотик по мікрофону або чип під ним):
     push — «поговорити»: тиснеш, кажеш фразу, відпускаєш. За замовчуванням;
     open — «слухає завжди»: мікрофон відкритий, кожна завершена фраза
            йде мозку. Зручно, поки ти поруч;
     wake — «ключове слово»: мікрофон теж відкритий, але бот реагує лише
            після свого імені («клод…»), як «хей, гугл».

   Розпізнавання за пріоритетом:
     1) браузерний SpeechRecognition — дає ПРОМІЖНІ результати, тобто
        справжній стрім того, що ти кажеш;
     2) MediaRecorder → /api/asr (Regolo, faster-whisper-large-v3) — без
        проміжних; фразу ріжемо самі за тишею, і мовчазні шматки НЕ шлемо
        на сервер (інакше відкритий мікрофон коштував би грошей цілодобово).

   Поки слухаємо, рівень мікрофона йде в краба (setAudioLevel): маскот
   рухається на твій голос. Поки бот говорить сам — не слухаємо, інакше
   він почує власну озвучку і відповість сам собі. */

const micBtn = $("micBtn");
const micLabel = $("micLabel");
const chatLive = $("chatLive");
const micButtons = Array.from(document.querySelectorAll("[data-mic]"));
const faceTile = tiles[0];
const faceCaption = $("faceCaption");
const facePhoto = $("facePhoto");
const faceLabel = $("faceLabel");

const MODE_KEY = "botScreenVoiceMode";
const MODES = {
  push: { labelKey: "mode.push", hintKey: "mode.push.hint" },
  open: { labelKey: "mode.open", hintKey: "mode.open.hint" },
  wake: { labelKey: "mode.wake", hintKey: "mode.wake.hint" },
};

let voiceMode = "push";
// Типове ключове слово залежить від мови; справжнє приходить з імені бота
let wakeWord = t("voice.defaultWake");
let wakeWordFromBot = false;  // ім'я прийшло з налаштувань — мовою не чіпаємо
let wakeArmed = false;        // ім'я почули, чекаємо саму команду

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const meter = window.AudioLevelMeter
  ? new window.AudioLevelMeter((lvl) => onMicLevel(lvl))
  : null;

let listening = false;        // мікрофон зараз відкритий
let asrAvailable = false;     // серверний Regolo
let recognition = null;       // браузерний SpeechRecognition
let micStream = null;
let mediaRec = null;
let recChunks = [];
let recTimer = 0;
let botSpeaking = false;      // грає озвучка — свій голос не слухаємо

/* Пороги нарізки фрази для серверного ASR (ті самі, що в панелі) */
const REC_MAX_MS = 15000;     // жорстка стеля однієї фрази
const SILENCE_MS = 1300;      // стільки тиші ПІСЛЯ мовлення = кінець фрази
const MIN_REC_MS = 600;       // коротше — це не фраза, а стук
const VOL_SPEAK = 0.012;      // поріг «є голос»
// Живе розпізнавання: MediaRecorder ріже потік на шматки такої довжини, і
// накопичене аудіо йде на /api/asr/partial, поки людина ЩЕ говорить. Без
// цього після фрази була німа пауза на повне розпізнавання (заміряно 5.7с).
//
// 5000, а не 1200: на короткому уривку Whisper домислює слова, і в стрічці
// зʼявлялась вигадка вигляду «Привіток справу», хоча остаточне розпізнавання
// того самого запису давало правильний текст. Заміряно на одному записі —
// 1.2с дало «Рэс-бери-пай-пай», 2.4с «Рес-бери-пай протює на ліну», 5с уже
// «Рес Беріпай працює на лінукс, а Керую дним...».
//
// Побічний виграш: удесятеро менше звернень до моделі, тож вона не відбирає
// процесор в остаточного розпізнавання, яке й тримає паузу перед відповіддю.
// Плата — фраза, коротша за 5с, живого тексту вже не покаже: буде одразу
// остаточний. Свідомий обмін: краще нічого, ніж вигадка.
const PARTIAL_MS = 5000;
let spoke = false;
let partialBusy = false;      // запит уже в дорозі — другий не шлемо
let partialsOn = true;        // вимикається, якщо сервер віддав 503
let silenceSince = 0;
let recStartAt = 0;

/* Запобіжник безперервного режиму: SpeechRecognition завершується сам і ми
   його піднімаємо — але якщо він падає ОДРАЗУ (немає дозволу на мікрофон,
   немає мережі, збірка Chromium без сервісу розпізнавання), цей самий цикл
   перетворюється на гарячий рестарт кожні 250 мс. Рахуємо порожні спроби. */
let srRestarts = 0;
let srWindowAt = 0;
const SR_MAX_RESTARTS = 5;
const SR_WINDOW_MS = 10000;

/* ---------- Субтитри на циферблаті ----------
   Головний екран — і є місце розмови: тут видно і те, що ти кажеш (поки
   кажеш), і те, що бот відповідає (поки друкує). Тримаємо хвіст тексту:
   це підпис під обличчям, а не читалка. */

let captionTimer = 0;
// Активний smd-парсер субтитра і текст, який у нього вже пішов: разом вони
// дають дописування стріму замість перемальовування рамки з нуля.
let captionParser = null;
let captionRaw = "";
const CAPTION_HOLD_MS = 9000;        // база: стільки висить коротка репліка
const CAPTION_MS_PER_CHAR = 45;      // + на кожен символ, щоб абзац устигли прочитати
const CAPTION_HOLD_MAX_MS = 45000;   // але не назавжди — це все ж циферблат

/* Головне про час життя субтитра: він НЕ зникає, поки бот читає репліку
   вголос. Раніше таймер стартував від показу тексту — і на довгій відповіді
   субтитр гас посеред читання, тобто саме тоді, коли людина його слухала й
   дочитувала очима. Тепер під час озвучки таймера немає взагалі, а після
   останнього слова текст лежить іще CAPTION_AFTER_SPEECH_MS. */
const CAPTION_AFTER_SPEECH_MS = 15000;

const CAPTION_MODE_KEY = "botScreenCaptionMode";
const CAPTION_MODE_OPTIONS = [
  { value: "auto", key: "set.caption.auto" },
  { value: "manual", key: "set.caption.manual" },
];
// manual — субтитр висить, доки не закриєш хрестиком (нікуди не спішить)
let captionMode = validOption(readPref(CAPTION_MODE_KEY, "auto"), CAPTION_MODE_OPTIONS, "auto");

/* Картинки в репліці бота: ![підпис](https://…). Тайл «Розмова» рендерить
   markdown сам (smd), а циферблат і «Бот сказав» показували СИРИЙ текст —
   тобто замість фото людина бачила дужки з посиланням. Тому розбираємо
   репліку тут: текст лишаємо читабельним (підпис замість розмітки), а самі
   картинки показуємо як картинки. */
// Приймаємо і зовнішнє https-посилання (так віддає тулза image_search), і
// шлях на нашому ж сервері (/uploads/…, /file/…) — бот може показати як
// знайдене в мережі, так і власний файл із робочої теки.
const MD_IMAGE_RE = /!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g;

function splitImages(raw) {
  const images = [];
  const text = String(raw || "")
    .replace(MD_IMAGE_RE, (_m, alt, src) => {
      const caption = (alt || "").trim();
      images.push({ alt: caption, src: src });
      return caption;               // підпис лишається в тексті замість розмітки
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: text, images: images };
}

/* ---------- Markdown у виводі екрана ----------
   Тайл «Розмова» малює відповідь стрімовим парсером (smd) — а циферблат і
   «Бот сказав» показували СИРИЙ текст: людина бачила «**важливо**» замість
   жирного і «- пункт» замість списку. Тому той самий smd віддаємо і сюди.

   default_renderer лише ДОДАЄ вузли, тож «перемалювати» = почистити рамку
   й почати новий парсер. */
function mdStart(el) {
  el.textContent = "";
  return smd.parser(smd.default_renderer(el));
}

function mdWhole(el, text) {
  const parser = mdStart(el);
  smd.parser_write(parser, String(text || ""));
  smd.parser_end(parser);
}

/* ---------- Бот показує картинку ----------
   ОДНА рамка, у ній ОДНА картинка; кілька — гортаються свайпом, стрілками
   або тапом по краю. Картинка, що не влазить, лишається цілою (object-fit:
   contain), а порожнє місце стає світлими полями — обрізати фото на 2.4"
   означає здебільшого зробити його невпізнаваним. */

const facePhotoImg = $("facePhotoImg");
const facePhotoDots = $("facePhotoDots");
const faceHolder = $("faceHolder");
let facePhotos = [];
let facePhotoIdx = 0;

/* Спрайт краба, що ТРИМАЄ рамку за правий бік: компактне тіло як у маскота
   плюс ОДНА клешня, піднята вгору-праворуч. Дві симетричні «руки» робили з
   нього павука — тут силует лишається крабячим. Окремий від crab.js
   навмисно: там свій автомат станів, і пози «тримаю» в ньому немає. */
const HOLDER_SPRITE = [
  ".........11",
  "........1.1",
  "........11.",
  ".......11..",
  ".1111111...",
  ".1E11E11...",
  ".1111111...",
  "111111111..",
  ".1111111...",
  ".1.1.1.1...",
];
const HOLDER_CELL = 3;

function drawHolder() {
  if (!faceHolder) return;
  const ctx = faceHolder.getContext("2d");
  if (!ctx) return;
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#c96442";
  ctx.clearRect(0, 0, faceHolder.width, faceHolder.height);
  for (let y = 0; y < HOLDER_SPRITE.length; y++) {
    const row = HOLDER_SPRITE[y];
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell === ".") continue;
      ctx.fillStyle = cell === "E" ? "#14120f" : accent;
      ctx.fillRect(x * HOLDER_CELL, y * HOLDER_CELL, HOLDER_CELL, HOLDER_CELL);
    }
  }
}

function renderFacePhoto() {
  const item = facePhotos[facePhotoIdx];
  if (!item) return;
  facePhotoImg.src = item.src;
  facePhotoImg.alt = item.alt || "";
  facePhoto.classList.toggle("many", facePhotos.length > 1);
  facePhotoDots.textContent = "";
  if (facePhotos.length > 1) {
    facePhotos.forEach((_p, i) => {
      const dot = document.createElement("i");
      if (i === facePhotoIdx) dot.className = "on";
      facePhotoDots.appendChild(dot);
    });
  }
}

function stepFacePhoto(delta) {
  if (facePhotos.length < 2) return;
  const n = facePhotos.length;
  facePhotoIdx = (facePhotoIdx + delta + n) % n;
  renderFacePhoto();
}

/* Показати картинки бота (порожній масив = вийти з режиму фото) */
function showFacePhotos(images) {
  facePhotos = images || [];
  facePhotoIdx = 0;
  if (!facePhotos.length) {
    facePhoto.classList.add("hidden");
    faceHolder.classList.add("hidden");
    faceTile.classList.remove("photo");
    facePhotoImg.removeAttribute("src");
    return;
  }
  renderFacePhoto();
  facePhoto.classList.remove("hidden");
  faceHolder.classList.remove("hidden");
  faceTile.classList.add("photo");
  drawHolder();
}

// Побите посилання не має лишати порожню рамку: викидаємо саме цю картинку
facePhotoImg.addEventListener("error", () => {
  if (!facePhotos.length) return;
  facePhotos.splice(facePhotoIdx, 1);
  if (!facePhotos.length) { showFacePhotos([]); return; }
  facePhotoIdx = facePhotoIdx % facePhotos.length;
  renderFacePhoto();
});

$("facePhotoPrev").addEventListener("click", (e) => { e.stopPropagation(); stepFacePhoto(-1); });
$("facePhotoNext").addEventListener("click", (e) => { e.stopPropagation(); stepFacePhoto(1); });

/* Свайп по самій рамці. Гасимо спливання: інакше той самий жест перегорнув
   би ще й карусель тайлів — і замість наступної картинки ти б опинився на
   іншому екрані. */
(function initPhotoSwipe() {
  let from = null;
  facePhoto.addEventListener("pointerdown", (e) => {
    from = { x: e.clientX, y: e.clientY };
    e.stopPropagation();
  });
  facePhoto.addEventListener("pointerup", (e) => {
    e.stopPropagation();
    const s = from;
    from = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > 18) stepFacePhoto(dx < 0 ? 1 : -1);
  });
})();

/* Малює картинки в контейнер тайла «Бот сказав» (там гортання не треба —
   тайл прокручується сам) */
function renderPhotos(box, images) {
  if (!box) return;
  box.textContent = "";
  if (!images.length) { box.classList.add("hidden"); return; }
  for (const item of images.slice(0, 4)) {
    const img = document.createElement("img");
    img.src = item.src;
    img.alt = item.alt || "";
    img.loading = "lazy";
    img.onerror = () => {
      img.remove();
      if (!box.querySelector("img")) box.classList.add("hidden");
    };
    box.appendChild(img);
  }
  box.classList.remove("hidden");
}

/* ---------- Субтитр: гортання сторінками ----------
   На 320×240 довга репліка не влазить у рамку. Смуги прокрутки тут нема
   (палець, не курсор), тому гортаємо ТАПОМ: сторінка за сторінкою, з кінця
   знову на початок — щоб перечитати можна було, не чекаючи нової репліки. */

const captionPage = $("captionPage");
const faceCaptionText = $("faceCaptionText");
const captionClose = $("captionClose");

// Хрестик: закриває субтитр і не пускає тап у карусель під ним
captionClose.addEventListener("click", (e) => { e.stopPropagation(); hideCaption(); });

// Поточна сторінка тримаємо ЧИСЛОМ, а не рахуємо зі scrollTop. Через
// scroll-behavior: smooth прокрутка доїжджає асинхронно, тож лічильник,
// порахований одразу після присвоєння, показував ПОПЕРЕДНЮ сторінку.
let captionPageIdx = 0;

function captionPageCount() {
  const ph = faceCaption.clientHeight || 1;
  return Math.max(1, Math.ceil(faceCaption.scrollHeight / ph));
}

function updateCaptionPage() {
  const pages = captionPageCount();
  if (pages <= 1) {                      // влізло цілком — лічильник ні до чого
    captionPage.classList.add("hidden");
    return;
  }
  captionPage.textContent = Math.min(captionPageIdx + 1, pages) + "/" + pages;
  captionPage.classList.remove("hidden");
}

function scrollCaptionTo(idx) {
  captionPageIdx = idx;
  faceCaption.scrollTop = idx * (faceCaption.clientHeight || 1);
  updateCaptionPage();
}

function pageCaption() {
  const pages = captionPageCount();
  if (pages <= 1) return;                              // гортати нічого
  scrollCaptionTo((captionPageIdx + 1) % pages);       // з кінця — знову на початок
  // Людина читає — субтитр не має зникнути з-під пальця на півслові
  clearTimeout(captionTimer);
  if (captionMode !== "manual") captionTimer = setTimeout(hideCaption, CAPTION_HOLD_MAX_MS);
}

// Тап по рамці = наступна сторінка. stopPropagation — щоб той самий тап не
// поїхав у карусель тайлів і не перегорнув екран замість тексту.
faceCaption.addEventListener("click", (e) => { e.stopPropagation(); pageCaption(); });

function showCaption(text, kind, live) {
  const parts = splitImages(text);
  const t = parts.text;
  clearTimeout(captionTimer);
  if (!t && !parts.images.length) return hideCaption();
  // Текст НЕ ріжемо: рамка субтитра прокручується, і сама з’їжджає донизу —
  // раніше довга репліка лишалась обрізаною хвостом у 140 символів, тобто
  // початок відповіді на екрані просто не існував.
  //
  // Слова бота — markdown; поки бот ДРУКУЄ (live), доливаємо в парсер лише
  // дельту. Повний ре-парс на кожен чанк означав би перебудову всього DOM
  // рамки — на A53 це видно оком.
  if (kind === "user") {
    // Те, що кажеш ти, markdown'ом не читаємо: диктуючи «2 * 3 * 4», людина
    // не просить курсив.
    faceCaptionText.textContent = t;
    captionParser = null;
    captionRaw = "";
  } else if (live && captionParser && t.startsWith(captionRaw)) {
    if (t.length > captionRaw.length) {
      smd.parser_write(captionParser, t.slice(captionRaw.length));
      captionRaw = t;
    }
  } else if (live) {
    captionParser = mdStart(faceCaptionText);
    smd.parser_write(captionParser, t);
    captionRaw = t;
  } else {
    mdWhole(faceCaptionText, t);
    captionParser = null;
    captionRaw = "";
  }
  faceCaption.className = "face-caption " + (kind || "bot");
  showFacePhotos(parts.images);
  faceLabel.classList.add("hidden");
  faceTile.classList.add("captioned");
  // Прокрутка — ОСТАННЬОЮ дією: класи вище міняють висоту й ширину рамки
  // субтитра, тож докручування перед ними просто скидалось.
  //
  // live=true — бот ще ДРУКУЄ: тримаємось хвоста, бо цікаві останні слова.
  // Готову ж репліку показуємо З ПОЧАТКУ: інакше на екран потрапляв тільки
  // її кінець, а перші речення взагалі не існували для читача.
  if (live) {
    captionPageIdx = Math.max(0, captionPageCount() - 1);
    faceCaption.scrollTop = faceCaption.scrollHeight;
    updateCaptionPage();
  } else {
    scrollCaptionTo(0);
  }
  armCaptionHide(t.length);
}

/* ---------- Коли субтитр зникає ----------
   manual  — ніколи сам: тільки хрестиком;
   озвучка — таймера немає, його поставить captionSpeechEnded();
   інакше  — за довжиною тексту (9 с + 45 мс на символ), як і раніше:
             це груба, але робоча оцінка часу на прочитання. */
function armCaptionHide(len) {
  clearTimeout(captionTimer);
  captionClose.classList.toggle("hidden", captionMode !== "manual");
  if (captionMode === "manual") return;
  if (botSpeaking) return;
  const hold = Math.min(CAPTION_HOLD_MAX_MS, CAPTION_HOLD_MS + (len || 0) * CAPTION_MS_PER_CHAR);
  captionTimer = setTimeout(hideCaption, hold);
}

/* Бот почав читати — знімаємо будь-який таймер: поки говорить, текст живе */
function captionSpeechStarted() {
  if (captionMode === "manual") return;
  clearTimeout(captionTimer);
}

/* Дочитав — саме звідси починаються ті 15 секунд на «дочитати очима» */
function captionSpeechEnded() {
  if (captionMode === "manual") return;
  if (faceCaption.classList.contains("hidden")) return;
  clearTimeout(captionTimer);
  captionTimer = setTimeout(hideCaption, CAPTION_AFTER_SPEECH_MS);
}

/* Тайл «Бот сказав»: markdown + самі картинки окремими рамками */
function showSaid(raw) {
  const parts = splitImages(raw);
  if (parts.text) mdWhole($("sayText"), parts.text);
  else $("sayText").textContent = t("say.noText");
  renderPhotos($("sayPhoto"), parts.images);
  sayAt = Date.now();
  updateAges();
}

/* ---------- Що бот РОБИТЬ просто зараз ----------
   Раніше між «розпізнав фразу» і першим словом відповіді екран мовчав:
   людина сказала — і не знала, чи бот думає, чи не почув (а мозок міг
   думати десятки секунд, якщо пішов у тулзи). Тепер видно і сам факт
   роботи, і конкретну дію: бекенд шле tool_start / tool_progress /
   tool_done, ми ліпимо з них рядок «шукаю в інтернеті · DuckDuckGo: …».

   Рядок живе на циферблаті (де людина й говорить) і дублюється в тайлі
   розмови — але НЕ поверх живого розпізнавання, інакше він перебивав би
   те, що людина саме зараз диктує. */
const faceBusy = $("faceBusy");
const faceBusyText = $("faceBusyText");
let busyLabel = "";

function setBusy(label) {
  busyLabel = String(label || "");
  if (!busyLabel) return clearBusy();
  faceBusyText.textContent = busyLabel;
  faceBusy.classList.remove("hidden");
  // Клас на тайлі: у двоколонковій розкладці субтитр має вкоротитись, щоб
  // звільнити рядок під себе (CSS: .tile-face.captioned.busy .face-caption)
  faceTile.classList.add("busy");
  if (!listening) chatLive.textContent = busyLabel;
}

function clearBusy() {
  faceBusy.classList.add("hidden");
  faceBusyText.textContent = "";
  faceTile.classList.remove("busy");
  // Чистимо тільки СВІЙ рядок: там уже може бути чернетка розпізнавання
  if (chatLive.textContent === busyLabel) chatLive.textContent = "";
  busyLabel = "";
}

/* Подія тулза → людська дія. Невідомий інструмент даємо як «працюю…»:
   список тулзів на бекенді росте швидше, ніж підписи на цьому екрані.
   detail приходить готовим рядком з бекенда (запит, місто, шлях) — саме
   він і відповідає на питання «а що воно там робить». */
function toolBusyLabel(ev) {
  const name = ev && ev.tool ? String(ev.tool) : "";
  const key = "busy.tool." + name;
  let label = t(key);
  if (label === key) label = t("busy.working");
  const detail = ev && ev.detail ? String(ev.detail).trim() : "";
  if (!detail) return label;
  return label + " · " + (detail.length > 40 ? detail.slice(0, 39) + "…" : detail);
}

function hideCaption() {
  clearTimeout(captionTimer);
  faceCaption.className = "face-caption hidden";
  faceCaptionText.textContent = "";
  captionClose.classList.add("hidden");
  captionParser = null;
  captionRaw = "";
  captionPage.classList.add("hidden");
  showFacePhotos([]);
  faceLabel.classList.remove("hidden");
  faceTile.classList.remove("captioned");
}

/* ---------- Доступність голосу ---------- */

(async function initVoiceInput() {
  try {
    const r = await fetch("/api/asr/status");
    const d = await r.json();
    asrAvailable = !!d.enabled;
  } catch (e) {
    asrAvailable = false;
  }
  const canMic = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (!SR && !(asrAvailable && canMic)) {
    micButtons.forEach((b) => { b.disabled = true; });
    micLabel.textContent = t("voice.unavailable");
    return;
  }
  // Ключове слово — ім'я бота з налаштувань: «Клод Бот» → «клод»
  try {
    const r = await fetch("/api/setup");
    const d = await r.json();
    const name = ((d.profile || {}).name || "").trim().toLowerCase();
    if (name) { wakeWord = name.split(/\s+/)[0]; wakeWordFromBot = true; }
  } catch (e) { /* лишається типове слово поточної мови */ }

  // initPrefs уже виставив стиль до першого рендера; тут лишається
  // страховка на випадок, коли значення в сховищі змінилось між ними, і
  // ОБОВʼЯЗКОВЕ перемалювання — інакше нове значення висіло б у змінній,
  // а на екрані лишалися б іконки, намальовані попереднім стилем.
  const lateStyle = readPref(ICON_KEY, "auto");
  if (ICON_STYLES[lateStyle] && lateStyle !== iconStyle) {
    iconStyle = lateStyle;
    rebuildIcons();
  }
  voiceMode = readPref(MODE_KEY, "push");
  if (!MODES[voiceMode]) voiceMode = "push";
  renderMode();
  if (voiceMode !== "push") startContinuous();
})();

/* ---------- Стан кнопок ---------- */

/* Кнопка каже, що ЗАРАЗ відбувається (дія/стан), а чип поруч — який режим
   обрано. Раніше обидва писали назву режиму, і напис дублювався. */
function micStateLabel() {
  if (wakeArmed) return t("voice.listening");
  if (!listening) return voiceMode === "push" ? t("voice.speak") : t("voice.pause");
  if (voiceMode === "wake") return t("voice.waitingWord", { word: wakeWord });
  if (voiceMode === "open") return t("voice.listeningAll");
  return t("voice.listening");
}

function setListening(on) {
  listening = on;
  micButtons.forEach((b) => b.classList.toggle("listening", on));
  micLabel.textContent = micStateLabel();
  // У режимі очікування ключового слова краб не має вічно «слухати» —
  // інакше емоція перестає щось означати
  const active = on && (voiceMode !== "wake" || wakeArmed);
  crab.setEmotion(active ? "listening" : "idle");
  if (!on) {
    crab.setAudioLevel(null);
    if (meter) meter.detach();
    if (faceCaption.classList.contains("user")) hideCaption();
  }
  wake();
}

function renderMode() {
  const chip = $("modeChip");
  if (chip) chip.textContent = t(MODES[voiceMode].labelKey);
  micLabel.textContent = micStateLabel();
  document.querySelectorAll("#modeSheet .mode-row").forEach((row) => {
    row.classList.toggle("on", row.dataset.mode === voiceMode);
  });
}

function showLive(text) {
  chatLive.textContent = text || "";
  if (text) showCaption(text, "user");
}

/* ---------- Мікрофон ---------- */

async function openMic() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (meter) meter.attachStream(micStream);
    return true;
  } catch (e) {
    micStream = null;
    return false;
  }
}

function closeMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (meter) meter.detach();
}

/* Рівень мікрофона: рух краба + нарізка фрази для серверного ASR */
function onMicLevel(level) {
  crab.setAudioLevel(level);
  if (!mediaRec || mediaRec.state !== "recording" || botSpeaking) return;

  const now = Date.now();
  if (level > VOL_SPEAK) {
    spoke = true;
    silenceSince = now;
  }
  const longEnough = now - recStartAt > MIN_REC_MS;
  const quietEnough = now - silenceSince > SILENCE_MS;
  if ((spoke && longEnough && quietEnough) || now - recStartAt > REC_MAX_MS) {
    try { mediaRec.stop(); } catch (e) { /* уже зупинений */ }
  }
}

/* ---------- Розпізнавання ---------- */

/* How long the bot waits for the command after hearing only its name, and
   how long it keeps listening without the name after it has answered.
   The follow-up window is what makes wake mode a conversation: nobody says
   "Claude" before every sentence of a back-and-forth. */
const WAKE_ARM_MS = 8000;
const FOLLOW_UP_MS = 8000;
let wakeTimer = 0;
let followUpPending = false;   // a reply finished; open the window once speech ends

function armWake(ms) {
  wakeArmed = true;
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(disarmWake, ms);
  setListening(listening);
}

function disarmWake() {
  clearTimeout(wakeTimer);
  if (!wakeArmed) return;
  wakeArmed = false;
  setListening(listening);
}

/* Called by sendChat when a reply is complete (spoken or not) */
function onReplyFinished() {
  if (voiceMode !== "wake") return;
  followUpPending = true;
  if (!botSpeaking) startFollowUp();
}

function startFollowUp() {
  if (!followUpPending) return;
  followUpPending = false;
  if (voiceMode === "wake" && listening) armWake(FOLLOW_UP_MS);
}

/* "Claude, stop" while the bot talks: cut the voice, keep the mic */
function bargeIn() {
  followUpPending = false;
  speechReset();
  showCaption(t("voice.stopped"), "bot");
  // Whoever said "stop" usually says the next thing right away
  if (voiceMode === "wake" && listening) armWake(FOLLOW_UP_MS);
}

function handleFinalText(said) {
  const text = (said || "").trim();
  if (!text) return;

  if (voiceMode === "wake") {
    const { action, text: command } = parseWake(text, wakeWord, wakeArmed);
    if (action === "ignore") {
      if (!wakeArmed) setListening(listening);   // undo an early "listening" from interim
      return;
    }
    if (action === "stop") { disarmWake(); bargeIn(); return; }
    if (action === "arm") {
      armWake(WAKE_ARM_MS);                        // only the name: wait for the command
      showCaption(t("voice.yes"), "bot");
      return;
    }
    disarmWake();                                  // command taken
    sendChat(command, true);
    return;
  }

  sendChat(text, true);
}

/* While the bot is speaking, the mic still hears — mostly the bot itself.
   Only one thing gets through: its name with a stop word. Asking for the
   name as well is what keeps its own voice ("…stop the timer") from
   silencing it. */
function heardWhileSpeaking(text) {
  if (voiceMode === "push") return;
  const { action } = parseWake(text, wakeWord, false);
  if (action === "stop") bargeIn();
}

/* Браузерний SR: єдиний шлях із проміжними результатами */
function startRecognition(continuous) {
  if (!SR) return false;
  let finalText = "";
  recognition = new SR();
  // Мову розпізнавання беремо з мови інтерфейсу: англійський екран, який
  // слухає українською, чує саме сміття
  recognition.lang = t("speech.lang");
  recognition.interimResults = true;
  recognition.continuous = !!continuous;

  recognition.onresult = (e) => {
    srRestarts = 0;                              // recognition is alive
    if (botSpeaking) {
      // Mostly its own voice; only "Claude, stop" may get through
      for (let i = e.resultIndex; i < e.results.length; i++) {
        heardWhileSpeaking(e.results[i][0].transcript);
      }
      return;
    }
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const chunk = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        if (continuous) {
          handleFinalText(chunk);
          showLive("");
          continue;
        }
        finalText += chunk;
      } else {
        interim += chunk;
      }
    }
    if (!continuous || interim) showLive(finalText + interim);
    // The name is already in the interim text: show that the bot heard it
    // now, not a second later when the phrase is final.
    if (voiceMode === "wake" && !wakeArmed && interim && findWake(interim, wakeWord)) {
      crab.setEmotion("listening");
      micLabel.textContent = t("voice.listening");
    }
  };

  recognition.onerror = () => {
    if (continuous) return;                      // onend сам перезапустить
    finishPhrase(finalText);
  };

  recognition.onend = () => {
    if (continuous && voiceMode !== "push") {
      const now = Date.now();
      if (now - srWindowAt > SR_WINDOW_MS) { srRestarts = 0; srWindowAt = now; }
      srRestarts += 1;
      if (srRestarts > SR_MAX_RESTARTS) {
        // Розпізнавання не працює — не крутимо цикл, а чесно кажемо
        recognition = null;
        if (!startRecorder(true)) {
          setVoiceMode("push");
          showCaption(t("voice.continuousFailed"), "bot");
        }
        return;
      }
      // SR завершується сам кожні кілька секунд — піднімаємо його знову
      setTimeout(() => { if (voiceMode !== "push") startRecognition(true); }, 250);
      return;
    }
    finishPhrase(finalText);
  };

  try {
    recognition.start();
    return true;
  } catch (e) {
    recognition = null;
    return false;
  }
}

/* Запасний шлях: пишемо аудіо й шлемо на /api/asr, коли фраза скінчилась */
function startRecorder(continuous) {
  if (!micStream || !asrAvailable || !window.MediaRecorder) return false;
  recChunks = [];
  spoke = false;
  recStartAt = Date.now();
  silenceSince = recStartAt;
  try {
    mediaRec = new MediaRecorder(micStream);
  } catch (e) {
    mediaRec = null;
    return false;
  }
  mediaRec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    recChunks.push(e.data);
    // Перший шматок несе заголовки webm, тож декодується лише СКЛЕЄНЕ
    // аудіо з початку — шлемо накопичене, а не останній шматок окремо.
    if (partialsOn && spoke && !partialBusy && mediaRec && mediaRec.state === "recording") {
      sendPartial(new Blob(recChunks, { type: "audio/webm" }));
    }
  };
  mediaRec.onstop = () => {
    const hadSpeech = spoke;
    const blob = new Blob(recChunks, { type: "audio/webm" });
    recChunks = [];
    mediaRec = null;
    // Тишу на сервер не шлемо: відкритий мікрофон інакше молотив би
    // платні запити цілодобово
    if (hadSpeech && blob.size) sendToAsr(blob, continuous);
    else if (continuous && voiceMode !== "push") startRecorder(true);
    else finishPhrase("");
  };
  mediaRec.start(PARTIAL_MS);
  recTimer = setTimeout(() => {
    if (mediaRec && mediaRec.state === "recording") { try { mediaRec.stop(); } catch (e) {} }
  }, REC_MAX_MS + 500);
  return true;
}

/**
 * Проміжне розпізнавання: показує текст, поки фраза ще триває.
 * Свідомо «best effort» — помилку ковтаємо (це чорновик), а на 503 вимикаємо
 * проміжні до кінця сесії, щоб не довбати сервер даремно.
 */
async function sendPartial(blob) {
  partialBusy = true;
  try {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    const r = await fetch("/api/asr/partial", { method: "POST", body: fd });
    if (r.status === 503) { partialsOn = false; return; }
    if (!r.ok) return;
    const d = await r.json();
    // Показуємо, лише поки ще пишемо: інакше чорновик перебив би остаточний текст
    if (d.text && mediaRec && mediaRec.state === "recording") showLive(d.text);
  } catch (e) {
    /* мережа моргнула — наступний шматок спробує знову */
  } finally {
    partialBusy = false;
  }
}

async function sendToAsr(blob, continuous) {
  clearTimeout(recTimer);
  if (!continuous) showLive(t("voice.recognizing"));
  let text = "";
  /* Розпізнавання рахує ХМАРА (asr.provider: regolo), локального падіння
     немає навмисне. Тому відмову треба СКАЗАТИ: раніше помилка тут просто
     ковталась, і зламана хмара виглядала точно так само, як мовчазний
     мікрофон — фраза зникала в нікуди без жодного слова на екрані. */
  let failure = "";
  try {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    const r = await fetch("/api/asr", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    if (r.ok) text = d.text || "";
    else failure = d.error || t("voice.asrFail");
  } catch (e) {
    failure = t("voice.asrOffline");
  }
  if (failure) {
    showLive("");
    showCaption(failure, "bot");
  }
  if (continuous) {
    showLive("");
    if (text) { showCaption(text, "user"); handleFinalText(text); }
    if (voiceMode !== "push") startRecorder(true);
  } else {
    finishPhrase(text);
  }
}

/* ---------- Режим «поговорити» (одна фраза) ---------- */

async function startPhrase() {
  showLive("");
  await openMic();
  setListening(true);
  if (startRecognition(false)) return;
  if (startRecorder(false)) {
    showLive(t("voice.afterPause"));
    return;
  }
  finishPhrase("");
}

function stopPhrase() {
  clearTimeout(recTimer);
  if (recognition) { try { recognition.stop(); } catch (e) {} return; }
  if (mediaRec && mediaRec.state !== "inactive") { try { mediaRec.stop(); } catch (e) {} return; }
  finishPhrase("");
}

function finishPhrase(text) {
  if (recognition) {
    recognition.onend = null;
    recognition.onerror = null;
    recognition = null;
  }
  mediaRec = null;
  closeMic();
  if (!listening) return;
  setListening(false);
  const said = (text || "").trim();
  showLive("");
  if (said) handleFinalText(said);
}

/* ---------- Режими «завжди» і «ключове слово» ---------- */

async function startContinuous() {
  const ok = await openMic();
  if (!ok && !SR) {                       // без мікрофона й без SR — нема як
    setVoiceMode("push");
    return;
  }
  setListening(true);
  wakeArmed = false;
  if (startRecognition(true)) return;
  if (startRecorder(true)) return;
  setVoiceMode("push");                   // жоден шлях не піднявся
}

function stopContinuous() {
  clearTimeout(recTimer);
  if (recognition) {
    recognition.onend = null;
    recognition.onerror = null;
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }
  if (mediaRec && mediaRec.state !== "inactive") {
    mediaRec.onstop = null;
    try { mediaRec.stop(); } catch (e) {}
  }
  mediaRec = null;
  closeMic();
  clearTimeout(wakeTimer);
  followUpPending = false;
  wakeArmed = false;
  setListening(false);
}

function setVoiceMode(mode) {
  if (!MODES[mode]) return;
  stopContinuous();
  voiceMode = mode;
  writePref(MODE_KEY, mode);
  renderMode();
  if (mode !== "push") startContinuous();
}

/* ---------- Кнопки й перемикач режимів ---------- */

const modeSheet = $("modeSheet");

function openModeSheet() {
  renderMode();
  modeSheet.classList.remove("hidden");
  wake();
}
function closeModeSheet() {
  modeSheet.classList.add("hidden");
}

modeSheet.addEventListener("click", (e) => {
  const row = e.target.closest(".mode-row");
  if (row) {
    setVoiceMode(row.dataset.mode);
    closeModeSheet();
    return;
  }
  if (e.target.closest("[data-mode-close]")) closeModeSheet();
});

$("modeChip").addEventListener("click", (e) => { e.stopPropagation(); openModeSheet(); });

iconSheet().addEventListener("click", (e) => {
  const row = e.target.closest(".mode-row");
  if (row) { setIconStyle(row.dataset.icons); iconSheet().classList.add("hidden"); return; }
  if (e.target.closest("[data-icons-close]")) iconSheet().classList.add("hidden");
});

micButtons.forEach((btn) => {
  // Довгий дотик по мікрофону — теж вибір режиму: щоб не шукати чип
  let holdTimer = 0;
  let held = false;
  const startHold = () => {
    held = false;
    holdTimer = setTimeout(() => { held = true; openModeSheet(); }, 550);
  };
  const endHold = () => clearTimeout(holdTimer);
  btn.addEventListener("pointerdown", startHold);
  btn.addEventListener("pointerup", endHold);
  btn.addEventListener("pointerleave", endHold);

  btn.addEventListener("click", () => {
    if (held) { held = false; return; }        // це був виклик меню
    wake();
    if (voiceMode !== "push") {                 // у «завжди»/«ключове» кнопка
      openModeSheet();                          // лише показує вибір
      return;
    }
    if (listening) { stopPhrase(); return; }
    goTile(0);                                  // розмова відбувається «в обличчя»
    startPhrase();
  });
});

/* ---------- Розмови (сесії) ----------
   Екран не прибитий до однієї розмови: список той самий, що й у панелі
   (/api/sessions), тож почату на ноуті розмову можна продовжити тут. */

const sessionsPanel = $("sessionsPanel");
const sessionsList = $("sessionsList");

let sessionTitleText = null;   // null = назви ще не було, лишаємо статичну

function setSessionTitle(title) {
  sessionTitleText = title || "";
  $("sessionTitle").textContent = title && title.trim()
    ? title.trim().slice(0, 26)
    : t("chat.new");
}

function renderHistory(messages) {
  chatLog.innerHTML = "";
  if (!messages || !messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.id = "chatEmpty";
    empty.dataset.i18n = "chat.empty";   // щоб applyStatic знайшов її і після зміни мови
    empty.textContent = t("chat.empty");
    chatLog.appendChild(empty);
    return;
  }
  // The last 20 turns: nobody scrolls further back on this screen anyway
  let lastUser = null;
  for (const m of messages.slice(-20)) {
    if (m.role === "user") {
      lastUser = addMsg("user", m.content || "");
    } else if (m.role === "assistant") {
      // One bubble per message, the way the reply was streamed. `parts`
      // holds them in order (narration, tool steps, answer); a message
      // saved before bubbles existed only has `content`.
      const parts = Array.isArray(m.parts)
        ? m.parts.filter((p) => p && p.type === "text" && String(p.text || "").trim())
        : [];
      const bubbles = parts.length ? parts : (m.content ? [{ text: m.content }] : []);
      for (const part of bubbles) {
        const el = addMsg("bot", null);
        if (part.note) el.classList.add("note");
        mdWhole(el, part.text);
      }
      if (m.reaction && lastUser && !lastUser.querySelector(".msg-react")) {
        const badge = document.createElement("span");
        badge.className = "msg-react";
        badge.textContent = m.reaction;
        lastUser.appendChild(badge);
      }
    }
  }
  chatScrollDown();
}

async function openSession(id, title) {
  sessionId = id;
  writePref(SESSION_KEY, id);
  setSessionTitle(title);
  sessionsPanel.classList.add("hidden");
  try {
    const r = await fetch("/api/sessions/" + encodeURIComponent(id));
    const d = await r.json();
    renderHistory(d.messages || []);
    if (d.title) setSessionTitle(d.title);
  } catch (e) {
    renderHistory([]);
  }
}

async function showSessions() {
  sessionsPanel.classList.remove("hidden");
  sessionsList.textContent = t("common.loading");
  try {
    const r = await fetch("/api/sessions");
    const d = await r.json();
    const list = d.sessions || [];
    sessionsList.innerHTML = "";
    if (!list.length) {
      sessionsList.textContent = t("chat.sessionsEmpty");
      return;
    }
    for (const item of list.slice(0, 30)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "session-row" + (item.id === sessionId ? " on" : "");
      const t = document.createElement("span");
      t.className = "s-title";
      t.textContent = item.title || item.id;
      const meta = document.createElement("span");
      meta.className = "s-meta";
      meta.textContent = item.count ? item.count + "×" : "";
      row.appendChild(t);
      row.appendChild(meta);
      row.addEventListener("click", () => openSession(item.id, item.title));
      sessionsList.appendChild(row);
    }
  } catch (e) {
    sessionsList.textContent = t("chat.sessionsFailed");
  }
}

$("sessionsBtn").addEventListener("click", () => { wake(); showSessions(); });
$("sessionsClose").addEventListener("click", () => sessionsPanel.classList.add("hidden"));

function startNewChat() {
  sessionId = "screen-" + Math.random().toString(16).slice(2, 10);
  writePref(SESSION_KEY, sessionId);
  setSessionTitle("");
  renderHistory([]);
  sessionsPanel.classList.add("hidden");
  goTile(chatTile());               // нова розмова — одразу в тайл розмови
}

$("chatNew").addEventListener("click", () => { wake(); startNewChat(); });

/* Іконки шапки й мікрофона — тим самим піксельним набором */
$("sessionsIco").appendChild(uiIcon("list", { cell: 2 }));
$("chatNewIco").appendChild(uiIcon("plus", { cell: 2 }));
$("micIco").appendChild(uiIcon("mic", { cell: 3, on: true }));
$("faceMicIco").appendChild(uiIcon("mic", { cell: 2, on: true }));

/* Стартова розмова: підтягуємо збережену, щоб екран не починав з нуля */
openSession(sessionId, "");


/* ---------- Шухляда застосунків ----------
   Ідея з Apple Watch / шухляди застосунків: усе, що вміє екран, в одному
   погляді, без гортання по колу. Відкривається довгим дотиком по будь-якому
   вільному місцю, плиткою «Екрани» у швидких діях — або самим ботом, якщо
   його попросити («покажи годинник»). */

const layerApps = $("layerApps");
const appsGrid = $("appsGrid");

/* Спільний словник із бекендом (tools/screen_tools.py): ті самі id, щоб
   мозок і екран говорили однією мовою. */
const SCREENS = [
  { id: "face", labelKey: "screen.face", icon: "face" },
  { id: "clock", labelKey: "screen.clock", icon: "clock" },
  { id: "chat", labelKey: "screen.chat", icon: "mic" },
  { id: "timer", labelKey: "screen.timer", icon: "timer" },
  { id: "weather", labelKey: "screen.weather", icon: "sun" },
  { id: "say", labelKey: "screen.say", icon: "bubble" },
  { id: "state", labelKey: "screen.state", icon: "gauge" },
  { id: "quick", labelKey: "screen.quick", icon: "sliders" },
  // Далі — не екрани, а справжні дії пристрою
  { id: "camera", labelKey: "screen.camera", icon: "camera", app: true },
  { id: "services", labelKey: "screen.services", icon: "server", app: true },
  { id: "panel", labelKey: "screen.panel", icon: "monitor", app: true },
  { id: "settings", labelKey: "screen.settings", icon: "settings", app: true },
  { id: "memory", labelKey: "screen.memory", icon: "memory", app: true },
  { id: "chats", labelKey: "screen.chats", icon: "history", app: true },
  { id: "store", labelKey: "screen.store", icon: "store", app: true },
  // Встановлені з магазину застосунки дописує refreshInstalledApps()
];

function appsOpen() {
  return layer === "apps";
}

function openApps() {
  openLayer("apps");
  wake();
}

function closeApps() {
  if (layer === "apps") openLayer(null);
}

function renderApps() {
  appsGrid.innerHTML = "";
  const all = SCREENS.concat(installedApps);
  for (const scr of all) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-tile";
    const here = !scr.app && tiles[tileIndex] &&
      tiles[tileIndex].dataset.tile === scr.id;
    btn.classList.toggle("on", here);

    const circle = document.createElement("span");
    circle.className = "app-icon";
    circle.dataset.icon = scr.icon;
    /* Колір КІЛЬЦЯ плитки. У білій темі білий переважує навіть власний
       колір застосунку з магазину: інакше серед сірих кружечків двоє
       (метроном, малювання) світились золотим і бірюзовим — і виглядало це
       не як задум, а як недомитий стиль. */
    const style = activeIconStyle();
    // У стилі паку іконка вже сама кольоровий кружечок, тому наше кільце
    // під нею дало б кружечок у кружечку — як значок на значку. Клас
    // app-icon-bare прибирає тло й обідок, і плитка виглядає як у лаунчері.
    circle.classList.toggle("app-icon-bare", style === "pack" && PACK_ICON_SLOTS.includes(scr.icon));
    const tint = style === "white"
      ? monoStroke()
      : scr.tint || (style === "color"
        ? (ICON_COLORS[scr.icon] || iconTint)
        : style === "pixel"
          ? (PIXEL_ICON_TINTS[scr.icon] || iconTint)
          : iconTint);
    circle.style.setProperty("--app-tint", tint);
    circle.appendChild(drawerIcon(scr.icon, here));
    btn.appendChild(circle);

    const lbl = document.createElement("span");
    lbl.className = "app-name";
    // Свої екрани мають ключ, застосунки з магазину — власну назву з пакета
    lbl.textContent = scr.labelKey ? t(scr.labelKey) : scr.label;
    btn.appendChild(lbl);

    btn.addEventListener("click", () => { closeApps(); showScreen(scr.id); });
    appsGrid.appendChild(btn);
  }
}

/* Єдина точка переходу «за назвою» — нею користуються і лаунчер, і бот.
   Прибираємо ВСЕ, що лежить зверху: інакше бот на прохання «покажи стан»
   чесно перемикав тайл, але його закривав відкритий застосунок, і зовні
   це виглядало так, ніби команда не спрацювала. */
function showScreen(id) {
  closeAppLayer();
  if (modeSheet) modeSheet.classList.add("hidden");
  if (id === "apps") { openApps(); return; }
  if (id === "camera") { closeApps(); openCamera(); return; }
  if (id === "services") { closeApps(); openServices(); return; }
  if (id === "settings") { closeApps(); openSettings(); return; }
  if (id === "panel") { closeApps(); openPanel(); return; }
  if (id === "memory") { closeApps(); openMemory(); return; }
  if (id === "chats") { closeApps(); openChats(); return; }
  if (id === "store") { closeApps(); openStore(); return; }
  if (id === "quick") { openLayer("quick"); return; }
  // Застосунок, встановлений з магазину: id виглядає як "app:metronome"
  if (typeof id === "string" && id.startsWith("app:")) {
    const entry = installedApps.find((a) => a.id === id);
    if (entry) { closeApps(); openStoreApp(entry); return; }
  }
  let idx = tiles.findIndex((t) => t.dataset.tile === id);
  if (idx === -1 && allTiles.some((t) => t.dataset.tile === id)) {
    // Hidden from the carousel, but asked for by name ("show the timer"):
    // the person clearly wants it back, so it rejoins the carousel.
    setTileShown(id, true);
    idx = tiles.findIndex((t) => t.dataset.tile === id);
  }
  if (idx === -1) return;
  closeApps();
  openLayer(null);
  goTile(idx);
  wake();
}

document.querySelector("[data-apps-close]").addEventListener("click", closeApps);

/* Довгий дотик по вільному місцю — виклик лаунчера. Кнопки й прокрутка
   не рахуються (там свої дії), інакше меню вискакувало б посеред розмови. */
(function initAppsGesture() {
  let holdTimer = 0;
  stage.addEventListener("pointerdown", (e) => {
    if (isInteractive(e.target) || e.target.closest?.("button") || appsOpen()) return;
    const pointerId = e.pointerId;
    holdTimer = setTimeout(() => {
      if (ptrStart?.pointerId === pointerId) {
        releaseStagePointer(pointerId);
        ptrStart = null;
      }
      openApps();
    }, 600);
  });
  const cancel = () => clearTimeout(holdTimer);
  stage.addEventListener("pointerup", cancel);
  stage.addEventListener("pointermove", cancel);
  stage.addEventListener("pointercancel", cancel);
})();


/* ---------- Застосунки поверх екранів (камера, сервіси) ----------
   Це вже не «екрани карусельки», а окремі штуки з власним вмістом —
   тому окремий шар, а не ще один тайл: карусель має лишатись короткою,
   інакше гортати її стає гірше, ніж відкрити шухляду. */

const layerApp = $("layerApp");
const appBody = $("appBody");
let camTimer = 0;

/* Пакет, у якому живе відео-плеєр, і команда, що чекає на завантаження
   його iframe. Оголошені тут, а не поруч із onVideoCommand нижче: ними
   користується closeAppLayer, і тримати об'яву після першого вжитку —
   значить залежати від того, що скрипт устигне доїхати до кінця. */
const VIDEO_PKG = "youtube";
let videoPending = null;

/* titleKey — ключ словника; невідомий ключ t() віддає як є, тому сюди
   спокійно йде і власна назва застосунку з магазину. Пару (ключ, build)
   памʼятаємо: після зміни мови шар перезбирається тим самим build. */
let openApp = null;

function openAppLayer(titleKey, build) {
  clearTimeout(camTimer);
  applyFrost(layerApp);
  openApp = { key: titleKey, build };
  $("appTitle").textContent = t(titleKey);
  appBody.innerHTML = "";
  // The body element is reused by every app: a class or inline padding one
  // app set (the store does both) would otherwise frame the next app's
  // iframe in a border it never asked for.
  appBody.className = "app-body";
  appBody.removeAttribute("style");
  build(appBody);
  layerApp.classList.add("open");
  stage.classList.add("layered");
  wake();
}

function closeAppLayer() {
  clearTimeout(camTimer);
  // Плеєр відео вмирає разом з iframe, тож про це треба сказати бекенду
  // САМЕ тут: інакше бот ще пів хвилини відповідав би «грає ролик про…»,
  // дивлячись на застарілий стан (unload в iframe не гарантований).
  if (layerApp.querySelector(".storeapp-frame")?.dataset.pkg === VIDEO_PKG) {
    videoPending = null;
    fetch("/api/video/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ closed: true }),
    }).catch(() => {});
  }
  openApp = null;
  layerApp.classList.remove("open");
  appBody.innerHTML = "";                 // MJPEG-стрім інакше тягнеться далі
  if (!layer && !appsOpen()) stage.classList.remove("layered");
}

document.querySelector("[data-app-close]").addEventListener("click", closeAppLayer);

/* --- Камера: потік беремо НАПРЯМУ з Vision (8000), не через бекенд --- */
function openCamera() {
  openAppLayer("screen.camera", (box) => {
    const view = document.createElement("div");
    view.className = "cam-view";
    const note = document.createElement("div");
    note.className = "cam-note";
    note.textContent = t("cam.checking");
    box.appendChild(view);
    box.appendChild(note);

    fetch("/api/status").then((r) => r.json()).then((st) => {
      if (st.vision) {
        const img = document.createElement("img");
        img.alt = t("cam.stream");
        const streamUrl = new URL("/vision/stream.mjpg", window.location.origin);
        streamUrl.port = "8000";
        img.src = streamUrl.href;
        img.onerror = () => { note.textContent = t("cam.failed"); };
        view.appendChild(img);
        note.textContent = t("cam.live");
        return;
      }
      note.textContent = t("cam.off");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta";
      btn.style.alignSelf = "center";
      btn.textContent = t("cam.start");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        note.textContent = t("cam.starting");
        try {
          await fetch("/api/services/vision/start", { method: "POST" });
          // Сервіс піднімається не миттєво — перевіряємо трохи згодом
          camTimer = setTimeout(openCamera, 2500);
        } catch (e) {
          note.textContent = t("cam.startFailed");
          btn.disabled = false;
        }
      });
      box.appendChild(btn);
    }).catch(() => { note.textContent = t("cam.noLink"); });
  });
}

/* --- Сервіси: старт/стоп того, з чого складається «тіло» бота --- */
function openServices() {
  openAppLayer("screen.services", (box) => {
    const rows = {};
    for (const [id, label] of [["vision", t("svc.vision")], ["display", t("svc.display")]]) {
      const row = document.createElement("div");
      row.className = "svc-row";
      const name = document.createElement("span");
      name.className = "svc-name";
      name.textContent = label;
      const state = document.createElement("span");
      state.className = "svc-state";
      state.textContent = "…";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta";
      btn.style.margin = "0";
      btn.textContent = t("svc.start");
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        state.textContent = btn.dataset.action === "stop" ? t("svc.stopping") : t("svc.starting");
        try {
          await fetch("/api/services/" + id + "/" + (btn.dataset.action || "start"), { method: "POST" });
        } catch (e) { /* стан оновимо наступним опитуванням */ }
        setTimeout(refresh, 1500);
      });
      row.appendChild(name);
      row.appendChild(state);
      row.appendChild(btn);
      box.appendChild(row);
      rows[id] = { state, btn };
    }

    const note = document.createElement("div");
    note.className = "cam-note";
    note.style.textAlign = "left";
    note.textContent = t("svc.note");
    box.appendChild(note);

    async function refresh() {
      let data = {};
      try {
        const r = await fetch("/api/services");
        data = await r.json();
      } catch (e) {
        for (const id in rows) rows[id].state.textContent = t("state.noLink");
        return;
      }
      const src = data.services || data || {};
      for (const id in rows) {
        const raw = src[id];
        const on = typeof raw === "object" && raw ? !!(raw.running || raw.alive) : !!raw;
        rows[id].state.textContent = on ? t("state.running") : t("state.stopped");
        rows[id].state.className = "svc-state" + (on ? " on" : "");
        rows[id].btn.textContent = on ? t("svc.stop") : t("svc.start");
        rows[id].btn.dataset.action = on ? "stop" : "start";
        rows[id].btn.disabled = false;
      }
    }
    refresh();
  });
}

async function fetchAppJson(url) {
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.detail || data.error || data.message || ("HTTP " + response.status);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function appAccessError(error, subject) {
  if (error && error.status === 401) return t("err.needLogin", { subject });
  if (error && error.status === 403) return t("err.forbidden", { subject });
  return t("err.failed", { subject });
}

function appToolbar(parent, refresh) {
  const toolbar = document.createElement("div");
  toolbar.className = "app-toolbar";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cta settings-test";
  button.textContent = t("common.refresh");
  button.addEventListener("click", refresh);
  toolbar.appendChild(button);
  parent.appendChild(toolbar);
  return { toolbar, button };
}

function openMemory() {
  openAppLayer("screen.memory", (box) => {
    box.classList.add("memory-body");
    const status = document.createElement("div");
    status.className = "cam-note app-status";
    const list = document.createElement("div");
    list.className = "memory-list";
    const reader = document.createElement("section");
    reader.className = "memory-reader hidden";
    const readerTitle = document.createElement("strong");
    const readerPath = document.createElement("span");
    readerPath.className = "memory-path";
    const content = document.createElement("pre");
    content.className = "memory-content";
    reader.appendChild(readerTitle);
    reader.appendChild(readerPath);
    reader.appendChild(content);
    appToolbar(box, loadFiles);
    box.appendChild(status);
    box.appendChild(list);
    box.appendChild(reader);

    async function openFile(path, button) {
      document.querySelectorAll(".memory-entry").forEach((item) => item.classList.remove("on"));
      if (button) button.classList.add("on");
      reader.classList.add("hidden");
      status.textContent = t("mem.reading");
      try {
        const data = await fetchAppJson("/api/memory/file?path=" + encodeURIComponent(path) + "&session_id=" + encodeURIComponent(sessionId));
        readerTitle.textContent = data.path ? data.path.split("/").pop().replace(/\.md$/i, "") : t("mem.note");
        readerPath.textContent = data.path || path;
        content.textContent = data.content || t("mem.noteEmpty");
        reader.classList.remove("hidden");
        status.textContent = t("mem.noteOpened");
      } catch (error) {
        status.textContent = appAccessError(error, t("mem.subjNote"));
      }
      wake();
    }

    async function loadFiles() {
      list.textContent = t("common.loading");
      try {
        const data = await fetchAppJson("/api/memory/list?session_id=" + encodeURIComponent(sessionId));
        const files = Array.isArray(data.files) ? data.files : [];
        list.innerHTML = "";
        if (!files.length) {
          list.textContent = t("mem.empty");
          status.textContent = t("mem.storeEmpty");
          return;
        }
        files.forEach((file) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "memory-entry";
          const title = document.createElement("strong");
          title.textContent = file.title || file.path;
          const path = document.createElement("span");
          path.className = "memory-path";
          path.textContent = file.path || "";
          button.appendChild(title);
          button.appendChild(path);
          button.addEventListener("click", () => openFile(file.path, button));
          list.appendChild(button);
        });
        status.textContent = t("mem.count", { n: files.length });
      } catch (error) {
        list.textContent = appAccessError(error, t("mem.subjMemory"));
        status.textContent = t("mem.noAccess");
      }
      wake();
    }

    loadFiles();
  });
}

function openChats() {
  openAppLayer("screen.chats", (box) => {
    box.classList.add("chats-body");
    const status = document.createElement("div");
    status.className = "cam-note app-status";
    const list = document.createElement("div");
    list.className = "session-browser-list";
    const reader = document.createElement("section");
    reader.className = "session-reader hidden";
    const readerTitle = document.createElement("strong");
    const messages = document.createElement("div");
    messages.className = "session-messages";
    reader.appendChild(readerTitle);
    reader.appendChild(messages);
    appToolbar(box, loadSessions);
    box.appendChild(status);
    box.appendChild(list);
    box.appendChild(reader);

    async function openChat(id, title, button) {
      document.querySelectorAll(".session-entry").forEach((item) => item.classList.remove("on"));
      if (button) button.classList.add("on");
      reader.classList.add("hidden");
      status.textContent = t("hist.reading");
      try {
        const data = await fetchAppJson("/api/sessions/" + encodeURIComponent(id));
        readerTitle.textContent = title || data.title || t("chat.title");
        messages.innerHTML = "";
        const history = Array.isArray(data.messages) ? data.messages : [];
        if (!history.length) {
          messages.textContent = t("hist.messagesEmpty");
        } else {
          history.slice(-30).forEach((message) => {
            const item = document.createElement("article");
            item.className = "app-message " + (message.role === "user" ? "user" : "assistant");
            const role = document.createElement("span");
            role.className = "app-message-role";
            role.textContent = message.role === "user" ? t("chat.you") : t("chat.bot");
            const text = document.createElement("div");
            text.className = "app-message-text";
            text.textContent = message.content || "";
            item.appendChild(role);
            item.appendChild(text);
            messages.appendChild(item);
          });
        }
        reader.classList.remove("hidden");
        status.textContent = t("hist.messagesCount", { n: history.length });
      } catch (error) {
        status.textContent = appAccessError(error, t("hist.subjChat"));
      }
      wake();
    }

    async function loadSessions() {
      list.textContent = t("common.loading");
      try {
        const data = await fetchAppJson("/api/sessions");
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        list.innerHTML = "";
        if (!sessions.length) {
          list.textContent = t("hist.empty");
          status.textContent = t("hist.storeEmpty");
          return;
        }
        sessions.forEach((session) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "session-entry";
          const title = document.createElement("strong");
          title.textContent = session.title || t("common.untitled");
          const meta = document.createElement("span");
          meta.className = "memory-path";
          meta.textContent = t("hist.messages", { n: session.count || 0 });
          button.appendChild(title);
          button.appendChild(meta);
          button.addEventListener("click", () => openChat(session.id, session.title, button));
          list.appendChild(button);
        });
        status.textContent = t("hist.count", { n: sessions.length });
      } catch (error) {
        list.textContent = appAccessError(error, t("hist.subjHistory"));
        status.textContent = t("mem.noAccess");
      }
      wake();
    }

    loadSessions();
  });
}

function openPanel() {
  openAppLayer("screen.panel", (box) => {
    box.classList.add("panel-body");
    const section = document.createElement("section");
    section.className = "settings-section";
    const head = document.createElement("div");
    head.className = "settings-section-head";
    const title = document.createElement("strong");
    title.textContent = t("panel.botState");
    const hint = document.createElement("span");
    hint.textContent = t("panel.local");
    head.appendChild(title);
    head.appendChild(hint);
    section.appendChild(head);

    const rows = {};
    for (const [id, label] of [["brain", t("state.brain")], ["vision", t("state.vision")], ["display", t("state.display")], ["link", t("state.link")]]) {
      const row = document.createElement("div");
      row.className = "svc-row";
      const name = document.createElement("span");
      name.className = "svc-name";
      name.textContent = label;
      const value = document.createElement("span");
      value.className = "svc-state";
      value.textContent = "…";
      value.setAttribute("role", "status");
      value.setAttribute("aria-live", "polite");
      row.appendChild(name);
      row.appendChild(value);
      section.appendChild(row);
      rows[id] = value;
    }
    box.appendChild(section);

    const actions = document.createElement("div");
    actions.className = "panel-actions";
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "cta settings-test";
    refresh.textContent = t("common.refresh");
    refresh.addEventListener("click", refreshPanel);
    const services = document.createElement("button");
    services.type = "button";
    services.className = "cta settings-test";
    services.textContent = t("screen.services");
    services.addEventListener("click", openServices);
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "cta settings-test";
    settings.textContent = t("screen.settings");
    settings.addEventListener("click", openSettings);
    actions.appendChild(refresh);
    actions.appendChild(services);
    actions.appendChild(settings);
    box.appendChild(actions);

    async function refreshPanel() {
      refresh.disabled = true;
      try {
        const [statusResponse, servicesResponse] = await Promise.all([
          fetch("/api/status"),
          fetch("/api/services"),
        ]);
        if (!statusResponse.ok || !servicesResponse.ok) throw new Error("panel status unavailable");
        const status = await statusResponse.json();
        const serviceData = await servicesResponse.json();
        const serviceState = serviceData.services || serviceData || {};
        const brainOn = !!status.mode && status.mode !== "demo";
        const linkOn = $("linkDot").classList.contains("on");
        rows.brain.textContent = status.mode ? brainLabel(status.mode) : t("state.offline");
        rows.brain.classList.toggle("on", brainOn);
        rows.link.textContent = linkOn ? t("state.alive") : t("common.none");
        rows.link.classList.toggle("on", linkOn);
        for (const id of ["vision", "display"]) {
          const raw = serviceState[id];
          const on = raw === undefined
            ? !!status[id]
            : (typeof raw === "object" && raw ? !!(raw.running || raw.alive) : !!raw);
          rows[id].textContent = on ? t("state.running") : t("state.stopped");
          rows[id].classList.toggle("on", on);
        }
      } catch (e) {
        Object.values(rows).forEach((value) => {
          value.textContent = t("state.noLink");
          value.classList.remove("on");
        });
      }
      refresh.disabled = false;
    }
    refreshPanel();
  });
}

function resetScreenPrefs() {
  [THEME_KEY, BRIGHT_KEY, VOL_KEY, VOICE_KEY, ORDER_KEY, ICON_KEY, ICON_TINT_KEY, TILES_KEY,
    IDLE_HOME_KEY, IDLE_SLEEP_KEY, CLOCK_FORMAT_KEY, CLOCK_DATE_KEY, MOTION_KEY,
    SKIN_KEY, SKIN_VARS_KEY, PROVIDER_KEY]
    .forEach(removePref);
  document.documentElement.dataset.theme = "dark";
  document.documentElement.dataset.motion = "full";
  iconStyle = "auto";
  iconTint = DEFAULT_ICON_TINT;
  bright = 100;
  volume = 70;
  idleHomeMs = DEFAULT_IDLE_HOME_MS;
  idleSleepMs = DEFAULT_IDLE_SLEEP_MS;
  clockFormat = "24";
  showClockDate = true;
  reducedMotion = false;
  voiceOn = true;                 // той самий дефолт, що й на першому запуску
  voiceSpeed = 1;
  editing = false;
  picked = null;
  quickOrder = DEFAULT_ORDER.slice();
  applySkinVars(null);
  musicState.provider = "youtube";
  applyBright(bright);
  applyVolume(volume);
  tickClock();
  wake();
  voiceAudio.pause();
  rebuildIcons();
  renderQuickTiles();
  applyTileLayout();
}

function openSettings() {
  openAppLayer("screen.settings", (box) => {
    const langButtons = [];
    const styleButtons = [];
    const tintButtons = [];
    const themeButtons = [];
    const voiceSelect = document.createElement("select");
    const voiceState = document.createElement("span");
    const styleState = document.createElement("span");
    const tintState = document.createElement("span");
    const themeState = document.createElement("span");
    const brightRangeSettings = document.createElement("input");
    const brightValue = document.createElement("span");
    const voiceToggle = document.createElement("button");
    const volumeRangeSettings = document.createElement("input");
    const volumeValue = document.createElement("span");
    const testVoice = document.createElement("button");
    const idleHomeSelect = document.createElement("select");
    const idleSleepSelect = document.createElement("select");
    const clockFormatSelect = document.createElement("select");
    const captionModeSelect = document.createElement("select");
    const dateToggle = document.createElement("button");
    const motionToggle = document.createElement("button");
    const note = document.createElement("div");

    box.classList.add("settings-body");

    function section(title, hint) {
      const el = document.createElement("section");
      el.className = "settings-section";
      const head = document.createElement("div");
      head.className = "settings-section-head";
      const name = document.createElement("strong");
      name.textContent = title;
      head.appendChild(name);
      if (hint) {
        const small = document.createElement("span");
        small.textContent = hint;
        head.appendChild(small);
      }
      el.appendChild(head);
      box.appendChild(el);
      return el;
    }

    function row(parent, title, hint) {
      const el = document.createElement("div");
      el.className = "settings-row";
      const copy = document.createElement("div");
      copy.className = "settings-copy";
      const name = document.createElement("strong");
      name.textContent = title;
      copy.appendChild(name);
      if (hint) {
        const small = document.createElement("span");
        small.textContent = hint;
        copy.appendChild(small);
      }
      el.appendChild(copy);
      parent.appendChild(el);
      return el;
    }

    function fillSelect(select, options) {
      select.className = "settings-select";
      select.innerHTML = "";
      options.forEach((item) => {
        const option = document.createElement("option");
        option.value = item.value;
        option.textContent = item.key ? t(item.key, item.n === undefined ? null : { n: item.n }) : item.label;
        select.appendChild(option);
      });
      return select;
    }

    function setupSwitch(button, onText, offText, onChange) {
      button.type = "button";
      button.className = "settings-switch";
      button.addEventListener("click", () => {
        onChange();
        sync();
        wake();
      });
      button.dataset.onText = onText;
      button.dataset.offText = offText;
      button.setAttribute("aria-pressed", "false");
      return button;
    }

    const appearance = section(t("set.appearance"), t("set.appearance.hint"));

    // Мова — першим рядком «Вигляду»: її шукають саме тут, і саме вона
    // вирішує, якою мовою читається решта цього списку
    const langRow = row(appearance, t("set.lang"), t("set.lang.hint"));
    const langGrid = document.createElement("div");
    langGrid.className = "settings-choices settings-choices-two";
    for (const item of LANGS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = item.label;
      button.addEventListener("click", () => {
        // setLang сам перемальовує екран і перевідкриває ці налаштування
        if (!setLang(item.value)) sync();
      });
      langButtons.push({ id: item.value, button });
      langGrid.appendChild(button);
    }
    langRow.appendChild(langGrid);

    const styleRow = row(appearance, t("set.iconStyle"), t("set.iconStyle.hint"));
    const styleGrid = document.createElement("div");
    styleGrid.className = "settings-choices";
    for (const [id, key] of Object.entries(ICON_STYLES)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = t(key);
      button.addEventListener("click", () => { setIconStyle(id); sync(); });
      styleButtons.push({ id, button });
      styleGrid.appendChild(button);
    }
    styleRow.appendChild(styleGrid);

    const tintRow = row(appearance, t("set.color"), t("set.color.hint"));
    const tintGrid = document.createElement("div");
    tintGrid.className = "settings-swatches";
    for (const item of ICON_TINTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-swatch";
      button.style.background = item.value;
      button.title = t(item.key);
      button.setAttribute("aria-label", t(item.key));
      button.addEventListener("click", () => { setIconTint(item.value); sync(); });
      tintButtons.push({ value: item.value, button });
      tintGrid.appendChild(button);
    }
    tintRow.appendChild(tintGrid);

    const themeRow = row(appearance, t("set.theme"), t("set.theme.hint"));
    const themeGrid = document.createElement("div");
    themeGrid.className = "settings-choices settings-choices-two";
    for (const [id, label] of [["dark", t("set.theme.dark")], ["light", t("set.theme.light")]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = label;
      button.addEventListener("click", () => {
        document.documentElement.dataset.theme = id;
        writePref(THEME_KEY, id);
        applyTheme();
        sync();
      });
      themeButtons.push({ id, button });
      themeGrid.appendChild(button);
    }
    themeRow.appendChild(themeGrid);

    const display = section(t("set.display"), t("set.display.hint"));
    const brightRow = row(display, t("set.bright"), t("set.bright.hint"));
    brightRangeSettings.type = "range";
    brightRangeSettings.className = "settings-range";
    brightRangeSettings.min = "15";
    brightRangeSettings.max = "100";
    brightRangeSettings.step = "1";
    brightRangeSettings.addEventListener("input", () => {
      applyBright(brightRangeSettings.value);
      writePref(BRIGHT_KEY, bright);
      sync();
      wake();
    });
    brightRow.appendChild(brightRangeSettings);
    brightValue.className = "settings-value";
    brightRow.appendChild(brightValue);

    /* Screens: which tiles the carousel shows and in what order. Arrows,
       not drag-and-drop — a resistive panel misreads drags. Rebuilt in
       place after each change, since the order is the list itself. */
    const screensBox = section(t("set.screens"), t("set.screens.hint"));
    const screensList = document.createElement("div");
    screensList.className = "tiles-list";
    screensBox.appendChild(screensList);
    function renderScreensList() {
      screensList.innerHTML = "";
      const layout = tileLayout();
      layout.order.forEach((id, i) => {
        const line = document.createElement("div");
        line.className = "tiles-row" + (layout.hidden.has(id) ? " off" : "");
        const name = document.createElement("span");
        name.className = "tiles-name";
        name.textContent = t("screen." + id);
        line.appendChild(name);
        const home = id === HOME_TILE;
        const arrow = (icon, step, disabled, key) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "tiles-move " + (step < 0 ? "up" : "down");
          btn.disabled = disabled;
          btn.setAttribute("aria-label", t(key));
          btn.appendChild(makeSvgIcon(icon));
          btn.addEventListener("click", () => { moveTile(id, step); renderScreensList(); wake(); });
          return btn;
        };
        line.appendChild(arrow("prev", -1, home || i <= 1, "set.screens.up"));
        line.appendChild(arrow("next", 1, home || i === layout.order.length - 1, "set.screens.down"));
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "settings-switch" + (layout.hidden.has(id) ? "" : " on");
        toggle.disabled = home;
        toggle.textContent = home ? t("set.screens.home") : t(layout.hidden.has(id) ? "set.screens.hidden" : "set.screens.shown");
        toggle.setAttribute("aria-pressed", String(!layout.hidden.has(id)));
        toggle.addEventListener("click", () => { setTileShown(id, layout.hidden.has(id)); renderScreensList(); wake(); });
        line.appendChild(toggle);
        screensList.appendChild(line);
      });
    }
    renderScreensList();

    // The weather tile's home city. A short list instead of typing: this
    // screen has no keyboard. Any other city — ask the bot, and the tile
    // shows its answer.
    const cityRow = row(screensBox, t("set.weatherCity"), t("set.weatherCity.hint"));
    const cityGrid = document.createElement("div");
    cityGrid.className = "settings-choices";
    for (const item of WEATHER_CITIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = t(item.key);
      button.addEventListener("click", () => {
        cityGrid.querySelectorAll(".settings-choice").forEach((b) => b.classList.toggle("on", b === button));
        setWeatherCity(item.city);
        wake();
      });
      cityGrid.appendChild(button);
    }
    cityRow.appendChild(cityGrid);

    const behavior = section(t("set.behavior"), t("set.behavior.hint"));
    const homeRow = row(behavior, t("set.home"), t("set.home.hint"));
    fillSelect(idleHomeSelect, IDLE_HOME_OPTIONS);
    idleHomeSelect.addEventListener("change", () => {
      idleHomeMs = Number(idleHomeSelect.value);
      writePref(IDLE_HOME_KEY, idleHomeSelect.value);
      wake();
      sync();
    });
    homeRow.appendChild(idleHomeSelect);

    const sleepRow = row(behavior, t("set.sleep"), t("set.sleep.hint"));
    fillSelect(idleSleepSelect, IDLE_SLEEP_OPTIONS);
    idleSleepSelect.addEventListener("change", () => {
      idleSleepMs = Number(idleSleepSelect.value);
      writePref(IDLE_SLEEP_KEY, idleSleepSelect.value);
      wake();
      sync();
    });
    sleepRow.appendChild(idleSleepSelect);

    const clockRow = row(behavior, t("set.clock"), t("set.clock.hint"));
    fillSelect(clockFormatSelect, CLOCK_FORMAT_OPTIONS);
    clockFormatSelect.addEventListener("change", () => {
      clockFormat = clockFormatSelect.value;
      writePref(CLOCK_FORMAT_KEY, clockFormat);
      tickClock();
      sync();
    });
    clockRow.appendChild(clockFormatSelect);

    // Субтитр: сам зникає чи чекає на хрестик. Рядок саме тут, а не в
    // «Вигляді»: це поведінка, а не оформлення.
    const captionRow = row(behavior, t("set.caption"), t("set.caption.hint"));
    fillSelect(captionModeSelect, CAPTION_MODE_OPTIONS);
    captionModeSelect.addEventListener("change", () => {
      captionMode = validOption(captionModeSelect.value, CAPTION_MODE_OPTIONS, "auto");
      writePref(CAPTION_MODE_KEY, captionMode);
      // Перемикач діє на субтитр, що вже на екрані: у ручному режимі
      // з’являється хрестик, в авто — знову вмикається таймер
      if (!faceCaption.classList.contains("hidden")) armCaptionHide(captionRaw.length);
      sync();
    });
    captionRow.appendChild(captionModeSelect);

    const dateRow = row(behavior, t("set.date"), t("set.date.hint"));
    setupSwitch(dateToggle, t("set.date.on"), t("set.date.off"), () => {
      showClockDate = !showClockDate;
      writePref(CLOCK_DATE_KEY, showClockDate ? "1" : "0");
      tickClock();
    });
    dateRow.appendChild(dateToggle);

    const motionRow = row(behavior, t("set.motion"), t("set.motion.hint"));
    setupSwitch(motionToggle, t("set.motion.on"), t("set.motion.off"), () => {
      applyMotion(reducedMotion ? "full" : "reduced");
      writePref(MOTION_KEY, reducedMotion ? "reduced" : "full");
    });
    motionRow.appendChild(motionToggle);

    const audio = section(t("set.audio"), t("set.audio.hint"));
    const voiceRow = row(audio, t("set.tts"), t("set.tts.hint"));
    voiceToggle.type = "button";
    voiceToggle.className = "settings-switch";
    voiceToggle.addEventListener("click", () => { toggleVoice(); sync(); });
    voiceRow.appendChild(voiceToggle);

    const volumeRow = row(audio, t("set.volume"), t("set.volume.hint"));
    volumeRangeSettings.type = "range";
    volumeRangeSettings.className = "settings-range";
    volumeRangeSettings.min = "0";
    volumeRangeSettings.max = "100";
    volumeRangeSettings.step = "1";
    volumeRangeSettings.addEventListener("input", () => {
      applyVolume(volumeRangeSettings.value);
      writePref(VOL_KEY, volume);
      sync();
      wake();
    });
    volumeRow.appendChild(volumeRangeSettings);
    volumeValue.className = "settings-value";
    volumeRow.appendChild(volumeValue);

    const voiceChoiceRow = row(audio, t("set.piper"), t("set.piper.hint"));
    voiceSelect.className = "settings-select";
    voiceSelect.addEventListener("change", async () => {
      try {
        const response = await fetch("/api/tts/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speaker: Number(voiceSelect.value) }),
        });
        if (!response.ok) throw new Error("voice " + response.status);
        voiceState.textContent = t("set.saved");
      } catch (e) {
        voiceState.textContent = t("set.saveFailed");
      }
      sync();
    });
    voiceChoiceRow.appendChild(voiceSelect);

    testVoice.type = "button";
    testVoice.className = "cta settings-test";
    testVoice.textContent = t("set.testVoice");
    testVoice.addEventListener("click", async () => {
      if (!voiceOn || !ttsAvailable) return;
      testVoice.disabled = true;
      note.textContent = t("set.testSpeaking");
      await speak(t("set.testPhrase"));
      note.textContent = t("set.testDone");
      sync();
    });
    audio.appendChild(testVoice);

    const actions = section(t("set.actions"), t("set.actions.hint"));
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-reset";
    reset.textContent = t("set.reset");
    reset.addEventListener("click", () => {
      if (typeof window.confirm === "function" && !window.confirm(t("set.resetAsk"))) return;
      resetScreenPrefs();
      note.textContent = t("set.resetDone");
      sync();
    });
    actions.appendChild(reset);

    const attribution = document.createElement("div");
    attribution.className = "settings-note settings-attribution";
    attribution.textContent = t("set.attribution");
    const pxlkit = document.createElement("a");
    pxlkit.href = "https://pxlkit.xyz";
    pxlkit.target = "_blank";
    pxlkit.rel = "noreferrer";
    pxlkit.textContent = "Pxlkit";
    attribution.appendChild(pxlkit);
    attribution.appendChild(document.createTextNode("."));
    box.appendChild(attribution);

    note.className = "settings-note";
    box.appendChild(note);

    function sync() {
      langButtons.forEach(({ id, button }) => button.classList.toggle("on", id === getLang()));
      styleButtons.forEach(({ id, button }) => button.classList.toggle("on", id === iconStyle));
      tintButtons.forEach(({ value, button }) => button.classList.toggle("on", value === iconTint));
      themeButtons.forEach(({ id, button }) => button.classList.toggle("on", id === document.documentElement.dataset.theme));
      styleState.textContent = t(ICON_STYLES[iconStyle]);
      const tint = ICON_TINTS.find((item) => item.value === iconTint);
      tintState.textContent = tint ? t(tint.key) : t("set.customColor");
      themeState.textContent = document.documentElement.dataset.theme === "light" ? t("set.theme.light") : t("set.theme.dark");
      idleHomeSelect.value = String(idleHomeMs);
      idleSleepSelect.value = String(idleSleepMs);
      clockFormatSelect.value = clockFormat;
      captionModeSelect.value = captionMode;
      dateToggle.textContent = showClockDate ? dateToggle.dataset.onText : dateToggle.dataset.offText;
      dateToggle.classList.toggle("on", showClockDate);
      dateToggle.setAttribute("aria-pressed", String(showClockDate));
      motionToggle.textContent = reducedMotion ? motionToggle.dataset.offText : motionToggle.dataset.onText;
      motionToggle.classList.toggle("on", !reducedMotion);
      motionToggle.setAttribute("aria-pressed", String(!reducedMotion));
      brightRangeSettings.value = String(bright);
      brightValue.textContent = bright + "%";
      volumeRangeSettings.value = String(volume);
      volumeValue.textContent = ttsAvailable ? volume + "%" : t("common.none");
      voiceToggle.disabled = !ttsAvailable;
      voiceToggle.textContent = !ttsAvailable ? t("set.unavailable") : (voiceOn ? t("set.enabled") : t("set.disabled"));
      voiceToggle.classList.toggle("on", voiceOn && ttsAvailable);
      volumeRangeSettings.disabled = !ttsAvailable;
      testVoice.disabled = !voiceOn || !ttsAvailable;
      voiceSelect.disabled = !ttsAvailable || !voiceSelect.options.length;
    }

    styleState.className = "settings-inline-value";
    tintState.className = "settings-inline-value";
    themeState.className = "settings-inline-value";
    styleRow.querySelector(".settings-copy").appendChild(styleState);
    tintRow.querySelector(".settings-copy").appendChild(tintState);
    themeRow.querySelector(".settings-copy").appendChild(themeState);
    voiceRow.querySelector(".settings-copy").appendChild(voiceState);
    sync();

    fetch("/api/tts/status")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("tts " + response.status)))
      .then((data) => {
        ttsAvailable = !!data.enabled;
        voiceSelect.innerHTML = "";
        (data.voices || []).forEach((voice) => {
          const option = document.createElement("option");
          option.value = String(voice.id);
          option.textContent = voice.name + (voice.hint ? " — " + voice.hint : "");
          option.selected = Number(data.selected) === Number(voice.id);
          voiceSelect.appendChild(option);
        });
        sync();
      })
      .catch(() => {
        ttsAvailable = false;
        voiceState.textContent = t("set.ttsOffline");
        sync();
      });
  });
}

/* ---------- Now Playing: музика внизу екрана ----------
   Джерела:
     youtube — пошук робить МОЗОК (тул play_music): «Клод, увімкни …».
               Аудіо тягнеться з /api/music/stream — проксі з Range, тому
               перемотка працює по-справжньому;
     radio   — живі потоки (SomaFM тощо), тапаються прямо зі списку.
               Живе мовлення не перемотується — повзунок ховаємо.

   Бар видно з будь-якого тайла й з'являється лише коли є трек: він
   заміняє крапки-індикатори (.stage.np), а тайли піднімають вміст.
   Ядро стану плеєра — вгорі файлу (гучність/ducking); тут — UI. */

musicState.provider = readPref(PROVIDER_KEY, "youtube");
if (!PROVIDERS[musicState.provider]) musicState.provider = "youtube";

function npClipEl(kind) {
  return kind === "bar" ? $("npTitleBtn") : $("npNow");
}

/* Стрічка-заголовок: дві копії тексту, поки влазить — одна. Швидкість
   пропорційна довжині (однакова швидкість пікселів/с), межі 10..60 с.

   Було 22 px/с — назву фізично не встигали прочитати, вона проскакувала
   швидше, ніж око доходить до кінця. 10 px/с — це темп рядка, який читаєш
   спокійно; для 320 px екрана повний прохід виходить ~30 с. */
function npMarquee(holder, clip) {
  const trackEl = clip.querySelector(".np-track");
  const textEl = trackEl.querySelector(".np-text");
  if (!trackEl || !textEl) return;
  if (trackEl.children.length < 2) {
    const dup = textEl.cloneNode();
    dup.setAttribute("aria-hidden", "true");
    trackEl.appendChild(dup);
  }
  const copies = trackEl.querySelectorAll(".np-text");
  copies.forEach((el) => { el.textContent = textEl.textContent; });
  const oneCopy = textEl.offsetWidth;          // уже з padding-right
  if (oneCopy > clip.clientWidth - 4) {
    holder.classList.add("rolling");
    trackEl.classList.remove("single");
    holder.style.setProperty("--np-dur", Math.max(10, Math.min(60, oneCopy / 10)) + "s");
  } else {
    holder.classList.remove("rolling");
    trackEl.classList.add("single");
  }
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return "—:—";
  sec = Math.round(sec);
  return Math.floor(sec / 60) + ":" + two(sec % 60);
}

function providerIconName() {
  return musicState.track ? PROVIDERS[musicState.track.provider].icon : "music";
}

function updateNpChrome() {
  // Іконки провайдера й play/pause в барі та в шіті — у поточному стилі
  const slots = [
    ["npProviderIco", providerIconName(), 2],
    ["npToggleIco", musicState.playing ? "pause" : "play", 2],
    ["npBigIco", musicState.playing ? "pause" : "play", 3],
    ["npPrevIco", "prev", 2],
    ["npNextIco", "next", 2],
    ["npProvYoutubeIco", "youtube", 2],
    ["npProvRadioIco", "radio", 2],
  ];
  for (const [id, name, cell] of slots) {
    const host = $(id);
    if (!host) continue;
    const old = host.querySelector(".pxicon, .svgicon");
    if (old) old.remove();
    host.appendChild(uiIcon(name, { cell }));
  }
  document.querySelectorAll("#npProviders .np-provider-chip").forEach((chip) => {
    chip.classList.toggle("on", chip.dataset.provider === musicState.provider);
  });
}

function updateNpText() {
  const title = musicState.track
    ? (musicState.track.title || t("common.untitled"))
    : t("music.off");
  $("npText").textContent = title;
  $("npNowTitle").textContent = title;
  $("npNowSub").textContent = musicState.track
    ? (musicState.track.uploader || (musicState.live ? t("music.liveStream") : ""))
    : t("music.hintOff");
  npMarquee($("nowPlaying"), npClipEl("bar"));
  npMarquee($("npNow"), npClipEl("sheet"));
}

function updateNpSeek() {
  const seek = $("npSeek");
  const isLive = musicState.live && musicState.track;
  seek.disabled = isLive || !musicState.track;
  // Тривалість знаємо ще з пошуку — показуємо ЇЇ, поки метадані потоку в
  // дорозі. Інакше на весь час розвʼязування ссилки в таймлайні стояло
  // «—:—», тобто плеєр виглядав зламаним, хоч і працював.
  const known = musicState.track && Number(musicState.track.duration) > 0
    ? Number(musicState.track.duration) : 0;
  const total = musicAudio.duration > 0 ? musicAudio.duration : known;
  // Позиція 0 — це «0:00», а не «—:—»: fmtTime ховає нулі, бо для ТРИВАЛОСТІ
  // нуль означає «невідомо», а для поточного часу — початок трека.
  $("npCur").textContent = musicState.track
    ? (musicAudio.currentTime > 0 ? fmtTime(musicAudio.currentTime) : "0:00")
    : "—:—";
  $("npDur").textContent = musicState.track ? (isLive ? "LIVE" : fmtTime(total)) : "—:—";
  if (musicState.track && !musicState.seeking) {
    if (isLive) {
      $("npProgress").style.width = "100%";
      seek.value = "1000";
    } else if (total > 0) {
      const pct = Math.min(1, musicAudio.currentTime / total);
      seek.value = String(Math.round(pct * 1000));
      $("npProgress").style.width = (pct * 100).toFixed(1) + "%";
    }
  } else if (!musicState.track) {
    $("npProgress").style.width = "0";
  }
}

function showNpBar(show) {
  $("nowPlaying").classList.toggle("hidden", !show);
  stage.classList.toggle("np", !!show);
  if (show) updateNpText();
}

async function musicPlayTrack(track, opts) {
  const push = (opts || {}).queue !== false;
  musicState.track = track;
  musicState.live = track.provider === "radio";
  if (push && track.provider === "youtube") {
    // без дублів: той самий id переносять у хвіст черги
    musicState.queue = musicState.queue.filter((t) => t.id !== track.id);
    musicState.queue.push(track);
    if (musicState.queue.length > 12) musicState.queue.shift();
  }
  musicAudio.pause();
  musicAudio.src = track.provider === "radio"
    ? track.url
    : "/api/music/stream?provider=youtube&id=" + encodeURIComponent(track.id);
  syncMusicVolume();
  applyMusicRate();
  showNpBar(true);
  // Ссилку на аудіо бекенд розвʼязує через yt-dlp + інстанси Invidious, і це
  // легко 5-15 секунд. Показуємо це станом бару, а не тишею.
  setNpLoading(true);
  updateNpChrome();
  updateNpSeek();
  renderNpList();
  renderNpRates();
  try {
    musicState.playing = true;
    await musicAudio.play();
  } catch (e) {
    // Автоплей без жесту заблокований (напр., тап був всередині iframe
    // застосунка): показуємо паузу і домовляємось дограти на ПЕРШОМУ
    // дотику по екрану — користувач все одно щось тапне найближчим часом
    musicState.playing = false;
    const retry = () => {
      syncMusicVolume();
      musicAudio.play().catch(() => {});
    };
    stage.addEventListener("pointerdown", retry, { once: true });
  }
  updateNpChrome();
  if (musicSheetOpen) renderNpList();
}

function musicToggle() {
  if (!musicState.track) { openMusicSheet(); return; }
  wake();
  if (musicState.playing) {
    musicAudio.pause();
  } else {
    syncMusicVolume();
    musicAudio.play().catch(() => {});
  }
}

/* Стан «вантажу»: від моменту, коли поставили src, до першого реального
   звуку або помилки. Це єдиний спосіб відрізнити «бот думає» від «зламалось»
   на смузі, де немає місця для тексту. */
function setNpLoading(on) {
  $("nowPlaying").classList.toggle("np-loading", !!on);
}

musicAudio.addEventListener("loadedmetadata", () => { applyMusicRate(); });
musicAudio.addEventListener("playing", () => { setNpLoading(false); });
musicAudio.addEventListener("canplay", () => { setNpLoading(false); });
musicAudio.addEventListener("error", () => { setNpLoading(false); });
musicAudio.addEventListener("play", () => { musicState.playing = true; updateNpChrome(); });
musicAudio.addEventListener("pause", () => { musicState.playing = false; updateNpChrome(); });
musicAudio.addEventListener("playing", updateNpChrome);
musicAudio.addEventListener("loadedmetadata", updateNpSeek);
musicAudio.addEventListener("timeupdate", updateNpSeek);
musicAudio.addEventListener("error", () => {
  if (!musicState.track) return;
  showCaption(t("music.streamDied"), "bot");
  musicState.playing = false;
  updateNpChrome();
});
musicAudio.addEventListener("ended", () => {
  // Черга: після трека — попередній за списком (bot додає в хвіст)
  const q = musicState.queue;
  const idx = q.findIndex((t) => musicState.track && t.id === musicState.track.id);
  if (q.length > 1 && idx >= 0 && idx < q.length - 1) {
    musicPlayTrack(q[idx + 1]);
  } else {
    musicState.playing = false;
    updateNpChrome();
  }
});

function musicStep(dir) {
  const q = musicState.queue;
  if (!q.length) return;
  const idx = musicState.track ? q.findIndex((t) => t.id === musicState.track.id) : -1;
  const next = q[Math.max(0, Math.min(q.length - 1, (idx < 0 ? 0 : idx + dir)))];
  if (next) musicPlayTrack(next);
}

/* Шіт плеєра: вибір джерела, перемотка, список станцій/черги */

const musicSheet = $("musicSheet");
let musicSheetOpen = false;

function openMusicSheet() {
  musicSheetOpen = true;
  updateNpChrome();
  updateNpSeek();
  renderNpList();
  renderNpRates();
  musicSheet.classList.remove("hidden");
  wake();
}

function closeMusicSheet() {
  musicSheetOpen = false;
  musicSheet.classList.add("hidden");
}

function renderNpList() {
  const list = $("npList");
  list.innerHTML = "";
  if (musicState.provider === "radio") {
    // Радіо: список тягнемо з бекенда (це теж «каталог», але живий)
    list.textContent = t("common.loading");
    fetch("/api/music/radio").then((r) => r.json()).then((d) => {
      list.innerHTML = "";
      for (const st of d.stations || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "np-row-item" + (musicState.track && musicState.track.id === st.id ? " on" : "");
        const name = document.createElement("span");
        name.textContent = st.title;
        const sub = document.createElement("span");
        sub.className = "np-item-sub";
        sub.textContent = st.genre;
        btn.appendChild(name);
        btn.appendChild(sub);
        btn.addEventListener("click", () => {
          wake();
          musicPlayTrack({ provider: "radio", id: st.id, title: st.title, uploader: st.genre, url: st.url });
          renderNpList();
        });
        list.appendChild(btn);
      }
    }).catch(() => { list.textContent = t("music.radioOffline"); });
    return;
  }
  if (!musicState.queue.length) {
    const hint = document.createElement("div");
    hint.className = "np-hint";
    hint.textContent = t("music.queueHint");
    list.appendChild(hint);
    return;
  }
  for (const t of musicState.queue.slice().reverse()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "np-row-item" + (musicState.track && musicState.track.id === t.id ? " on" : "");
    const name = document.createElement("span");
    name.textContent = t.title;
    const sub = document.createElement("span");
    sub.className = "np-item-sub";
    sub.textContent = t.uploader || "";
    btn.appendChild(name);
    btn.appendChild(sub);
    btn.addEventListener("click", () => { wake(); musicPlayTrack(t); });
    list.appendChild(btn);
  }
}

function setMusicProvider(provider) {
  if (!PROVIDERS[provider]) return;
  musicState.provider = provider;
  writePref(PROVIDER_KEY, provider);
  updateNpChrome();
  renderNpList();
}

musicSheet.addEventListener("click", (e) => {
  if (e.target.closest("[data-music-close]")) { closeMusicSheet(); return; }
  const chip = e.target.closest(".np-provider-chip");
  if (chip) { setMusicProvider(chip.dataset.provider); return; }
});

$("npProvider").addEventListener("click", (e) => { e.stopPropagation(); openMusicSheet(); wake(); });
$("npTitleBtn").addEventListener("click", () => openMusicSheet());
$("npToggle").addEventListener("click", musicToggle);
$("npBigToggle").addEventListener("click", musicToggle);
$("npPrev").addEventListener("click", () => musicStep(-1));
$("npNext").addEventListener("click", () => musicStep(1));

const npSeek = $("npSeek");
npSeek.addEventListener("pointerdown", () => { musicState.seeking = true; });
npSeek.addEventListener("input", () => {
  // Живий прев'ю часу під час тяга; саме перемотування — на відпусті (change)
  if (!musicAudio.duration || !isFinite(musicAudio.duration)) return;
  const t = (Number(npSeek.value) / 1000) * musicAudio.duration;
  $("npCur").textContent = fmtTime(t);
});
npSeek.addEventListener("change", () => {
  if (musicAudio.duration && isFinite(musicAudio.duration)) {
    musicAudio.currentTime = (Number(npSeek.value) / 1000) * musicAudio.duration;
  }
  musicState.seeking = false;
});
npSeek.addEventListener("pointerup", () => { musicState.seeking = false; });

/* Подія від мозку (тул play_music / listen_to_video): SSE {"type":"music"} */

function onMusicEvent(ev) {
  if (ev.action === "stop") {
    musicAudio.pause();
    return;
  }
  const track = ev.track && typeof ev.track === "object" ? ev.track : null;
  if (!track || !track.id) return;
  if (Array.isArray(ev.queue) && ev.queue.length && track.provider !== "radio") {
    // An app handed over "up next" (YouTube Music radio): that becomes the
    // queue, instead of appending to whatever played an hour ago.
    musicState.queue = [{ ...track, provider: "youtube" }].concat(
      ev.queue.filter((x) => x && x.id).slice(0, 49).map((x) => ({ ...x, provider: "youtube" })),
    );
    musicPlayTrack({ ...track, provider: "youtube" }, { queue: false });
    return;
  }
  if (track.provider !== "radio") {
    track.provider = "youtube";
    if (musicState.track && musicState.track.id === track.id) {
      // Той самий трек: якщо на паузі — продовжити, повторно не перезапускаємо
      if (!musicState.playing) musicToggle();
      return;
    }
  }
  musicPlayTrack(track);
}

/* ---------- Магазин: пакети для екрана (apps/skins) + скіли/MCP ----------
   «Додатки» та «Скіни» живуть у /api/screen-store (локальні пакети з
   store/packages). «Скіли» і «Тулзи» — це OpenClaw-контур (ClawHub і
   кураторський MCP), звідси вони лише показуються і ставляться через
   наявні /api/store ендпоінти. */

const SKIN_KEY = "botScreenSkin";
const SKIN_VARS_KEY = "botScreenSkinVars";
const SKIN_VAR_NAMES = ["--bg", "--panel", "--line", "--text", "--muted", "--accent", "--ok", "--off"];

let installedApps = [];

async function refreshInstalledApps() {
  try {
    const r = await fetch("/api/screen-store/installed");
    const d = await r.json();
    installedApps = (d.apps || []).map((pkg) => ({
      id: "app:" + pkg.id,
      label: pkgText(pkg, "label") || pkg.id,
      icon: pkg.icon || "store",
      tint: pkg.tint || "",
      app: true,
      pkg: pkg.id,
      title: pkgText(pkg, "label") || pkg.id,
      source: pkg.source || "builtin",
    }));
  } catch (e) {
    installedApps = [];
  }
}

function applySkinVars(vars) {
  const rootStyle = document.documentElement.style;
  SKIN_VAR_NAMES.forEach((name) => rootStyle.removeProperty(name));
  if (vars && typeof vars === "object") {
    SKIN_VAR_NAMES.forEach((name) => {
      const value = vars[name];
      if (typeof value === "string" && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
        rootStyle.setProperty(name, value);
      }
    });
  }
  repaintPixels();
  postStoreAppSkin();
}

function applySkin(manifest) {
  if (manifest) {
    applySkinVars(manifest.vars || {});
    writePref(SKIN_KEY, manifest.id);
    writePref(SKIN_VARS_KEY, JSON.stringify(manifest.vars || {}));
    showCaption(t("store.skin", { name: manifest.label || manifest.id }), "bot");
  } else {
    applySkinVars(null);
    removePref(SKIN_KEY);
    removePref(SKIN_VARS_KEY);
  }
}(function restoreSkin() {
  let vars = null;
  try { vars = JSON.parse(readPref(SKIN_VARS_KEY, "null")); } catch (e) { vars = null; }
  if (vars && typeof vars === "object") applySkinVars(vars);
})();

function currentSkinVars() {
  try { return JSON.parse(readPref(SKIN_VARS_KEY, "null")) || {}; } catch (e) { return {}; }
}

function postStoreAppSkin(frame = null) {
  const target = frame || layerApp.querySelector(".storeapp-frame");
  if (!target?.contentWindow) return;
  try {
    // A sandboxed (shared) app has an opaque origin, so only "*" reaches it.
    // Nothing here is secret: colours, theme and language.
    const origin = target.dataset.sandboxed === "1" ? "*" : window.location.origin;
    target.contentWindow.postMessage({
      type: "botSkin",
      vars: currentSkinVars(),
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      // Apps localise themselves; without this they would stay in the
      // language they started in after the screen switched.
      lang: getLang(),
    }, origin);
  } catch (e) {}
}

function openStoreApp(entry) {
  openAppLayer(entry.title || "app.head", (box) => {
    box.classList.add("storeapp-body");
    const frame = document.createElement("iframe");
    frame.className = "storeapp-frame";
    frame.src = "/store-apps/" + encodeURIComponent(entry.pkg) + "/index.html";
    frame.title = entry.title || entry.pkg;
    // dataset.pkg — щоб команди бота знайшли САМЕ той застосунок, а не
    // будь-який відкритий (перевірка в videoFrame)
    frame.dataset.pkg = entry.pkg;
    if (entry.source === "shared") {
      // Imported from a .cbp: someone else's code. The server also sends a
      // sandboxing CSP; the attribute makes the box hold even if it did not.
      frame.setAttribute("sandbox", "allow-scripts");
      frame.dataset.sandboxed = "1";
    }
    frame.addEventListener("load", () => {
      postStoreAppSkin(frame);
      if (videoPending && entry.pkg === VIDEO_PKG) {
        const command = videoPending;
        videoPending = null;
        sendVideoCommand(command);
      }
    });
    box.appendChild(frame);
  });
}

window.addEventListener("message", (event) => {
  const frame = layerApp.querySelector(".storeapp-frame");
  if (!frame || event.source !== frame.contentWindow) return;
  const expected = frame.dataset.sandboxed === "1" ? "null" : window.location.origin;
  if (event.origin !== expected) return;
  if (event.data?.type === "closeStoreApp") closeAppLayer();
  if (event.data?.type === "storeAppSwipe" && ["left", "right", "down"].includes(event.data.direction)) closeAppLayer();
});

/* ---------- Бот керує відео-плеєром (SSE «video») ----------

   Плеєр живе в iframe застосунку youtube, а команда приходить сюди, до
   батька. Тому батько: 1) відкриває застосунок, якщо той закритий — інакше
   «перемотай вперед» працювало б лише тоді, коли людина вже стоїть у
   потрібному застосунку; 2) передає команду всередину postMessage'ем.

   Команда, що прийшла до завантаження iframe, не губиться: вона лежить у
   videoPending і йде одразу після load. Без цього перше ж «покажи відео»
   відкривало б порожній пошук — застосунок ще не встиг підписатися. */

function videoFrame() {
  const frame = layerApp.querySelector(".storeapp-frame");
  if (!frame) return null;
  // Той самий застосунок? Інакше команда полетіла б, скажімо, у метроном.
  return frame.dataset.pkg === VIDEO_PKG ? frame : null;
}

function sendVideoCommand(command) {
  const frame = videoFrame();
  if (!frame?.contentWindow) return false;
  try {
    frame.contentWindow.postMessage({ type: "botVideo", ...command }, window.location.origin);
    return true;
  } catch (e) {
    return false;
  }
}

function onVideoCommand(ev) {
  const command = { action: ev.action, track: ev.track, position: ev.position,
                    seconds: ev.seconds, rate: ev.rate };

  if (command.action === "play") {
    wake();
    if (videoFrame()) { sendVideoCommand(command); return; }
    const entry = installedApps.find((a) => a.pkg === VIDEO_PKG);
    if (!entry) {
      // Пакет не встановлений: тул ставить його сам, але шухляда могла ще
      // не перечитати список — пробуємо оновити й відкрити вже потім.
      refreshInstalledApps().then(() => {
        const fresh = installedApps.find((a) => a.pkg === VIDEO_PKG);
        if (!fresh) { showCaption(t("video.needApp"), "bot"); return; }
        videoPending = command;
        openStoreApp(fresh);
      });
      return;
    }
    videoPending = command;
    openStoreApp(entry);
    return;
  }

  // Решта команд — тільки живому плеєру. Якщо його немає, мовчки нічого:
  // «пауза» без відео не мусить відкривати застосунок і лякати чорнотою.
  if (!sendVideoCommand(command)) showCaption(t("video.nothing"), "bot");
}

function storeIconEl(name) {
  // Same drawerIcon as the app drawer, so a package looks identical in both
  return drawerIcon(name, false);
}

/* A manifest's own strings in the screen's language: `locales.<lang>` wins,
   the top-level field (Ukrainian, the default language) is the fallback. */
function pkgText(pkg, field) {
  const local = pkg?.locales?.[getLang()];
  return (local && typeof local[field] === "string" && local[field]) || pkg?.[field] || "";
}

/* Store errors come back as {detail: {code, message}}; the code is the key. */
async function storeError(resp) {
  const body = await resp.json().catch(() => ({}));
  const code = body?.detail?.code;
  return code ? t("store.err." + code) : t("store.installFailed");
}

async function storePost(path, payload) {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(await storeError(resp));
  return resp.json();
}

function openStore() {
  openAppLayer("screen.store", (box) => {
    box.classList.add("storeapp-body");
    box.style.padding = "10px 12px";
    box.style.gap = "0";

    const tabs = document.createElement("div");
    tabs.className = "store-tabs";
    const TABS = [
      ["apps", t("store.apps")],
      ["skins", t("store.skins")],
      ["skills", t("store.skills")],
      ["mcp", t("store.mcp")],
    ];
    let active = "apps";
    // Category shelf for the apps tab; "all" is not a category, just no filter
    let shelf = "all";
    // Package whose card is open, or null for the list
    let detail = null;
    let catalogCache = null;
    const tabBtns = {};
    const chips = document.createElement("div");
    chips.className = "store-chips";
    const body = document.createElement("div");
    body.className = "np-list store-list";
    body.style.borderTop = "none";

    for (const [id, label] of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "store-tab";
      btn.textContent = label;
      btn.addEventListener("click", () => { active = id; detail = null; syncTabs(); renderTab(); wake(); });
      tabs.appendChild(btn);
      tabBtns[id] = btn;
    }

    function syncTabs() {
      for (const id in tabBtns) tabBtns[id].classList.toggle("on", id === active);
    }

    function rowAction(label, quiet) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta" + (quiet ? " quiet" : "");
      btn.textContent = label;
      return btn;
    }

    function iconBadge(icon, tint, big) {
      const host = document.createElement("span");
      host.className = "app-icon" + (big ? " store-icon-big" : "");
      host.style.setProperty("--app-tint", tint || iconTint);
      host.appendChild(storeIconEl(icon || "store"));
      return host;
    }

    function infoRow({ icon, tint, name, desc, badge, dots, actions, onOpen }) {
      const row = document.createElement("div");
      row.className = "store-row" + (onOpen ? " tappable" : "");
      row.appendChild(iconBadge(icon, tint));
      const info = document.createElement("div");
      info.className = "store-info";
      const nameRow = document.createElement("div");
      nameRow.className = "store-name";
      const nameEl = document.createElement("span");
      nameEl.textContent = name;
      nameRow.appendChild(nameEl);
      for (const text of [].concat(badge || [])) {
        if (!text) continue;
        const badgeEl = document.createElement("span");
        badgeEl.className = "store-badge";
        badgeEl.textContent = text;
        nameRow.appendChild(badgeEl);
      }
      info.appendChild(nameRow);
      if (desc) {
        const descEl = document.createElement("div");
        descEl.className = "store-desc";
        descEl.textContent = desc;
        info.appendChild(descEl);
      }
      row.appendChild(info);
      if (dots) {
        const dotsEl = document.createElement("span");
        dotsEl.className = "skin-dots";
        for (const color of dots) {
          const dot = document.createElement("i");
          dot.style.background = color;
          dotsEl.appendChild(dot);
        }
        row.appendChild(dotsEl);
      }
      const act = document.createElement("span");
      act.className = "store-actions";
      (actions || []).forEach((a) => {
        // A button inside a tappable row must not also open the card
        a.addEventListener("click", (e) => e.stopPropagation());
        act.appendChild(a);
      });
      row.appendChild(act);
      if (onOpen) row.addEventListener("click", () => { onOpen(); wake(); });
      return row;
    }

    async function loadCatalog(force) {
      if (!catalogCache || force) {
        const r = await fetch("/api/screen-store/catalog");
        catalogCache = await r.json();
      }
      return catalogCache;
    }

    async function afterChange() {
      await refreshInstalledApps();
      renderApps();
      await loadCatalog(true);
      renderTab();
      wake();
    }

    function appActions(pkg, withSecondary) {
      const actions = [];
      if (pkg.installed) {
        const open = rowAction(t("store.open"));
        open.addEventListener("click", () => {
          closeAppLayer();
          openStoreApp({ pkg: pkg.id, title: pkgText(pkg, "label") || pkg.id, source: pkg.source });
        });
        actions.push(open);
      } else {
        const get = rowAction(t("store.get"));
        get.addEventListener("click", async () => {
          get.disabled = true; get.textContent = "…";
          try { await storePost("/api/screen-store/install", { id: pkg.id }); }
          catch (e) { showCaption(e.message, "bot"); }
          await afterChange();
        });
        actions.push(get);
      }
      if (withSecondary && pkg.installed) {
        const del = rowAction(t("store.remove"), true);
        del.addEventListener("click", async () => {
          try { await storePost("/api/screen-store/uninstall", { id: pkg.id }); }
          catch (e) { showCaption(e.message, "bot"); }
          await afterChange();
        });
        actions.push(del);
      }
      return actions;
    }

    function skinActions(pkg) {
      const applied = readPref(SKIN_KEY, "") === pkg.id;
      const use = rowAction(applied ? t("store.unapply") : (pkg.installed ? t("store.apply") : t("store.get")));
      use.addEventListener("click", async () => {
        if (applied) { applySkin(null); renderTab(); wake(); return; }
        try {
          if (!pkg.installed) await storePost("/api/screen-store/install", { id: pkg.id });
          applySkin({ ...pkg, label: pkgText(pkg, "label") });
        } catch (e) { showCaption(e.message, "bot"); }
        await afterChange();
      });
      return [use];
    }

    function badges(pkg) {
      const out = [];
      if (pkg.type === "skin" && readPref(SKIN_KEY, "") === pkg.id) out.push(t("store.badgeOn"));
      else if (pkg.installed) out.push(t("store.badgeHave"));
      // Shared = came from a .cbp file, runs sandboxed. Worth saying out loud.
      if (pkg.source === "shared") out.push(t("store.badgeShared"));
      return out;
    }

    function renderChips(pkgs) {
      chips.innerHTML = "";
      chips.hidden = active !== "apps";
      if (active !== "apps") return;
      const present = new Set(pkgs.map((p) => p.category).filter(Boolean));
      const order = ["all"].concat((catalogCache?.categories || []).filter((c) => present.has(c)));
      if (order.length <= 2) { chips.hidden = true; return; }
      for (const cat of order) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "store-chip" + (cat === shelf ? " on" : "");
        chip.textContent = t("store.cat." + cat);
        chip.addEventListener("click", () => { shelf = cat; renderTab(); wake(); });
        chips.appendChild(chip);
      }
    }

    /* The package card: everything the one-line row has no room for, plus
       the rarer actions (share, delete an imported package). */
    function renderDetail(pkg) {
      chips.hidden = true;
      body.innerHTML = "";
      const card = document.createElement("div");
      card.className = "store-card";
      const head = document.createElement("div");
      head.className = "store-card-head";
      head.appendChild(iconBadge(pkg.icon, pkg.tint, true));
      const titles = document.createElement("div");
      titles.className = "store-info";
      const name = document.createElement("div");
      name.className = "store-card-name";
      name.textContent = pkgText(pkg, "label") || pkg.id;
      const meta = document.createElement("div");
      meta.className = "store-desc";
      meta.textContent = [pkg.author, pkg.version && "v" + pkg.version,
        pkg.category && t("store.cat." + pkg.category)].filter(Boolean).join(" · ");
      titles.append(name, meta);
      head.appendChild(titles);
      card.appendChild(head);

      const desc = document.createElement("div");
      desc.className = "store-card-desc";
      desc.textContent = pkgText(pkg, "description");
      card.appendChild(desc);

      if (pkg.source === "shared") {
        const note = document.createElement("div");
        note.className = "np-hint";
        note.textContent = t("store.sharedNote");
        card.appendChild(note);
      }

      const actions = document.createElement("div");
      actions.className = "store-card-actions";
      (pkg.type === "app" ? appActions(pkg, true) : skinActions(pkg)).forEach((a) => actions.appendChild(a));

      const share = rowAction(t("store.share"), true);
      share.addEventListener("click", () => sharePackage(pkg, card));
      actions.appendChild(share);

      if (pkg.source === "shared") {
        const drop = rowAction(t("store.delete"), true);
        drop.addEventListener("click", async () => {
          if (drop.dataset.armed !== "1") {
            // Two taps instead of confirm(): the kiosk has no dialogs, and
            // deleting an imported package cannot be undone from here.
            drop.dataset.armed = "1";
            drop.textContent = t("store.deleteSure");
            return;
          }
          try { await storePost("/api/screen-store/remove", { id: pkg.id }); }
          catch (e) { showCaption(e.message, "bot"); }
          detail = null;
          await afterChange();
        });
        actions.appendChild(drop);
      }
      card.appendChild(actions);

      const back = rowAction(t("store.back"), true);
      back.classList.add("store-card-back");
      back.addEventListener("click", () => { detail = null; renderTab(); wake(); });
      card.appendChild(back);
      body.appendChild(card);
    }

    /* Sharing from the device itself: the screen cannot hand anyone a file,
       so it says where the file lives and, when a messenger is connected,
       sends it there in one tap. */
    async function sharePackage(pkg, card) {
      let panel = card.querySelector(".store-share");
      if (panel) { panel.remove(); return; }
      panel = document.createElement("div");
      panel.className = "store-share np-hint";
      const url = window.location.origin + "/api/screen-store/export?id=" + encodeURIComponent(pkg.id);
      panel.textContent = t("store.shareHint", { url });
      card.insertBefore(panel, card.querySelector(".store-card-actions"));
      try {
        const r = await fetch("/api/integrations");
        const d = await r.json();
        const targets = (d.integrations || []).filter((i) => i.connected && i.can_share_files);
        for (const target of targets) {
          const send = rowAction(t("store.sendTo", { name: target.label }), true);
          send.addEventListener("click", async () => {
            send.disabled = true;
            try {
              await storePost("/api/integrations/" + encodeURIComponent(target.id) + "/share-package", { id: pkg.id });
              send.textContent = t("store.sent");
            } catch (e) { send.textContent = e.message; }
            wake();
          });
          panel.appendChild(send);
        }
      } catch (e) { /* no integrations: the URL is still there */ }
    }

    async function renderTab() {
      if (detail && (active === "apps" || active === "skins")) {
        const fresh = (catalogCache?.packages || []).find((p) => p.id === detail);
        if (fresh) { renderDetail(fresh); return; }
        detail = null;
      }
      body.textContent = t("common.loading");
      try {
        if (active === "apps" || active === "skins") {
          const kind = active === "apps" ? "app" : "skin";
          const d = await loadCatalog(false);
          const all = (d.packages || []).filter((p) => p.type === kind);
          renderChips(all);
          const pkgs = kind === "app" && shelf !== "all" ? all.filter((p) => p.category === shelf) : all;
          body.innerHTML = "";
          if (!pkgs.length) { body.textContent = t("store.empty"); return; }
          // Installed first within a shelf: the row you use most sits on top
          pkgs.sort((a, b) => (b.installed - a.installed) || pkgText(a, "label").localeCompare(pkgText(b, "label")));
          for (const pkg of pkgs) {
            const dotColors = kind === "skin" && pkg.vars
              ? ["--bg", "--panel", "--accent"].map((k) => pkg.vars[k]).filter(Boolean)
              : null;
            body.appendChild(infoRow({
              icon: pkg.icon,
              tint: pkg.tint,
              name: pkgText(pkg, "label") || pkg.id,
              desc: pkgText(pkg, "description"),
              badge: badges(pkg),
              dots: dotColors,
              actions: kind === "app" ? appActions(pkg, false) : skinActions(pkg),
              onOpen: () => { detail = pkg.id; renderTab(); },
            }));
          }
        } else {
          chips.hidden = true;
          // Skills (ClawHub) and MCP tools belong to the OpenClaw circuit
          const kind = active === "skills" ? "skills" : "mcp";
          const r = await fetch("/api/store?kind=" + kind + "&limit=20");
          const d = await r.json();
          body.innerHTML = "";
          const items = kind === "skills" ? (d.skills || []) : (d.mcp || []);
          const errors = d.errors || {};
          if (errors[kind]) {
            const note = document.createElement("div");
            note.className = "np-hint";
            note.textContent = t("store.openclawDown", { error: errors[kind] });
            body.appendChild(note);
            return;
          }
          if (!items.length) {
            body.textContent = kind === "skills" ? t("store.noSkills") : t("store.noMcp");
            return;
          }
          for (const item of items) {
            const name = item.slug || item.id || item.name || "?";
            const actions = [];
            if (!item.installed) {
              const btn = rowAction(t("store.get"));
              btn.addEventListener("click", async () => {
                btn.disabled = true; btn.textContent = "…";
                const url = kind === "skills" ? "/api/store/skills/install" : "/api/store/mcp/install";
                const payload = kind === "skills" ? { slug: item.slug } : { id: item.id };
                try {
                  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
                  if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    showCaption(typeof err.detail === "string" ? err.detail : t("store.installFailed"), "bot");
                  }
                } catch (e) { showCaption(t("store.installFailed"), "bot"); }
                renderTab();
                wake();
              });
              actions.push(btn);
            }
            body.appendChild(infoRow({
              icon: kind === "skills" ? "bubble" : "server",
              name,
              desc: item.description || item.desc || item.summary || "",
              badge: item.installed ? t("store.badgeHave") : "",
              actions,
            }));
          }
        }
      } catch (e) {
        body.textContent = t("store.offline");
      }
    }

    box.appendChild(tabs);
    box.appendChild(chips);
    box.appendChild(body);
    syncTabs();
    renderTab();
  });
}

/* ---------- Зміна мови ----------
   Перезавантаження сторінки тут було б простіше, але екран — це «пристрій»:
   він може бути посеред розмови, з відкритим застосунком і музикою, яка
   грає. Тому перемальовуємо все живцем: статичні написи, підписи краба,
   плитки, шухляду, чип режиму, годинник і відкритий шар. */

function relocalize() {
  applyStatic();
  crab.labels = emotionLabels();
  crab.defeatLabel = t("emo.defeat");
  crab.setEmotion(crab.emotion);            // підпис емоції новою мовою
  // Типове ключове слово йде за мовою; справжнє імʼя бота — ні
  if (!wakeWordFromBot) wakeWord = t("voice.defaultWake");
  // Розпізнавання перемикаємо на льоту: у безперервному режимі мікрофон
  // уже відкритий, і без рестарту він слухав би старою мовою
  if (recognition) {
    const wasContinuous = voiceMode !== "push" && listening;
    if (wasContinuous) { stopContinuous(); startContinuous(); }
  }
  if (!sayAt) $("sayText").textContent = t("say.empty");
  if (sessionTitleText !== null) setSessionTitle(sessionTitleText);
  tickClock();
  updateAges();
  renderQuickTiles();
  renderApps();
  renderMode();
  updateNpText();
  updateNpSeek();
  if (musicSheetOpen) renderNpList();
  setLink(linkAlive);
  refreshStatus();
  if (openApp) openAppLayer(openApp.key, openApp.build);
  postStoreAppSkin();
}

onLangChange(relocalize);

/* ---------- Старт ---------- */

// Мова могла бути обрана в минулий раз — розставляємо написи ДО першого
// малювання, інакше екран блимне українською і перескочить на англійську
applyStatic();
crab.labels = emotionLabels();
crab.defeatLabel = t("emo.defeat");
crab.setEmotion(crab.emotion);
// «Поки тиша» лишається під керуванням JS (щоб applyStatic не затирав
// справжню репліку бота), тож першу підстановку робимо тут
$("sayText").textContent = t("say.empty");
/* ---------- Timers ----------
   Set by voice through the bot (tools/timer_tools.py) or with the buttons
   on the timer tile; the state lives on the server (screen_widgets.py), so
   "how long is left?" asked of the bot and the numbers here agree. The
   server only stores when a timer ends — this screen counts down and rings. */

const timerCanvas = $("timerCanvas");
const timerCtx = timerCanvas.getContext("2d");
const faceTimer = $("faceTimer");
let timers = [];               // {id, label, seconds, ends_at, left, state}
let timerSkew = 0;             // server clock minus ours, in seconds
const timerRung = new Set();   // ids that already rang: never twice
let ringTimer = 0;
let ringUntil = 0;
let alarmAudio = null;

function timerLeft(tm) {
  if (tm.state === "paused") return Math.max(0, tm.left);
  return Math.max(0, tm.ends_at - (Date.now() / 1000 + timerSkew));
}

function fmtLeft(sec) {
  const s = Math.ceil(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return (h ? h + ":" + two(m) : two(m)) + ":" + two(s % 60);
}

/* The timer the tile and the face chip talk about: the nearest one still
   counting (or paused); a rung one only while it is ringing. */
function nearestTimer() {
  const live = timers.filter((tm) => tm.state === "paused" || timerLeft(tm) > 0);
  live.sort((a, b) => timerLeft(a) - timerLeft(b));
  return live[0] || null;
}

function setTimers(list, serverNow) {
  timers = Array.isArray(list) ? list : [];
  if (typeof serverNow === "number") timerSkew = serverNow - Date.now() / 1000;
  // Finished before we heard of it (screen was asleep or closed): it is
  // over, ringing now would only confuse.
  for (const tm of timers) if (tm.state === "done") timerRung.add(tm.id);
  renderTimers();
}

function renderTimers() {
  const tm = nearestTimer();
  const ringing = Date.now() < ringUntil;
  drawGlyphString(timerCtx, tm ? fmtLeft(timerLeft(tm)) : "00:00", {
    body: tm || ringing ? crab.colors.body : crab.colors.shadow,
    shadow: crab.colors.shadow,
    // A paused timer blinks its colon, like a paused microwave
    skip: tm && tm.state === "paused" && new Date().getSeconds() % 2 ? ":" : "",
  });
  const label = $("timerLabel");
  if (tm) label.textContent = (tm.label || t("timer.unnamed")) + (tm.state === "paused" ? " · " + t("timer.paused") : "");
  else if (ringing) label.textContent = t("timer.ringing");
  else label.textContent = t("timer.empty");
  const others = timers.filter((x) => x !== tm && (x.state === "paused" || timerLeft(x) > 0));
  $("timerMore").textContent = others.map((x) => (x.label || t("timer.unnamed")) + " " + fmtLeft(timerLeft(x))).join(" · ");
  $("timerPause").disabled = !tm;
  $("timerCancel").disabled = !tm && !ringing;
  const pauseIco = $("timerPauseIco");
  const want = tm && tm.state === "paused" ? "play" : "pause";
  if (pauseIco.dataset.icon !== want) {
    pauseIco.dataset.icon = want;
    pauseIco.innerHTML = "";
    pauseIco.appendChild(uiIcon(want, { cell: 2 }));
  }
  // The face shows the nearest timer next to the clock, so a running
  // timer is visible from home without switching tiles
  faceTimer.classList.toggle("hidden", !tm);
  if (tm) faceTimer.textContent = fmtLeft(timerLeft(tm));
}

function alarmBeep() {
  // A short three-tone chirp made on the spot: no audio file to ship, and
  // it plays even when the voice (TTS) is switched off — an alarm the
  // person set must be heard.
  try {
    alarmAudio = alarmAudio || new (window.AudioContext || window.webkitAudioContext)();
    const at = alarmAudio.currentTime;
    const loud = Math.max(0.05, 0.3 * (volume / 100));
    for (let i = 0; i < 3; i++) {
      const osc = alarmAudio.createOscillator();
      const gain = alarmAudio.createGain();
      osc.frequency.value = i === 2 ? 1175 : 880;
      gain.gain.setValueAtTime(0.0001, at + i * 0.22);
      gain.gain.exponentialRampToValueAtTime(loud, at + i * 0.22 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.22 + 0.17);
      osc.connect(gain).connect(alarmAudio.destination);
      osc.start(at + i * 0.22);
      osc.stop(at + i * 0.22 + 0.2);
    }
  } catch (e) { /* no audio output: the caption and the face still show it */ }
}

const RING_MS = 30000;
const RING_EVERY_MS = 2500;

function ringTimerDone(tm) {
  timerRung.add(tm.id);
  wake();
  ringUntil = Date.now() + RING_MS;
  const label = tm.label || t("timer.unnamed");
  setEmotion("surprised");
  showCaption(t("timer.done", { label }), "bot");
  speechSay(t("timer.doneSpoken", { label }));
  clearInterval(ringTimer);
  alarmBeep();
  ringTimer = setInterval(() => {
    if (Date.now() >= ringUntil) { stopRing(); return; }
    alarmBeep();
  }, RING_EVERY_MS);
  renderTimers();
}

function stopRing() {
  if (!ringUntil) return;
  clearInterval(ringTimer);
  ringUntil = 0;
  renderTimers();
}

// Any touch silences the alarm, like any alarm clock
stage.addEventListener("pointerdown", stopRing, true);

function tickTimers() {
  for (const tm of timers) {
    if (tm.state === "running" && !timerRung.has(tm.id) && timerLeft(tm) <= 0) ringTimerDone(tm);
  }
  // Redraw only when someone can see it: the tile or the face chip
  if (timers.length || ringUntil) renderTimers();
}
setInterval(tickTimers, 1000);

async function timerAction(body) {
  try {
    const r = await fetch("/api/screen/timers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.ok) setTimers(d.timers, d.now);
  } catch (e) { /* offline: the tile keeps the last known state */ }
}

document.querySelectorAll("[data-timer-add]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    wake();
    const seconds = Number(btn.dataset.timerAdd);
    const tm = nearestTimer();
    // With nothing running, "+5" starts a five minute timer: fewer buttons
    // than a separate "new" flow, on a screen with room for five.
    timerAction(tm ? { action: "add", id: tm.id, seconds } : { action: "set", seconds });
  });
});
$("timerPause").addEventListener("click", (e) => {
  e.stopPropagation();
  const tm = nearestTimer();
  if (tm) timerAction({ action: tm.state === "paused" ? "resume" : "pause", id: tm.id });
});
$("timerCancel").addEventListener("click", (e) => {
  e.stopPropagation();
  stopRing();
  const tm = nearestTimer();
  if (tm) timerAction({ action: "cancel", id: tm.id });
});

function onTimerEvent(ev) {
  setTimers(ev.timers);
}

(async function loadTimers() {
  try {
    const r = await fetch("/api/screen/timers");
    const d = await r.json();
    setTimers(d.timers, d.now);
  } catch (e) {
    renderTimers();
  }
})();

/* ---------- Weather ----------
   The home city by default; whatever the bot just looked up when it did
   (the weather tool publishes its answer). Loaded only when the tile is on
   screen and older than WEATHER_STALE_MS — on a Pi every request counts,
   and the free services behind it ask for restraint. */

const WEATHER_STALE_MS = 15 * 60 * 1000;
// City names go to the geocoder as written, so they are data, not labels
const WEATHER_CITIES = [
  { city: "Kyiv", key: "city.kyiv" },
  { city: "Lviv", key: "city.lviv" },
  { city: "Kharkiv", key: "city.kharkiv" },
  { city: "Odesa", key: "city.odesa" },
  { city: "Dnipro", key: "city.dnipro" },
  { city: "Warsaw", key: "city.warsaw" },
];
let weatherAt = 0;
let weatherBusy = false;

/* The weather tool sends ISO dates ("2026-09-27"); the weekday is named
   here, in the screen's language, rather than trusting a server string. */
function weekdayName(day) {
  const text = String(day || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  try {
    return new Date(text + "T12:00:00").toLocaleDateString(t("speech.lang"), { weekday: "short" });
  } catch (e) {
    return text.slice(5);
  }
}

function renderWeather(w, city) {
  // The geocoder's own name for the place comes in the right language
  // ("Київ" for "Kyiv"); the query string is the fallback.
  const place = w && typeof w.display === "string" ? w.display.split(",")[0].trim() : "";
  $("weatherCity").textContent = place || (w && w.city) || city || "—";
  if (!w || w.error) {
    $("weatherTemp").textContent = "—";
    $("weatherCond").textContent = w && w.error ? t("weather.failed") : "";
    $("weatherMeta").textContent = "";
    $("weatherDays").innerHTML = "";
    return;
  }
  const temp = Number(w.temperature);
  $("weatherTemp").textContent = Number.isFinite(temp) ? (temp > 0 ? "+" : "") + temp + "°" : "—";
  $("weatherCond").textContent = w.condition || "";
  const meta = [];
  if (w.humidity != null) meta.push(t("weather.humidity", { n: Math.round(w.humidity) }));
  if (w.wind_speed != null) meta.push(t("weather.wind", { n: Math.round(w.wind_speed) }));
  $("weatherMeta").textContent = meta.join(" · ");
  const days = $("weatherDays");
  days.innerHTML = "";
  for (const day of (w.forecast || []).slice(0, 5)) {
    const cell = document.createElement("div");
    cell.className = "weather-day";
    const name = document.createElement("span");
    name.className = "d";
    name.textContent = weekdayName(day.day);
    const range = document.createElement("span");
    range.className = "r";
    range.textContent = (day.max != null ? day.max + "°" : "") + (day.min != null ? " " + day.min + "°" : "");
    cell.appendChild(name);
    cell.appendChild(range);
    days.appendChild(cell);
  }
  weatherAt = w.fetched_at ? w.fetched_at * 1000 : Date.now();
  $("weatherAge").textContent = t("ago.updated", { ago: ago(weatherAt) });
}

async function loadWeather(force) {
  if (weatherBusy || (!force && Date.now() - weatherAt < WEATHER_STALE_MS)) return;
  weatherBusy = true;
  try {
    const r = await fetch("/api/screen/weather" + (force ? "?fresh=true" : ""));
    const d = await r.json();
    renderWeather(d.weather, d.city);
  } catch (e) {
    renderWeather({ error: "offline" });
  } finally {
    weatherBusy = false;
  }
}

async function setWeatherCity(city) {
  try {
    const r = await fetch("/api/screen/weather/city", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ city }),
    });
    const d = await r.json();
    if (r.ok) renderWeather(d.weather, d.city);
  } catch (e) { /* keep the old city */ }
}

function onWeatherEvent(ev) {
  if (ev && ev.weather) renderWeather(ev.weather);
}

$("weatherDays").addEventListener("click", (e) => { e.stopPropagation(); wake(); loadWeather(true); });

renderDots();
applyTileLayout();
goTile(0);
syncQuickButtons();
wake();
refreshInstalledApps();
