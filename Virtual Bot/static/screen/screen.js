"use strict";

/* streaming-markdown: локальна копія у vendor/ (без CDN — Pi може бути без
   мережі). Парсер інкрементальний: дописує токени в DOM по чанках, а не
   переганяє щоразу весь текст. */
import * as smd from "./vendor/smd.min.js";
/* Піксельні цифри й іконки — своя графіка, спільна мова з крабом */
import { drawGlyphString, makeIcon, paintIcon } from "./pixel-ui.js";
/* Розбір ключового слова — окремо і без DOM, щоб логіку можна було
   перевіряти напряму, не маючи мікрофона (див. wake.js) */
import { parseWake } from "./wake.js";
/* Контурні іконки та їхні кольори — у icons.js */
import { makeSvgIcon, ICON_COLORS } from "./icons.js";

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
const IDLE_HOME_MS = 20000;   // повернення на циферблат
const IDLE_SLEEP_MS = 180000; // «сон» екрана
const SWIPE_MIN = 28;         // поріг жесту в пікселях сцени

const stage = $("stage");
const rail = $("rail");
const tiles = Array.from(rail.querySelectorAll(".tile"));
const layerQuick = $("layerQuick");
const dimmer = $("dimmer");

let tileIndex = 0;
let layer = null;      // null | "apps" | "quick"
let asleep = false;
let bright = 100;      // яскравість 15..100 (повзунок у швидких діях)
let volume = 70;       // гучність голосу 0..100
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
  idleTimer = setTimeout(goHome, IDLE_HOME_MS);
  sleepTimer = setTimeout(sleep, IDLE_SLEEP_MS);
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

/* Дотик, що починається на керуванні або в прокрутці, — НЕ жест екрана:
   інакше тягнення повзунка гортало б тайли, а скрол чату відкривав шар. */
function isInteractive(el) {
  return !!(el && el.closest &&
    el.closest("input, button, textarea, select, .chat-log, .feed, .qs-slider"));
}

stage.addEventListener("pointerdown", (e) => {
  ptrStart = isInteractive(e.target) ? null : { x: e.clientX, y: e.clientY, t: Date.now() };
});

stage.addEventListener("pointerup", (e) => {
  const s = ptrStart;
  ptrStart = null;
  wake();
  if (!s) return;

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

const WEEKDAYS = ["неділя", "понеділок", "вівторок", "середа", "четвер", "п'ятниця", "субота"];
const MONTHS = ["січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];

function two(n) { return n < 10 ? "0" + n : String(n); }

const clockCanvas = $("clockCanvas");
const clockCtx = clockCanvas.getContext("2d");
const faceClockCtx = $("faceClockCanvas").getContext("2d");

function tickClock() {
  const d = new Date();
  const hhmm = two(d.getHours()) + ":" + two(d.getMinutes());
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
  $("clockDate").textContent = d.getDate() + " " + MONTHS[d.getMonth()] + ", " + WEEKDAYS[d.getDay()];
  updateAges();
}
tickClock();
setInterval(tickClock, 1000);

/* Скільки минуло — «щойно / 5 хв / 2 год» (свіжість даних видно завжди) */
function ago(ts) {
  if (!ts) return "";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "щойно";
  if (s < 3600) return Math.floor(s / 60) + " хв тому";
  if (s < 86400) return Math.floor(s / 3600) + " год тому";
  return Math.floor(s / 86400) + " дн тому";
}

function updateAges() {
  $("sayAge").textContent = sayAt ? ago(sayAt) : "";
  $("stAge").textContent = statusAt ? "оновлено " + ago(statusAt) : "";
}

/* ---------- Тайл «Стан» ---------- */

const BRAIN_LABELS = { openclaw: "OpenClaw", omni: "Omni", anthropic: "Anthropic", chat2api: "Chat2API", demo: "демо" };

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
    setState($("stBrain"), s.mode !== "demo", BRAIN_LABELS[s.mode] || s.mode || "—");
    setState($("stVision"), !!s.vision, s.vision ? "онлайн" : "офлайн");
    setState($("stDisplay"), !!s.display, s.display ? "онлайн" : "офлайн");
    statusAt = Date.now();
  } catch (err) {
    setState($("stBrain"), false, "нема звʼязку");
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

function setLink(on) {
  $("linkDot").classList.toggle("on", !!on);
  setState($("stLink"), on, on ? "живий" : "нема");
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
    if (ev.type === "emotion") {
      setEmotion(ev.emotion);
    } else if (ev.type === "reply") {
      // Відповідь у чаті (з панелі або з цього ж екрана): у тайл «Бот сказав»
      // і в стрічку — але БЕЗ пробудження, бо це відповідь на чиюсь дію,
      // а не сам бот подав голос.
      const text = typeof ev.text === "string" && ev.text.trim() ? ev.text.trim() : "";
      if (text) {
        $("sayText").textContent = text;
        sayAt = Date.now();
        updateAges();
        showCaption(text, "bot");
        speak(text);
      }
      setEmotion(ev.emotion || "speaking");
    } else if (ev.type === "say") {
      const text = typeof ev.text === "string" && ev.text.trim() ? ev.text.trim() : "(без тексту)";
      $("sayText").textContent = text;
      sayAt = Date.now();
      updateAges();
      showCaption(text, "bot");
      speak(text);
      setEmotion(ev.emotion || "speaking");
      // Бот заговорив — це варте пробудження екрана
      if (asleep) wake();
    } else if (ev.type === "vision") {
      // Зір лишається видимим на обличчі — коротким субтитром, без журналу
      if (ev.event === "face_appeared") showCaption("бачу тебе", "bot");
      else if (ev.event === "face_gone") showCaption("нікого не бачу", "bot");
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
  { value: "#d98263", label: "Кораловий" },
  { value: "#7fa8d8", label: "Блакитний" },
  { value: "#79b07a", label: "Зелений" },
  { value: "#b48ad8", label: "Фіолетовий" },
  { value: "#d7a65b", label: "Золотий" },
  { value: "#5fb0a8", label: "Бірюзовий" },
];
const ICON_STYLES = {
  pixel: "Піксельні",
  line: "Однотонні",
  color: "Кольорові",
};
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
};
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
};
let iconStyle = "pixel";
let iconTint = DEFAULT_ICON_TINT;

/* Створює іконку в поточному стилі. big — велика сітка для шухляди. */
function uiIcon(name, opts) {
  const o = opts || {};
  if (iconStyle === "pixel") {
    return makeIcon(name, o.cell || 3, o.tint || iconColors(!!o.on)[0], "", !!o.big);
  }
  const svg = makeSvgIcon(name);
  if (o.big) svg.classList.add("svgicon-big");
  svg.style.stroke = iconStyle === "color" ? (ICON_COLORS[name] || iconTint) : iconTint;
  svg.dataset.colored = iconStyle === "color" ? "1" : "";
  return svg;
}

/* Великі іконки шухляди беруться з локального pixel-паку, коли обрано
   піксельний стиль. Для двох інших стилів лишається векторний renderer. */
function drawerIcon(name, on) {
  if (iconStyle === "pixel") {
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
  svg.style.stroke = iconStyle === "color" ? (ICON_COLORS[name] || iconTint) : iconTint;
  return svg;
}

/* Фон круглої плитки в шухляді: у кольоровому стилі — у тон іконці */
function iconTileBg(name) {
  if (iconStyle !== "color") return "";
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
const ORDER_KEY = "botScreenQuickOrder";

let voiceOn = false;
let ttsAvailable = false;
let editing = false;
let picked = null;      // id плитки, обраної першою в режимі перестановки

const quickGrid = $("quickGrid");
const brightRange = $("brightRange");
const volRange = $("volRange");

/* Плитки: id → що це і що робить. Порядок за замовчуванням — цей масив. */
const QUICK_TILES = {
  sleep:  { label: "Сон", icon: "moon", toggle: () => (asleep ? wake() : sleep()), isOn: () => asleep },
  theme:  { label: "Тема", icon: "contrast", toggle: toggleTheme, isOn: () => document.documentElement.dataset.theme === "light" },
  voice:  { label: "Голос", icon: "speaker", toggle: toggleVoice, isOn: () => voiceOn, enabled: () => ttsAvailable },
  apps:   { label: "Екрани", icon: "grid", toggle: () => { openLayer(null); openApps(); }, isOn: () => false },
  icons:  { label: "Налаштування", icon: "settings", toggle: () => { openLayer(null); openSettings(); }, isOn: () => false },
  full:   { label: "На весь", icon: "expand", toggle: toggleFullscreen, isOn: () => !!document.fullscreenElement },
  reload: { label: "Перезапуск", icon: "power", toggle: () => location.reload(), isOn: () => false },
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

/* ---- Голос: Piper через /api/tts, гучність — цим самим повзунком ---- */

const voiceAudio = new Audio();
let voiceUrl = null;
voiceAudio.addEventListener("ended", () => { botSpeaking = false; });
voiceAudio.addEventListener("pause", () => { botSpeaking = false; });
voiceAudio.addEventListener("error", () => { botSpeaking = false; });

async function checkTts() {
  try {
    const r = await fetch("/api/tts/status");
    const d = await r.json();
    ttsAvailable = !!d.enabled;
  } catch (e) {
    ttsAvailable = false;
  }
  if (!ttsAvailable) {
    voiceOn = false;
    volRange.disabled = true;
    $("volVal").textContent = "нема";
  }
  renderQuickTiles();
}

async function speak(text) {
  if (!voiceOn || !ttsAvailable || !text) return;
  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Довгі репліки не озвучуємо цілком: синтез на сервері не безкоштовний,
      // а на екрані бота важлива швидка реакція, а не повний переказ
      body: JSON.stringify({ text: text.slice(0, 400) }),
    });
    if (!r.ok) return;                       // 503 — голос просто мовчить
    const blob = await r.blob();
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    voiceUrl = URL.createObjectURL(blob);
    voiceAudio.src = voiceUrl;
    voiceAudio.volume = volume / 100;
    // Прапорець ставимо ДО play(): у відкритому мікрофоні бот інакше почує
    // власну озвучку й почне відповідати сам собі
    botSpeaking = true;
    await voiceAudio.play().catch(() => { botSpeaking = false; });
  } catch (e) {
    /* голос не критичний — мовчимо */
  }
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
  repaintPixels();
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
    lbl.textContent = def.label;
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

  const savedIconStyle = readPref(ICON_KEY, "pixel");
  if (ICON_STYLES[savedIconStyle]) iconStyle = savedIconStyle;
  const savedIconTint = readPref(ICON_TINT_KEY, DEFAULT_ICON_TINT);
  if (ICON_TINTS.some((item) => item.value === savedIconTint)) iconTint = savedIconTint;

  applyBright(readPref(BRIGHT_KEY, 100));
  applyVolume(readPref(VOL_KEY, 70));
  voiceOn = readPref(VOICE_KEY, "0") === "1";

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

async function sendChat(message) {
  chatBusy = true;
  micButtons.forEach((b) => { b.classList.add("busy"); b.disabled = true; });
  addMsg("user", message);

  const bubble = addMsg("bot", "…");
  bubble.classList.add("pending");
  let started = false;
  let parser = null;
  let scrollPending = false;
  let streamed = "";      // що реально показали зі стріму

  const onChunk = (chunk) => {
    if (!started) {
      started = true;
      bubble.classList.remove("pending");
      bubble.textContent = "";
      parser = smd.parser(smd.default_renderer(bubble));
    }
    streamed += chunk;
    smd.parser_write(parser, chunk);
    showCaption(streamed, "bot");        // те саме — субтитром під обличчям
    // Скрол не частіше за кадр: інакше на A53 кожен чанк дає reflow
    if (!scrollPending) {
      scrollPending = true;
      requestAnimationFrame(() => { scrollPending = false; chatScrollDown(); });
    }
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: message, stream: true, session_id: sessionId }),
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
        } else if (line.startsWith("data:")) {
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let payload;
          try { payload = JSON.parse(raw); } catch (err) { continue; }
          if (eventType === "delta" && payload.chunk) {
            onChunk(payload.chunk);
          } else if (eventType === "emotion") {
            setEmotion(payload.emotion);
          } else if (eventType === "done") {
            /* done.reply — ГОЛОВНІШИЙ за стрім, так каже сам бекенд
               (main.py: «текст розійшовся … done нижче все одно це замінить»).
               Це не формальність: коли шлюз віддає під виглядом відповіді
               «Error: internal error», брейн відкидає її і бере наступний
               мозок — але помилка вже встигла піти в delta. Хто не замінює
               текст на done, той показує чужу помилку як слова бота. */
            if (payload.reply != null && payload.reply !== streamed) {
              if (parser) { try { smd.parser_end(parser); } catch (e2) {} }
              bubble.classList.remove("pending");
              bubble.textContent = "";
              parser = smd.parser(smd.default_renderer(bubble));
              streamed = payload.reply;
              started = true;
              smd.parser_write(parser, payload.reply);
              showCaption(payload.reply, "bot");
              chatScrollDown();
            }
            setEmotion(payload.emotion);
          } else if (eventType === "error") {
            throw new Error(payload.error || "помилка мозку");
          }
        }
      }
    }
    if (parser) smd.parser_end(parser);
    if (!started) {
      bubble.classList.remove("pending");
      bubble.textContent = "(порожня відповідь)";
    }
  } catch (err) {
    if (parser) { try { smd.parser_end(parser); } catch (e2) {} }
    bubble.classList.remove("pending");
    if (!started) bubble.textContent = "✗ " + err.message;
    crab.showDefeat();
  } finally {
    chatBusy = false;
    micButtons.forEach((b) => { b.classList.remove("busy"); b.disabled = false; });
    chatScrollDown();
    wake();
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
const faceLabel = $("faceLabel");

const MODE_KEY = "botScreenVoiceMode";
const MODES = {
  push: { label: "Поговорити", hint: "Тиснеш — кажеш фразу — бот відповідає" },
  open: { label: "Слухає завжди", hint: "Мікрофон відкритий, кожна фраза йде боту" },
  wake: { label: "Ключове слово", hint: "Реагує лише після свого імені" },
};

let voiceMode = "push";
let wakeWord = "клод";        // підтягуємо з імені бота в налаштуваннях
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
let spoke = false;
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
const CAPTION_TAIL = 140;
const CAPTION_HOLD_MS = 9000;

function showCaption(text, kind) {
  const t = (text || "").trim();
  clearTimeout(captionTimer);
  if (!t) return hideCaption();
  faceCaption.textContent = t.length > CAPTION_TAIL ? "…" + t.slice(-CAPTION_TAIL) : t;
  faceCaption.className = "face-caption " + (kind || "bot");
  // Субтитр показує ОСТАННІ слова: поки бот друкує, важливий хвіст, а не
  // початок — інакше на третьому рядку текст просто зникає під краєм
  faceCaption.scrollTop = faceCaption.scrollHeight;
  faceLabel.classList.add("hidden");
  faceTile.classList.add("captioned");
  captionTimer = setTimeout(hideCaption, CAPTION_HOLD_MS);
}

function hideCaption() {
  clearTimeout(captionTimer);
  faceCaption.className = "face-caption hidden";
  faceCaption.textContent = "";
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
    micLabel.textContent = "Голос недоступний";
    return;
  }
  // Ключове слово — ім'я бота з налаштувань: «Клод Бот» → «клод»
  try {
    const r = await fetch("/api/setup");
    const d = await r.json();
    const name = ((d.profile || {}).name || "").trim().toLowerCase();
    if (name) wakeWord = name.split(/\s+/)[0];
  } catch (e) { /* лишається типове «клод» */ }

  iconStyle = readPref(ICON_KEY, "pixel");
  if (!ICON_STYLES[iconStyle]) iconStyle = "pixel";
  voiceMode = readPref(MODE_KEY, "push");
  if (!MODES[voiceMode]) voiceMode = "push";
  renderMode();
  if (voiceMode !== "push") startContinuous();
})();

/* ---------- Стан кнопок ---------- */

/* Кнопка каже, що ЗАРАЗ відбувається (дія/стан), а чип поруч — який режим
   обрано. Раніше обидва писали назву режиму, і напис дублювався. */
function micStateLabel() {
  if (wakeArmed) return "Слухаю…";
  if (!listening) return voiceMode === "push" ? "Говорити" : "Пауза";
  if (voiceMode === "wake") return "Чекаю «" + wakeWord + "»";
  if (voiceMode === "open") return "Слухаю все";
  return "Слухаю…";
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
  if (chip) chip.textContent = MODES[voiceMode].label;
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

function handleFinalText(said) {
  const text = (said || "").trim();
  if (!text) return;

  if (voiceMode === "wake") {
    const { action, text: command } = parseWake(text, wakeWord, wakeArmed);
    if (action === "ignore") return;             // не до бота — мовчимо
    if (action === "arm") {
      wakeArmed = true;                          // сказали лише ім'я — чекаємо
      setListening(listening);
      showCaption("так?", "bot");
      return;
    }
    wakeArmed = false;                           // команду прийняли
    sendChat(command);
    return;
  }

  sendChat(text);
}

/* Браузерний SR: єдиний шлях із проміжними результатами */
function startRecognition(continuous) {
  if (!SR) return false;
  let finalText = "";
  recognition = new SR();
  recognition.lang = "uk-UA";
  recognition.interimResults = true;
  recognition.continuous = !!continuous;

  recognition.onresult = (e) => {
    srRestarts = 0;                              // розпізнавання живе
    if (botSpeaking) return;                     // це його власний голос
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
          showCaption("Безперервне слухання не запустилось", "bot");
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
  mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
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
  mediaRec.start();
  recTimer = setTimeout(() => {
    if (mediaRec && mediaRec.state === "recording") { try { mediaRec.stop(); } catch (e) {} }
  }, REC_MAX_MS + 500);
  return true;
}

async function sendToAsr(blob, continuous) {
  clearTimeout(recTimer);
  if (!continuous) showLive("(розпізнаю…)");
  let text = "";
  try {
    const fd = new FormData();
    fd.append("audio", blob, "voice.webm");
    const r = await fetch("/api/asr", { method: "POST", body: fd });
    const d = await r.json();
    if (r.ok) text = d.text || "";
  } catch (e) {
    text = "";
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
    showLive("(слухаю — текст зʼявиться після паузи)");
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

function setSessionTitle(title) {
  $("sessionTitle").textContent = title && title.trim()
    ? title.trim().slice(0, 26)
    : "Нова розмова";
}

function renderHistory(messages) {
  chatLog.innerHTML = "";
  if (!messages || !messages.length) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.id = "chatEmpty";
    empty.textContent = "Натисни мікрофон і говори.";
    chatLog.appendChild(empty);
    return;
  }
  // Останні 20 реплік: далі на цьому екрані все одно ніхто не гортає
  for (const m of messages.slice(-20)) {
    if (m.role === "user") {
      addMsg("user", m.content || "");
    } else if (m.role === "assistant") {
      const el = addMsg("bot", null);
      const parser = smd.parser(smd.default_renderer(el));
      smd.parser_write(parser, m.content || "");
      smd.parser_end(parser);
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
  sessionsList.textContent = "Завантаження…";
  try {
    const r = await fetch("/api/sessions");
    const d = await r.json();
    const list = d.sessions || [];
    sessionsList.innerHTML = "";
    if (!list.length) {
      sessionsList.textContent = "Розмов ще немає.";
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
    sessionsList.textContent = "Не вдалося завантажити список.";
  }
}

$("sessionsBtn").addEventListener("click", () => { wake(); showSessions(); });
$("sessionsClose").addEventListener("click", () => sessionsPanel.classList.add("hidden"));

$("chatNew").addEventListener("click", () => {
  wake();
  sessionId = "screen-" + Math.random().toString(16).slice(2, 10);
  writePref(SESSION_KEY, sessionId);
  setSessionTitle("");
  renderHistory([]);
  sessionsPanel.classList.add("hidden");
});

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
  { id: "face", label: "Обличчя", icon: "face" },
  { id: "clock", label: "Годинник", icon: "clock" },
  { id: "chat", label: "Розмова", icon: "mic" },
  { id: "say", label: "Репліка", icon: "bubble" },
  { id: "state", label: "Стан", icon: "gauge" },
  { id: "quick", label: "Швидкі дії", icon: "sliders" },
  // Далі — не екрани, а справжні дії пристрою
  { id: "camera", label: "Камера", icon: "camera", app: true },
  { id: "services", label: "Сервіси", icon: "server", app: true },
  { id: "panel", label: "Панель", icon: "monitor", app: true },
  { id: "settings", label: "Налаштування", icon: "settings", app: true },
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
  for (const scr of SCREENS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "app-tile";
    const here = !scr.app && tiles[tileIndex] &&
      tiles[tileIndex].dataset.tile === scr.id;
    btn.classList.toggle("on", here);

    const circle = document.createElement("span");
    circle.className = "app-icon";
    circle.dataset.icon = scr.icon;
    const tint = iconStyle === "color"
      ? (ICON_COLORS[scr.icon] || iconTint)
      : iconStyle === "pixel"
        ? (PIXEL_ICON_TINTS[scr.icon] || iconTint)
        : iconTint;
    circle.style.setProperty("--app-tint", tint);
    circle.appendChild(drawerIcon(scr.icon, here));
    btn.appendChild(circle);

    const lbl = document.createElement("span");
    lbl.className = "app-name";
    lbl.textContent = scr.label;
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
  if (id === "quick") { openLayer("quick"); return; }
  const idx = tiles.findIndex((t) => t.dataset.tile === id);
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
    if (isInteractive(e.target) || appsOpen()) return;
    holdTimer = setTimeout(() => { ptrStart = null; openApps(); }, 600);
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

function openAppLayer(title, build) {
  clearTimeout(camTimer);
  applyFrost(layerApp);
  $("appTitle").textContent = title;
  appBody.innerHTML = "";
  build(appBody);
  layerApp.classList.add("open");
  stage.classList.add("layered");
  wake();
}

function closeAppLayer() {
  clearTimeout(camTimer);
  layerApp.classList.remove("open");
  appBody.innerHTML = "";                 // MJPEG-стрім інакше тягнеться далі
  if (!layer && !appsOpen()) stage.classList.remove("layered");
}

document.querySelector("[data-app-close]").addEventListener("click", closeAppLayer);

/* --- Камера: потік беремо НАПРЯМУ з Vision (8000), не через бекенд --- */
function openCamera() {
  openAppLayer("Камера", (box) => {
    const view = document.createElement("div");
    view.className = "cam-view";
    const note = document.createElement("div");
    note.className = "cam-note";
    note.textContent = "Перевіряю зір…";
    box.appendChild(view);
    box.appendChild(note);

    fetch("/api/status").then((r) => r.json()).then((st) => {
      if (st.vision) {
        const img = document.createElement("img");
        img.alt = "Потік камери";
        const streamUrl = new URL("/vision/stream.mjpg", window.location.origin);
        streamUrl.port = "8000";
        img.src = streamUrl.href;
        img.onerror = () => { note.textContent = "Потік не відкрився."; };
        view.appendChild(img);
        note.textContent = "Живий потік";
        return;
      }
      note.textContent = "Зір вимкнено.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cta";
      btn.style.alignSelf = "center";
      btn.textContent = "Запустити зір";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        note.textContent = "Запускаю…";
        try {
          await fetch("/api/services/vision/start", { method: "POST" });
          // Сервіс піднімається не миттєво — перевіряємо трохи згодом
          camTimer = setTimeout(openCamera, 2500);
        } catch (e) {
          note.textContent = "Не вдалося запустити.";
          btn.disabled = false;
        }
      });
      box.appendChild(btn);
    }).catch(() => { note.textContent = "Немає звʼязку з ботом."; });
  });
}

/* --- Сервіси: старт/стоп того, з чого складається «тіло» бота --- */
function openServices() {
  openAppLayer("Сервіси", (box) => {
    const rows = {};
    for (const [id, label] of [["vision", "Зір (камера)"], ["display", "Дисплей"]]) {
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
      btn.textContent = "Старт";
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        state.textContent = btn.dataset.action === "stop" ? "зупиняю…" : "запускаю…";
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
    note.textContent = "Сервіси живуть на тому ж комп’ютері, що й мозок.";
    box.appendChild(note);

    async function refresh() {
      let data = {};
      try {
        const r = await fetch("/api/services");
        data = await r.json();
      } catch (e) {
        for (const id in rows) rows[id].state.textContent = "нема звʼязку";
        return;
      }
      const src = data.services || data || {};
      for (const id in rows) {
        const raw = src[id];
        const on = typeof raw === "object" && raw ? !!(raw.running || raw.alive) : !!raw;
        rows[id].state.textContent = on ? "працює" : "зупинено";
        rows[id].state.className = "svc-state" + (on ? " on" : "");
        rows[id].btn.textContent = on ? "Стоп" : "Старт";
        rows[id].btn.dataset.action = on ? "stop" : "start";
        rows[id].btn.disabled = false;
      }
    }
    refresh();
  });
}

function openPanel() {
  openAppLayer("Панель", (box) => {
    box.classList.add("panel-body");
    const section = document.createElement("section");
    section.className = "settings-section";
    const head = document.createElement("div");
    head.className = "settings-section-head";
    const title = document.createElement("strong");
    title.textContent = "Стан бота";
    const hint = document.createElement("span");
    hint.textContent = "оновлюється локально";
    head.appendChild(title);
    head.appendChild(hint);
    section.appendChild(head);

    const rows = {};
    for (const [id, label] of [["brain", "Мозок"], ["vision", "Зір"], ["display", "Дисплей"], ["link", "Звʼязок"]]) {
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
    refresh.textContent = "Оновити";
    refresh.addEventListener("click", refreshPanel);
    const services = document.createElement("button");
    services.type = "button";
    services.className = "cta settings-test";
    services.textContent = "Сервіси";
    services.addEventListener("click", openServices);
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "cta settings-test";
    settings.textContent = "Налаштування";
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
        rows.brain.textContent = BRAIN_LABELS[status.mode] || status.mode || "офлайн";
        rows.brain.classList.toggle("on", brainOn);
        rows.link.textContent = linkOn ? "живий" : "нема";
        rows.link.classList.toggle("on", linkOn);
        for (const id of ["vision", "display"]) {
          const raw = serviceState[id];
          const on = raw === undefined
            ? !!status[id]
            : (typeof raw === "object" && raw ? !!(raw.running || raw.alive) : !!raw);
          rows[id].textContent = on ? "працює" : "зупинено";
          rows[id].classList.toggle("on", on);
        }
      } catch (e) {
        Object.values(rows).forEach((value) => {
          value.textContent = "нема звʼязку";
          value.classList.remove("on");
        });
      }
      refresh.disabled = false;
    }
    refreshPanel();
  });
}

function resetScreenPrefs() {
  [THEME_KEY, BRIGHT_KEY, VOL_KEY, VOICE_KEY, ORDER_KEY, ICON_KEY, ICON_TINT_KEY]
    .forEach(removePref);
  document.documentElement.dataset.theme = "dark";
  iconStyle = "pixel";
  iconTint = DEFAULT_ICON_TINT;
  bright = 100;
  volume = 70;
  voiceOn = false;
  editing = false;
  picked = null;
  quickOrder = DEFAULT_ORDER.slice();
  applyBright(bright);
  applyVolume(volume);
  voiceAudio.pause();
  rebuildIcons();
  renderQuickTiles();
}

function openSettings() {
  openAppLayer("Налаштування", (box) => {
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

    const appearance = section("Вигляд", "застосовується одразу");
    const styleRow = row(appearance, "Стиль іконок", "Піксельні, однотонні або кольорові");
    const styleGrid = document.createElement("div");
    styleGrid.className = "settings-choices";
    for (const [id, label] of Object.entries(ICON_STYLES)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = label;
      button.addEventListener("click", () => { setIconStyle(id); sync(); });
      styleButtons.push({ id, button });
      styleGrid.appendChild(button);
    }
    styleRow.appendChild(styleGrid);

    const tintRow = row(appearance, "Колір", "для однотонних і дрібних кнопок");
    const tintGrid = document.createElement("div");
    tintGrid.className = "settings-swatches";
    for (const item of ICON_TINTS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-swatch";
      button.style.background = item.value;
      button.title = item.label;
      button.setAttribute("aria-label", item.label);
      button.addEventListener("click", () => { setIconTint(item.value); sync(); });
      tintButtons.push({ value: item.value, button });
      tintGrid.appendChild(button);
    }
    tintRow.appendChild(tintGrid);

    const themeRow = row(appearance, "Тема", "фон екрана і шторок");
    const themeGrid = document.createElement("div");
    themeGrid.className = "settings-choices settings-choices-two";
    for (const [id, label] of [["dark", "Темна"], ["light", "Світла"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-choice";
      button.textContent = label;
      button.addEventListener("click", () => {
        document.documentElement.dataset.theme = id;
        writePref(THEME_KEY, id);
        repaintPixels();
        sync();
      });
      themeButtons.push({ id, button });
      themeGrid.appendChild(button);
    }
    themeRow.appendChild(themeGrid);

    const display = section("Екран", "ті самі значення, що й у швидких діях");
    const brightRow = row(display, "Яскравість", "15–100% без зміни системних налаштувань");
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

    const audio = section("Голос", "локальний Piper, якщо модель доступна");
    const voiceRow = row(audio, "Озвучення", "бот говорить відповіді через браузер");
    voiceToggle.type = "button";
    voiceToggle.className = "settings-switch";
    voiceToggle.addEventListener("click", () => { toggleVoice(); sync(); });
    voiceRow.appendChild(voiceToggle);

    const volumeRow = row(audio, "Гучність", "гучність наступних відповідей");
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

    const voiceChoiceRow = row(audio, "Голос Piper", "зберігається на сервері для наступних озвучок");
    voiceSelect.className = "settings-select";
    voiceSelect.addEventListener("change", async () => {
      try {
        const response = await fetch("/api/tts/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speaker: Number(voiceSelect.value) }),
        });
        if (!response.ok) throw new Error("voice " + response.status);
        voiceState.textContent = "збережено";
      } catch (e) {
        voiceState.textContent = "не вдалося зберегти";
      }
      sync();
    });
    voiceChoiceRow.appendChild(voiceSelect);

    testVoice.type = "button";
    testVoice.className = "cta settings-test";
    testVoice.textContent = "Перевірити голос";
    testVoice.addEventListener("click", async () => {
      if (!voiceOn || !ttsAvailable) return;
      testVoice.disabled = true;
      note.textContent = "Говорю тестову фразу…";
      await speak("Налаштування голосу працюють.");
      note.textContent = "Тест завершено.";
      sync();
    });
    audio.appendChild(testVoice);

    const actions = section("Дії", "локальні параметри цього екрана");
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "settings-reset";
    reset.textContent = "Скинути налаштування екрана";
    reset.addEventListener("click", () => {
      if (typeof window.confirm === "function" && !window.confirm("Скинути тему, яскравість, голос і стиль іконок?")) return;
      resetScreenPrefs();
      note.textContent = "Параметри повернуто до початкових.";
      sync();
    });
    actions.appendChild(reset);

    const attribution = document.createElement("div");
    attribution.className = "settings-note settings-attribution";
    attribution.innerHTML = 'Піксельні іконки: <a href="https://pxlkit.xyz" target="_blank" rel="noreferrer">Pxlkit</a>.';
    box.appendChild(attribution);

    note.className = "settings-note";
    box.appendChild(note);

    function sync() {
      styleButtons.forEach(({ id, button }) => button.classList.toggle("on", id === iconStyle));
      tintButtons.forEach(({ value, button }) => button.classList.toggle("on", value === iconTint));
      themeButtons.forEach(({ id, button }) => button.classList.toggle("on", id === document.documentElement.dataset.theme));
      styleState.textContent = ICON_STYLES[iconStyle];
      tintState.textContent = ICON_TINTS.find((item) => item.value === iconTint)?.label || "власний";
      themeState.textContent = document.documentElement.dataset.theme === "light" ? "Світла" : "Темна";
      brightRangeSettings.value = String(bright);
      brightValue.textContent = bright + "%";
      volumeRangeSettings.value = String(volume);
      volumeValue.textContent = ttsAvailable ? volume + "%" : "нема";
      voiceToggle.disabled = !ttsAvailable;
      voiceToggle.textContent = !ttsAvailable ? "Недоступно" : (voiceOn ? "Увімкнено" : "Вимкнено");
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
        voiceState.textContent = "сервіс недоступний";
        sync();
      });
  });
}

/* ---------- Старт ---------- */

renderDots();
goTile(0);
syncQuickButtons();
wake();
