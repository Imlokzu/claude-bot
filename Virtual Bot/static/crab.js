"use strict";

/* ============================================================
   Піксельний КРАБ — маскот Клод Бота (vanilla JS, canvas).

   Спрайти (сітка тіла 10x5, 7 кадрів ніжок) та базова механіка
   (процедурні очі, дзеркалення, bodyBob із «розтяжкою», стрибок
   squish → rising → falling → land → landRecover) портовано з
   open-source застосунку PixelClaw:
     https://github.com/masasron/PixelClaw
   MIT License, © Ron Masas.

   Емоції за контрактом API:
   idle | listening | thinking | speaking | happy | sad |
   confused | surprised | love | sleepy | searching | web | working | writing
   Емоції-дії (реквізит малюється пікселями ПРАВОРУЧ від краба, обличчя видно):
   searching — копається в теці з файлами (_drawFolder);
   web — крутить веб-кулю, шукає в мережі (_drawGlobe);
   working — «друкує» у терміналі (_drawTerminal);
   writing — пише олівцем на нотатці (_drawNote).
   Додатковий стан defeat (НЕ емоція) — показ помилки, викликається
   окремо через showDefeat().
   ============================================================ */

/* ---------- Спрайти (порт з PixelClaw/AppConstants.swift) ---------- */

const CRAB_BODY = [
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
];

const CRAB_LEGS = {
  idle: [
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
  ],
  walk: [
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  ],
  squish: [
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  ],
  rising: [
    [0, 0, 1, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  falling: [
    [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
    [0, 1, 0, 0, 0, 0, 0, 0, 1, 0],
  ],
  land: [
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  ],
  landRecover: [
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 0, 0, 1, 0, 0, 1, 0, 0, 0],
  ],
};

/* Піксельне сердечко (для love) та літера z (для sleepy) */
const HEART_BMP = [
  ".#.#.",
  "#####",
  "#####",
  ".###.",
  "..#..",
];

const Z_BMP = [
  "####",
  "..#.",
  ".#..",
  "####",
];

/* Підписи емоцій українською (використовує app.js для тест-селекта) */
const EMOTION_LABELS = {
  idle: "Очікування",
  listening: "Слухаю",
  thinking: "Думаю",
  speaking: "Говорю",
  happy: "Радісний",
  sad: "Сумний",
  confused: "Спантеличений",
  surprised: "Здивований",
  love: "Закоханий",
  sleepy: "Сонний",
  searching: "Копаюся",
  web: "Шукаю в мережі",
  working: "Працюю",
  writing: "Пишу",
  asking: "Питаю",
  greeting: "Вітаюся",
  loading: "Завантажую",
  celebrating: "Святкую",
  cool: "Крутий",
  ball: "Граю мʼячем",
  basketball: "Баскетбол",
  reading: "Читає книгу",
};

const DEFEAT_LABEL = "Збій…";

/* Плавне наближення value до target зі швидкістю rate (експоненційне) */
function approach(value, target, rate, dt) {
  return value + (target - value) * Math.min(1, rate * dt);
}

function smoothstep(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

class PixelCrab {
  /**
   * @param {HTMLCanvasElement} canvas — полотно у панелі «Обличчя»
   * @param {HTMLElement|null} labelEl — елемент підпису емоції
   * @param {HTMLElement|null} screenEl — елемент, якому ставиться data-emotion
   * @param {Object} opts — палітра та геометрія:
   *   bodyColor / shadowColor / eyeColor — кольори краба
   *   heartColor / zColor — кольори часточок
   *   scale — розмір «пікселя» краба у логічних пікселях canvas
   */
  constructor(canvas, labelEl, screenEl, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.labelEl = labelEl || null;
    // Підписи емоцій можна підмінити своїм набором (екран має дві мови);
    // null = типові українські з EMOTION_LABELS
    this.labels = opts.labels || null;
    this.defeatLabel = opts.defeatLabel || null;
    this.screenEl = screenEl || null;

    // Палітра за замовчуванням — рудий краб з PixelClaw
    this.colors = {
      body: opts.bodyColor || "#d98263",
      shadow: opts.shadowColor || "#c4734f",
      eye: opts.eyeColor || "#141414",
      heart: opts.heartColor || "#ff9ac1",
      z: opts.zColor || "#7dcfff",
      // Аркуш, який краб читає у стані searching
      paper: opts.paperColor || "#ece7d1",
      paperBack: opts.paperBackColor || "#c9c3a8",
      paperLine: opts.paperLineColor || "#4a4636",
      // Мʼячі для нудьги: тенісний (підбиває) і баскетбольний (стукає об підлогу)
      ball: opts.ballColor || "#cfe04a",
      ballLine: opts.ballLineColor || "#f2f7c8",
      basket: opts.basketColor || "#e07b2c",
      basketLine: opts.basketLineColor || "#3a2410",
      basketHi: opts.basketHiColor || "#f2a25a",
      // Книга для читання (обкладинка + сторінки беруть paper*)
      bookCover: opts.bookCoverColor || "#4e7d8a",
      bookCoverHi: opts.bookCoverHiColor || "#6fa0ad",
      paperHi: opts.paperHiColor || "#f7f3e2",
      glasses: opts.glassesColor || "#2b2622",
      // Столик, на якому стоїть книга
      wood: opts.woodColor || "#8a6a4a",
      woodHi: opts.woodHiColor || "#a5825e",
    };

    this.S = opts.scale || 10;           // 1 «піксель» краба
    this.W = canvas.width;               // логічна ширина полотна
    this.H = canvas.height;
    this.groundY = this.H - this.S;      // «підлога» — низ ніжок
    this.homeX = Math.round(this.W / 2); // домашня позиція (центр)
    this.minX = 5 * this.S + 4;          // межі прогулянок (центр спрайта)
    this.maxX = this.W - 5 * this.S - 4;

    this.emotion = "idle";
    this.x = this.homeX;
    this.facingRight = true;

    // Поточні плавні величини
    this.lift = 0;        // підняття тіла над ніжками (bodyBob + хода/присід)
    this.eyeClose = 0;    // 0 — відкриті, 1 — закриті
    this.eyeScale = 1;    // >1 — «ширші» очі
    this.lookDir = 0;     // -1..1 — зсув погляду
    this.sx = 1;          // масштаб (squash & stretch)
    this.sy = 1;

    // Службові таймери/лічильники
    this.t = 0;
    this.breathe = 0;
    this.walkTimer = 0;
    this.legFrame = 0;
    this.walking = false;
    this.walkDir = 0;
    this.strollTarget = null;
    this.strollWait = 2 + Math.random() * 4;
    this.paceDir = 1;
    this.danceDir = 1;
    this.armPulse = 0;
    this.glanceTimer = 0;
    this.glanceLook = 0;
    this.spawnTimer = 0;
    this.jump = null;     // активний стрибок {phase,t,...}
    this.airY = 0;        // висота над землею під час стрибка

    // Моргання: раз на 2–6 с (у станах, де очі відкриті)
    this.blinkIn = 2 + Math.random() * 4;
    this.blinkLeft = 0;

    // Стан defeat (поразка) — окремо від емоцій.
    // Дедлайн — за настінним часом (performance.now), а не за сумою dt:
    // якщо вкладка у фоні й rAF на паузі, defeat не «застрягає» назавжди —
    // після повернення видимості перший же кадр поверне емоцію after.
    this.defeatActive = false;
    this.defeatUntil = 0;
    this.defeatAfter = "confused";

    this.particles = []; // сердечка та «z»

    // Живий рівень звуку 0..1 (див. audio-level.js). Керує lip-sync:
    // під час speaking — гучність озвучки, під час listening — гучність міка.
    // Якщо метр недоступний, лишається null → анімація падає на синус (як було).
    this.audioLevel = null;
    this.audioSmooth = 0;   // згладжений рівень для плавних рухів
    this.audioPeak = 0;     // «пік» із затуханням — для сплесків на складах

    // Один requestAnimationFrame на сторінку; пауза, коли вкладка у фоні
    this._raf = null;
    this._lastTs = null;
    this._tick = this._tick.bind(this);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (this._raf !== null) cancelAnimationFrame(this._raf);
        this._raf = null;
        this._lastTs = null;
      } else if (this._raf === null) {
        this._raf = requestAnimationFrame(this._tick);
      }
    });
    this._applyLabel();
    if (!document.hidden) this._raf = requestAnimationFrame(this._tick);
  }

  /* ---------- Публічний API ---------- */

  /* Живий рівень звуку 0..1 з AudioLevelMeter; null — рівня немає (fallback на синус) */
  setAudioLevel(level) {
    this.audioLevel = level == null ? null : Math.max(0, Math.min(1, level));
  }

  /* Змінює емоцію (невідома емоція → idle); скасовує defeat */
  setEmotion(emotion) {
    this.defeatActive = false;
    const next = EMOTION_LABELS[emotion] ? emotion : "idle";
    const changed = next !== this.emotion;
    this.emotion = next;
    if (changed) this._enterState(next);
    this._applyLabel();
  }

  /* Показує «поразку» на ms мс, потім перемикається на емоцію after.
     Це НЕ емоція з контракту — окремий стан для помилок. */
  showDefeat(ms = 3000, after = "confused") {
    this.defeatActive = true;
    this.defeatUntil = performance.now() + ms;
    this.defeatAfter = after;
    this.jump = null;
    this.airY = 0;
    this.walking = false;
    this.particles = [];
    if (this.labelEl) this.labelEl.textContent = this.defeatLabel || DEFEAT_LABEL;
    if (this.screenEl) this.screenEl.dataset.emotion = "defeat";
  }

  /* ---------- Внутрішнє ---------- */

  _applyLabel() {
    if (this.defeatActive) return;
    if (this.labelEl) {
      const labels = this.labels || EMOTION_LABELS;
      this.labelEl.textContent = labels[this.emotion] || this.emotion;
    }
    if (this.screenEl) this.screenEl.dataset.emotion = this.emotion;
  }

  /* Скидання при вході в нову емоцію */
  _enterState(emotion) {
    this.jump = null;
    this.airY = 0;
    this.walking = false;
    this.walkTimer = 0;
    this.legFrame = 0;
    this.strollTarget = null;
    this.strollWait = 2 + Math.random() * 4;
    this.spawnTimer = 0;
    this.glanceTimer = 0;
    this.glanceLook = 0;
    this.particles = [];
    if (emotion === "surprised") {
      // Одразу стрибок з переляку (in-place, як startInPlaceJump у PixelClaw)
      this._startJump({ arc: 4 * this.S, squishDur: 0.09, airDur: 0.35, landDur: 0.28 });
    }
  }

  _startJump(o) {
    this.jump = {
      phase: "squish",
      t: 0,
      arc: o.arc,
      squishDur: o.squishDur,
      airDur: o.airDur,
      landDur: o.landDur,
    };
  }

  /* Крок ходи до цілі; повертає true, коли прийшли.
     cycle — період перемикання кадрів ніжок (0.15 c в оригіналі) */
  _walkToward(target, speed, dt, v, cycle = 0.15) {
    const dx = target - this.x;
    if (Math.abs(dx) <= 2) {
      this.walking = false;
      return true;
    }
    const dir = dx > 0 ? 1 : -1;
    this.x += dir * Math.min(speed * dt, Math.abs(dx));
    this.facingRight = dir > 0;
    this.walking = true;
    this.walkDir = dir;
    this.walkTimer += dt;
    if (this.walkTimer > cycle) {
      this.legFrame = this.legFrame === 0 ? 1 : 0;
      this.walkTimer = 0;
    }
    v.legs = this.legFrame === 0 ? CRAB_LEGS.idle : CRAB_LEGS.walk;
    v.liftT = this.legFrame === 1 ? this.S * 0.4 : 0;
    v.walkShadow = dir;
    return false;
  }

  _spawnParticle(type) {
    const S = this.S;
    if (this.particles.filter((p) => p.type === type).length >= 3) return;
    this.particles.push({
      type,
      x: this.x + (type === "z" ? (this.facingRight ? 1 : -1) * (S + Math.random() * S) : (Math.random() - 0.5) * 4 * S),
      y: this.groundY - (type === "z" ? 6 : 10) * S,
      vy: type === "z" ? -8 : -13,
      drift: (Math.random() - 0.5) * 8,
      life: 0,
      ttl: type === "z" ? 2.6 : 2.1,
    });
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      p.life += dt;
      p.y += p.vy * dt;
      p.x += Math.sin(p.life * 3) * p.drift * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.ttl);
  }

  /* ---------- Головний цикл ---------- */

  _tick(ts) {
    if (this._lastTs === null) this._lastTs = ts;
    const dt = Math.min(0.05, (ts - this._lastTs) / 1000);
    this._lastTs = ts;
    this._update(dt);
    this._raf = requestAnimationFrame(this._tick);
  }

  _update(dt) {
    const S = this.S;
    this.t += dt;

    // Згладжування живого рівня: швидка атака, повільне затухання —
    // так рухи потрапляють у склади, але не «дрижать» на кожному кадрі.
    const lvl = this.audioLevel == null ? 0 : this.audioLevel;
    const rate = lvl > this.audioSmooth ? 22 : 7;
    this.audioSmooth = approach(this.audioSmooth, lvl, rate, dt);
    this.audioPeak = Math.max(this.audioSmooth, this.audioPeak - dt * 1.8);

    // Візуальні цілі кадру (стан їх перезаписує)
    const v = {
      legs: CRAB_LEGS.idle,
      liftT: 0,          // ціль підняття/присіду тіла
      bob: 0,            // «дихання» (додається до lift)
      eyeCloseT: 0,
      eyeScaleT: 1,
      lookT: 0,
      eyeDown: 0,        // зсув очей додолу (sad)
      arms: false,
      walkShadow: 0,
      swayX: 0,          // похитування всього спрайта (confused)
      defeatEyes: false,
      sxT: 1,
      syT: 1,
      breatheSpeed: 1,
      bobAmp: S * 0.2,
      blinkAllowed: true,
      prop: null,   // реквізит поруч із крабом: folder|globe|terminal|note
      bubble: null, // хмарка думок над головою: text|question|exclaim
      voice: false, // голосові хвилі (аудіо-візуалізатор) — коли говорить
      wave: false,  // махає клешнею (greeting)
      spinner: false, // спінер над головою (loading)
      confetti: false, // конфеті (celebrating)
      shades: false,  // сонцезахисні окуляри (cool)
      play: null,     // грається мʼячем: "juggle" (підбиває вгору) | "dribble" (стукає об підлогу)
      book: false,    // читає розгорнуту книгу перед собою
      glasses: false, // окуляри для читання поверх очей
    };

    if (this.defeatActive) {
      this._stateDefeat(dt, v);
    } else {
      switch (this.emotion) {
        case "listening": this._stateListening(dt, v); break;
        case "thinking": this._stateThinking(dt, v); break;
        case "speaking": this._stateSpeaking(dt, v); break;
        case "happy": this._stateHappy(dt, v); break;
        case "sad": this._stateSad(dt, v); break;
        case "confused": this._stateConfused(dt, v); break;
        case "surprised": this._stateSurprised(dt, v); break;
        case "love": this._stateLove(dt, v); break;
        case "sleepy": this._stateSleepy(dt, v); break;
        case "searching": this._stateSearching(dt, v); break;
        case "web": this._stateWeb(dt, v); break;
        case "working": this._stateWorking(dt, v); break;
        case "writing": this._stateWriting(dt, v); break;
        case "asking": this._stateAsking(dt, v); break;
        case "greeting": this._stateGreeting(dt, v); break;
        case "loading": this._stateLoading(dt, v); break;
        case "celebrating": this._stateCelebrating(dt, v); break;
        case "cool": this._stateCool(dt, v); break;
        case "ball": this._stateBall(dt, v); break;
        case "basketball": this._stateBasketball(dt, v); break;
        case "reading": this._stateReading(dt, v); break;
        default: this._stateIdle(dt, v);
      }
    }

    // Стрибок (порт updateJump з PixelClaw) — перекриває позу стану
    if (this.jump) this._updateJump(dt, v);

    // Дихання: bob = max(0, sin) — як у PixelClaw (тільки вгору)
    if (!this.jump || this.jump.phase !== "air") {
      this.breathe += dt * v.breatheSpeed;
    }
    if (!this.jump) {
      v.bob = Math.max(0, Math.sin((this.breathe * Math.PI * 2) / 1.2)) * v.bobAmp;
    }

    // Моргання
    if (v.blinkAllowed && !this.jump) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0 && this.blinkLeft <= 0) {
        this.blinkLeft = 0.14;
        this.blinkIn = 2 + Math.random() * 4;
      }
    }
    if (this.blinkLeft > 0) {
      this.blinkLeft -= dt;
      v.eyeCloseT = 1;
    }

    // Плавні переходи
    this.lift = approach(this.lift, v.liftT, 6, dt);
    this.eyeClose = approach(this.eyeClose, v.eyeCloseT, this.blinkLeft > 0 ? 30 : 8, dt);
    this.eyeScale = approach(this.eyeScale, v.eyeScaleT, 8, dt);
    this.lookDir = approach(this.lookDir, v.lookT, 10, dt);
    if (!this.jump) {
      this.sx = approach(this.sx, v.sxT, 12, dt);
      this.sy = approach(this.sy, v.syT, 12, dt);
    }

    this._updateParticles(dt);
    this._draw(v);
  }

  /* ---------- Стани-емоції ---------- */

  /* idle: дихає, моргає, зрідка проходжується вліво-вправо, а коли занудьгує —
     дістає мʼяч і кілька секунд грається (чеканить або стукає об підлогу). */
  _stateIdle(dt, v) {
    // Нудьга активна — делегуємо у відповідну дію і виходимо
    if (this.boredType) {
      this.boredLeft -= dt;
      if (this.boredLeft > 0) {
        if (this.boredType === "juggle") this._stateBall(dt, v);
        else if (this.boredType === "dribble") this._stateBasketball(dt, v);
        else this._stateReading(dt, v);
        return;
      }
      this.boredType = null;
      this.boredNext = 14 + Math.random() * 16; // наступна нудьга не скоро
    }

    if (this.strollTarget !== null) {
      if (this._walkToward(this.strollTarget, 26, dt, v)) {
        this.strollTarget = null;
        this.strollWait = 6 + Math.random() * 8;
      }
    } else {
      this.strollWait -= dt;
      if (this.strollWait <= 0) {
        this.strollTarget = this.minX + Math.random() * (this.maxX - this.minX);
      }
      // Нудьга наростає ЛИШЕ коли стоїть на місці; час від часу — гра з мʼячем
      if (this.boredNext == null) this.boredNext = 9 + Math.random() * 11;
      this.boredNext -= dt;
      if (this.boredNext <= 0) {
        this.boredType = ["juggle", "dribble", "read"][Math.floor(Math.random() * 3)];
        // Читання довше за гру з мʼячем — це «спокійна» пауза
        this.boredLeft = this.boredType === "read" ? 7 + Math.random() * 5 : 4.5 + Math.random() * 3.5;
      }
      // Стоячи — зрідка позирає вбік
      this.glanceTimer -= dt;
      if (this.glanceTimer <= 0) {
        this.glanceLook = [0, 0, -0.7, 0.7][Math.floor(Math.random() * 4)];
        this.glanceTimer = 1.5 + Math.random() * 2.5;
      }
      v.lookT = this.glanceLook;
    }
  }

  /* ball: краб знуджено чеканить мʼяч клешнями — той літає вгору-вниз над головою.
     Клешні злітають угору в момент удару (|sin|≈0), очі стежать за мʼячем. */
  _stateBall(dt, v) {
    v.play = "juggle";
    const h = Math.abs(Math.sin((this.t * Math.PI) / 0.7)); // 0 — контакт (низ), 1 — апекс
    v.arms = h < 0.3;                          // клешні вгору саме на ударі
    v.eyeDown = -Math.round(this.S * 0.28);    // погляд угору — стежить за мʼячем
    v.eyeScaleT = 1.1;
    v.lookT = 0;
    v.bobAmp = this.S * 0.3;
    v.breatheSpeed = 1.4;
  }

  /* basketball: краб веде мʼяч — той стукає об підлогу праворуч і повертається
     до клешні. Дивиться вниз-убік на мʼяч. */
  _stateBasketball(dt, v) {
    v.play = "dribble";
    v.lookT = 0.55;                            // погляд праворуч, на мʼяч
    v.eyeDown = Math.round(this.S * 0.22);
    v.eyeScaleT = 1.0;
    v.bobAmp = this.S * 0.28;
    v.breatheSpeed = 1.3;
  }

  /* reading: книга стоїть на столику ЗБОКУ — краб у окулярах повертається до неї
     й читає (не тримає її перед глядачем). Обирає бік, де більше місця. */
  _stateReading(dt, v) {
    v.book = true;
    v.glasses = true;
    // Столик — з того боку, де більше місця; краб повертається до нього
    this._readSide = this.W - this.x > 8 * this.S ? 1 : -1;
    this.facingRight = this._readSide === 1;
    v.eyeDown = Math.round(this.S * 0.42);        // ДИВИТЬСЯ ВНИЗ на низький столик
    v.eyeScaleT = 0.92;                            // трохи примружені за окулярами
    // Погляд донизу-вбік + «сканує» рядок
    v.lookT = 0.4 + Math.sin(this.t * 1.6) * 0.22;
    v.bobAmp = this.S * 0.14;                      // ледь помітне спокійне дихання
    v.breatheSpeed = 0.7;
  }

  /* listening: стоїть рівно, очі ширші, погляд на глядача.
     Коли є живий рівень міка — краб реагує на ГОЛОС користувача:
     трохи нахиляється вперед і розширює очі, коли ти говориш голосніше. */
  _stateListening(dt, v) {
    const a = this.audioLevel == null ? 0 : this.audioSmooth;
    v.eyeScaleT = 1.35 + a * 0.25;
    v.lookT = 0;
    v.bobAmp = this.S * (0.2 + a * 0.15);
    v.breatheSpeed = 1 + a * 0.5;
    v.liftT = a * this.S * 0.2;
  }

  /* thinking: повільно ходить туди-сюди, погляд убік */
  _stateThinking(dt, v) {
    const target = this.homeX + this.paceDir * 3 * this.S;
    if (this._walkToward(target, 17, dt, v, 0.22)) {
      this.paceDir *= -1;
    }
    v.lookT = this.walkDir || this.paceDir;
    v.bubble = "text"; // хмарка думок ЛИШЕ з текстом над головою
  }

  /* speaking: рухи ЗА ЖИВОЮ гучністю озвучки (lip-sync), а не за синусом.
     Гучний склад → тіло підскакує, очі трохи ширші, клешні злітають.
     Пауза між словами → краб «замовкає» і стоїть спокійно.
     Якщо рівня немає (немає AudioContext) — старе пульсування за таймером. */
  _stateSpeaking(dt, v) {
    v.voice = true; // голосові хвилі праворуч

    if (this.audioLevel == null) {
      // Fallback: як було до lip-sync
      v.breatheSpeed = 1.7;
      v.bobAmp = this.S * 0.4;
      this.armPulse += dt;
      v.arms = this.armPulse % 0.9 < 0.45;
      return;
    }

    const a = this.audioSmooth;              // 0..1 — поточна гучність
    v.breatheSpeed = 1.1 + a * 1.6;          // голосніше → швидше «дихання»
    v.bobAmp = this.S * (0.12 + a * 0.55);   // амплітуда підскоку за гучністю
    v.liftT = a * this.S * 0.35;             // на гучному тягнеться вгору
    v.eyeScaleT = 1 + a * 0.22;              // очі трохи «відкриваються» на складах
    v.sxT = 1 + a * 0.05;                    // легкий squash & stretch у ритм мови
    v.syT = 1 - a * 0.04;
    v.arms = this.audioPeak > 0.45;          // клешні злітають на акцентах
    v.blinkAllowed = a < 0.35;               // не моргати посеред гучного складу
  }

  /* happy: танець — швидкі кроки вліво-вправо з підстрибуваннями */
  _stateHappy(dt, v) {
    v.breatheSpeed = 1.5;
    if (!this.jump) {
      const target = this.homeX + this.danceDir * 2.5 * this.S;
      if (this._walkToward(target, 60, dt, v, 0.09)) {
        this.danceDir *= -1;
        // Підстрибування на розвороті
        this._startJump({ arc: 1.6 * this.S, squishDur: 0.06, airDur: 0.22, landDur: 0.12 });
      }
    }
  }

  /* sad: присідає, очі напівприкриті, погляд додолу, повільний bob */
  _stateSad(dt, v) {
    v.liftT = -1.4 * this.S; // присід: тіло опускається на ніжки
    v.legs = CRAB_LEGS.squish;
    v.eyeCloseT = 0.45;
    v.eyeDown = Math.round(this.S * 0.3);
    v.breatheSpeed = 0.5;
    v.blinkAllowed = false;
  }

  /* confused: похитування, погляд швидко ліво-право */
  _stateConfused(dt, v) {
    v.swayX = Math.round(Math.sin((this.t * Math.PI * 2) / 1.2) * 2);
    v.lookT = Math.sin((this.t * Math.PI * 2) / 0.7) > 0 ? 1 : -1;
    v.bubble = "question"; // хмарка з «?»
  }

  /* surprised: стрибок (запущений в _enterState), очі широко */
  _stateSurprised(dt, v) {
    v.eyeScaleT = 1.35;
    v.blinkAllowed = false;
    v.bubble = "exclaim"; // хмарка з «!»
  }

  /* love: клешні вгору + підстрибування + сердечка */
  _stateLove(dt, v) {
    v.arms = true;
    // Підстрибування «з розтяжкою»: тіло тягнеться вгору над ніжками
    v.liftT = Math.max(0, Math.sin(this.t * Math.PI * 2 * 1.6)) * this.S * 0.9;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawnParticle("heart");
      this.spawnTimer = 0.7 + Math.random() * 0.5;
    }
  }

  /* sleepy: присів, очі майже закриті, спливають «z» */
  _stateSleepy(dt, v) {
    v.liftT = -2 * this.S;
    v.legs = CRAB_LEGS.squish;
    v.eyeCloseT = 0.8;
    v.breatheSpeed = 0.5;
    v.blinkAllowed = false;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawnParticle("z");
      this.spawnTimer = 1.3 + Math.random() * 0.6;
    }
  }

  /* searching: краб тримає аркуш у клешнях перед собою і дивиться ПРЯМО в нього
     (аркуш малюється пікселями на canvas — див. _drawPaper) */
  /* Спільне для «дій»: повернутися праворуч і трохи зсунутись уліво,
     щоб праворуч було місце для реквізиту (тека/куля/термінал/нотатка). */
  _leanRight(dt) {
    this.facingRight = true;
    this.x = approach(this.x, this.homeX - 2 * this.S, 4, dt);
  }

  /* searching: копається в теці з файлами праворуч, дивиться туди вниз */
  _stateSearching(dt, v) {
    this._leanRight(dt);
    v.prop = "folder";
    v.lookT = 0.85;
    v.eyeDown = Math.round(this.S * 0.3);
    v.eyeScaleT = 1.05;
    v.breatheSpeed = 1.0;
    v.bobAmp = this.S * 0.12;
  }

  /* web: тримає й крутить веб-кулю праворуч на рівні очей — шукає в мережі */
  _stateWeb(dt, v) {
    this._leanRight(dt);
    v.prop = "globe";
    v.lookT = 0.9;
    v.eyeDown = 0;               // куля на рівні очей
    v.eyeScaleT = 1.15;         // зацікавлений погляд
    v.breatheSpeed = 1.2;
    v.bobAmp = this.S * 0.15;
  }

  /* working: «друкує» перед терміналом праворуч-унизу — виконує задачу */
  _stateWorking(dt, v) {
    this._leanRight(dt);
    v.prop = "terminal";
    v.lookT = 0.7;
    v.eyeDown = Math.round(this.S * 0.35);
    v.eyeScaleT = 1.0;
    v.breatheSpeed = 1.35;      // зосереджено «стукає»
    v.bobAmp = this.S * 0.1;
  }

  /* writing: пише олівцем на нотатці праворуч-унизу — записує в памʼять */
  _stateWriting(dt, v) {
    this._leanRight(dt);
    v.prop = "note";
    v.lookT = 0.8;
    v.eyeDown = Math.round(this.S * 0.35);
    v.eyeScaleT = 1.05;
    v.breatheSpeed = 1.0;
    v.bobAmp = this.S * 0.12;
  }

  /* asking: ставить тобі запитання — великі уважні очі, дивиться на тебе,
     нетерпляче підстрибує, над головою хмарка з «?» */
  _stateAsking(dt, v) {
    v.eyeScaleT = 1.3;
    v.lookT = 0;
    v.liftT = Math.max(0, Math.sin((this.t * Math.PI * 2) / 0.7)) * this.S * 0.5;
    v.bubble = "question";
    v.breatheSpeed = 1.2;
  }

  /* greeting: махає клешнею — вітається */
  _stateGreeting(dt, v) {
    v.wave = true;
    v.eyeScaleT = 1.1;
    v.breatheSpeed = 1.3;
    v.bobAmp = this.S * 0.3;
  }

  /* loading: над головою крутиться спінер — статус «обробляю/завантажую» */
  _stateLoading(dt, v) {
    v.spinner = true;
    v.eyeScaleT = 1.0;
    v.breatheSpeed = 1.0;
    v.lookT = 0;
  }

  /* celebrating: танцює зі стрибками, навколо сиплеться конфеті */
  _stateCelebrating(dt, v) {
    v.confetti = true;
    v.breatheSpeed = 1.6;
    if (!this.jump) {
      const target = this.homeX + this.danceDir * 2.2 * this.S;
      if (this._walkToward(target, 55, dt, v, 0.09)) {
        this.danceDir *= -1;
        this._startJump({ arc: 2.2 * this.S, squishDur: 0.06, airDur: 0.26, landDur: 0.12 });
      }
    }
  }

  /* cool: у сонцезахисних окулярах, розслаблено погойдується */
  _stateCool(dt, v) {
    v.shades = true;
    v.eyeScaleT = 1.0;
    v.breatheSpeed = 0.8;
    v.bobAmp = this.S * 0.15;
    v.lookT = Math.sin((this.t * Math.PI * 2) / 3) * 0.3; // ліниво позирає
  }

  /* defeat: розпластався, очі-риски (стан помилки, не емоція) */
  _stateDefeat(dt, v) {
    v.liftT = -2.4 * this.S;
    v.legs = CRAB_LEGS.squish;
    v.defeatEyes = true;
    v.blinkAllowed = false;
    v.sxT = 1.25;
    v.syT = 0.5;
    v.bobAmp = 0;
    if (performance.now() >= this.defeatUntil) {
      // setEmotion сам зніме defeatActive і поверне підпис
      this.setEmotion(this.defeatAfter);
    }
  }

  /* Порт фаз стрибка з PixelClaw (AppController+Movement.updateJump) */
  _updateJump(dt, v) {
    const j = this.jump;
    j.t += dt;
    v.blinkAllowed = false;
    v.liftT = 0;
    v.walkShadow = 0;

    if (j.phase === "squish") {
      const u = Math.min(1, j.t / j.squishDur);
      this.sx = 1 + 0.18 * u;
      this.sy = 1 - 0.18 * u;
      v.legs = CRAB_LEGS.squish;
      v.arms = false;
      if (j.t >= j.squishDur) { j.phase = "air"; j.t = 0; }
    } else if (j.phase === "air") {
      const u = Math.min(1, j.t / j.airDur);
      this.airY = 4 * j.arc * u * (1 - u);
      if (u < 0.5) {
        v.legs = CRAB_LEGS.rising;
        v.arms = true;
        this.sx = 0.88;
        this.sy = 1.18;
      } else {
        v.legs = CRAB_LEGS.falling;
        v.arms = false;
        this.sx = 0.92;
        this.sy = 1.1;
      }
      if (u >= 1) { j.phase = "land"; j.t = 0; this.airY = 0; }
    } else if (j.phase === "land") {
      const lt = Math.min(1, j.t / j.landDur);
      const impact = smoothstep(Math.min(1, lt / 0.42));
      const recover = smoothstep(Math.max(0, (lt - 0.42) / 0.58));
      this.sx = 1 + 0.22 * impact - 0.1 * recover;
      this.sy = 1 - 0.24 * impact + 0.1 * recover;
      v.legs = lt < 0.42 ? CRAB_LEGS.land : lt < 0.78 ? CRAB_LEGS.landRecover : CRAB_LEGS.idle;
      v.arms = false;
      if (j.t >= j.landDur) {
        this.jump = null;
        this.airY = 0;
        this.sx = 1;
        this.sy = 1;
      }
    }
  }

  /* ---------- Малювання ---------- */

  _draw(v) {
    const ctx = this.ctx;
    const S = this.S;
    ctx.clearRect(0, 0, this.W, this.H);

    const g = this.groundY - Math.round(this.airY); // земля з урахуванням польоту
    const lift = Math.round(this.lift + v.bob);     // підняття тіла (може бути <0 — присід)
    const cx = Math.round(this.x) + v.swayX;        // центр спрайта
    const ox = cx - 5 * S;                          // лівий край сітки 10 колонок

    // Дзеркалення навколо центра тіла (порт px() з CrabView.swift)
    const flipX = (rawX, w) => (this.facingRight ? rawX : 2 * cx - rawX - w);
    const cell = (col, y, w = S, h = S) => ctx.fillRect(flipX(ox + col * S, w), y, w, h);

    // Squash & stretch навколо точки опори (низ ніжок)
    ctx.save();
    ctx.translate(cx, g);
    ctx.scale(this.sx, this.sy);
    ctx.translate(-cx, -g);

    const legs = v.legs;
    const legTop = g - 3 * S;                 // верх сітки ніжок
    const bodyRowY = (i) => legTop - (5 - i) * S - lift;

    // «Тінь руху» позаду краба під час ходи (порт з CrabView.swift)
    if (v.walkShadow !== 0 && !this.jump) {
      const dxs = -v.walkShadow * S;
      ctx.fillStyle = this.colors.shadow;
      for (let i = 0; i < CRAB_BODY.length; i++) {
        const edge = CRAB_BODY[i].indexOf(1);
        if (edge < 0) continue;
        ctx.fillRect(flipX(ox + edge * S, S) + dxs, bodyRowY(i), S, S);
      }
      if (lift > 0) {
        const edge = legs[0].indexOf(1);
        if (edge >= 0) ctx.fillRect(flipX(ox + edge * S, S) + dxs, legTop - lift, S, lift);
      }
      const trail = legs[0].indexOf(1);
      if (trail >= 0) {
        for (let r = 0; r < legs.length; r++) {
          if (legs[r][trail] === 1) {
            ctx.fillRect(flipX(ox + trail * S, S) + dxs, legTop + r * S, S, S);
          }
        }
      }
    }

    ctx.fillStyle = this.colors.body;

    // Підняті клешні: 2 стовпчики над тілом у колонках 1 і 8
    if (v.arms) {
      cell(1, bodyRowY(0) - 2 * S, S, 2 * S);
      cell(8, bodyRowY(0) - 2 * S, S, 2 * S);
    }

    // Ніжки
    for (let r = 0; r < legs.length; r++) {
      for (let c = 0; c < legs[r].length; c++) {
        if (legs[r][c] === 1) cell(c, legTop + r * S);
      }
    }

    // Тіло (при піднятих клешнях бічні пікселі ряду 3 «переходять» угору)
    for (let i = 0; i < CRAB_BODY.length; i++) {
      for (let c = 0; c < CRAB_BODY[i].length; c++) {
        if (CRAB_BODY[i][c] !== 1) continue;
        if (v.arms && i === 3 && (c === 0 || c === 9)) continue;
        cell(c, bodyRowY(i));
      }
    }

    // «Розтяжка»: коли тіло підняте — стовпчики між тілом і ніжками
    if (lift > 0) {
      for (let c = 0; c < legs[0].length; c++) {
        if (legs[0][c] === 1) cell(c, legTop - lift, S, lift);
      }
    }

    // Очі: колонки 2 і 7 ряду 1, зсув погляду, прикриття, дзеркалення
    ctx.fillStyle = this.colors.eye;
    const flipDir = this.facingRight ? 1 : -1;
    const maxShift = Math.max(0, S - 2);
    const shift = Math.round(Math.max(-1, Math.min(1, this.lookDir)) * maxShift) * flipDir;
    const eyeRowY = bodyRowY(1);
    let eyeH;
    if (v.defeatEyes) {
      eyeH = Math.max(1, Math.round(S * 0.2)); // очі-риски
    } else {
      eyeH = Math.max(1, S * this.eyeScale * (1 - this.eyeClose * 0.75));
    }
    const eyeYOff = (S - eyeH) / 2 + v.eyeDown;
    for (const c of [2, 7]) {
      const x = flipX(ox + c * S, S) + shift;
      ctx.fillRect(x, eyeRowY + eyeYOff, S, eyeH);
    }

    // Сонцезахисні окуляри поверх очей (cool) — симетрично, тож без flip
    if (v.shades) {
      const lensW = Math.round(2 * S), lensH = Math.round(1.15 * S);
      const yy = Math.round(eyeRowY - 0.05 * S);
      ctx.fillStyle = "#0b0e14";
      ctx.fillRect(ox + Math.round(1.4 * S), yy, lensW, lensH);   // ліва лінза
      ctx.fillRect(ox + Math.round(6.6 * S), yy, lensW, lensH);   // права лінза
      ctx.fillRect(ox + Math.round(3.4 * S), yy + Math.round(0.35 * lensH),
                   Math.round(3.2 * S), Math.max(2, Math.round(0.22 * S))); // перемичка
      ctx.fillStyle = "#46608f";                                    // блік на лінзах
      ctx.fillRect(ox + Math.round(1.7 * S), yy + 2, Math.round(0.5 * S), Math.round(0.4 * S));
      ctx.fillRect(ox + Math.round(6.9 * S), yy + 2, Math.round(0.5 * S), Math.round(0.4 * S));
    }

    ctx.restore();

    // Реквізит ПРАВОРУЧ від краба (стани-дії): обличчя лишається видимим,
    // краб дивиться туди й взаємодіє з ним однією клешнею.
    if (v.prop === "folder") this._drawFolder(cx, bodyRowY, S, g);
    else if (v.prop === "globe") this._drawGlobe(cx, bodyRowY, S, g);
    else if (v.prop === "terminal") this._drawTerminal(cx, bodyRowY, S, g);
    else if (v.prop === "note") this._drawNote(cx, bodyRowY, S, g);

    // Хмарка думок над головою (thinking → текст, confused → «?», surprised → «!»)
    if (v.bubble) this._drawBubble(cx, bodyRowY, S, v.bubble);
    // Голосові хвилі праворуч, коли говорить
    if (v.voice) this._drawVoice(cx, bodyRowY, S);
    // Махання клешнею (greeting), спінер (loading), конфеті (celebrating)
    if (v.wave) this._drawWave(cx, bodyRowY, S);
    if (v.spinner) this._drawSpinner(cx, bodyRowY, S);
    if (v.confetti) this._drawConfetti(cx, bodyRowY, S, g);
    if (v.play) this._drawBall(v.play, cx, bodyRowY, S, g);
    if (v.book) this._drawBook(cx, bodyRowY, S, g);
    if (v.glasses) this._drawGlasses(cx, bodyRowY, S, ox);

    // Часточки: сердечка (love) та «z» (sleepy) — спливають і тануть
    for (const p of this.particles) {
      const bmp = p.type === "heart" ? HEART_BMP : Z_BMP;
      const ps = Math.max(2, Math.round(S * 0.3));
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.ttl);
      ctx.fillStyle = p.type === "heart" ? this.colors.heart : this.colors.z;
      for (let r = 0; r < bmp.length; r++) {
        for (let c = 0; c < bmp[r].length; c++) {
          if (bmp[r][c] === "#") {
            ctx.fillRect(Math.round(p.x + c * ps), Math.round(p.y + r * ps), ps, ps);
          }
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  /* Тека з файлами ПРАВОРУЧ від краба (стан searching): стосик аркушів, що
     гортаються, передня стінка теки з язичком, і клешня краба, що «копається»
     в аркушах (пірнає вгору-вниз). Малюється пікселями, поверх краба. */
  _drawFolder(cx, bodyRowY, S, g) {
    const ctx = this.ctx;
    const C = this.colors;
    const t = this.t;

    const fw = Math.round(4.6 * S);
    const fh = Math.round(4.4 * S);
    // Праворуч від тіла, але не за межу полотна (якщо краб ще не змістився вліво)
    const fx = Math.min(Math.round(cx + 4.2 * S), this.W - fw - Math.round(0.3 * S));
    const fyB = g - Math.round(0.3 * S);      // низ теки — біля «підлоги»
    const fyT = fyB - fh;                       // верх аркушів

    // 1) Аркуші, що стирчать із теки і гортаються (по черзі підстрибують)
    const sheetW = Math.round(fw * 0.62);
    const sheetH = Math.round(fh * 0.8);
    for (let i = 0; i < 3; i++) {
      const up = (Math.floor(t / 0.45) % 3 === i) ? Math.round(S * 0.55) : 0;
      const sx = fx + Math.round(fw * 0.14) + i * Math.round(S * 0.5);
      const sy = fyT - up + Math.round(S * 0.3);
      ctx.fillStyle = C.paperLine;
      ctx.fillRect(sx - 1, sy - 1, sheetW + 2, sheetH + 2);
      ctx.fillStyle = i === 1 ? C.paper : C.paperBack;
      ctx.fillRect(sx, sy, sheetW, sheetH);
      if (i === 1) {
        // текстові рядки на «активному» аркуші
        ctx.fillStyle = C.paperLine;
        const lh = Math.max(2, Math.round(S * 0.15));
        ctx.fillRect(sx + 3, sy + Math.round(sheetH * 0.32), Math.round(sheetW * 0.7), lh);
        ctx.fillRect(sx + 3, sy + Math.round(sheetH * 0.58), Math.round(sheetW * 0.5), lh);
      }
    }

    // 2) Передня стінка теки (manila) з язичком — прикриває низ аркушів
    const flapH = Math.round(fh * 0.5);
    ctx.fillStyle = "#0f0f1a";
    ctx.fillRect(fx - 2, fyB - flapH - 2, fw + 4, flapH + 4);
    ctx.fillStyle = "#e0af68";
    ctx.fillRect(fx, fyB - flapH, fw, flapH);
    ctx.fillStyle = "#c9922f";
    ctx.fillRect(fx + Math.round(fw * 0.12), fyB - flapH - Math.round(S * 0.45),
                 Math.round(fw * 0.4), Math.round(S * 0.5)); // язичок теки

    // 3) Клешня краба, що «копається» в аркушах (пірнає вгору-вниз)
    const dig = Math.round((0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 0.5)) * S);
    ctx.fillStyle = C.body;
    const clawW = Math.round(S * 1.2);
    const clawH = Math.round(S * 1.6);
    const clawX = fx - Math.round(S * 1.1);   // з боку краба, заходить у теку
    const clawY = fyT - Math.round(S * 0.2) + dig;
    ctx.fillRect(clawX, clawY, clawW, clawH);
    // «пальці» клешні (темніші кінці)
    ctx.fillStyle = C.shadow;
    ctx.fillRect(clawX, clawY, clawW, Math.round(S * 0.5));
    ctx.fillRect(clawX, clawY + clawH - Math.round(S * 0.5), clawW, Math.round(S * 0.5));
  }

  /* web: веб-куля праворуч на рівні очей, що обертається (меридіани й
     континенти прокручуються), і клешня краба, що тримає її знизу. */
  _drawGlobe(cx, bodyRowY, S, g) {
    const ctx = this.ctx;
    const C = this.colors;
    const t = this.t;
    const r = Math.round(2 * S);
    // Далеко праворуч від голови, щоб НЕ перекривати очей (навіть зі зсувом погляду)
    const gx = Math.min(Math.round(cx + 6.5 * S), this.W - r - 4);
    const gy = Math.round(bodyRowY(1)); // рівень очей
    const step = 3;                      // піксельний крок заливки кулі
    const sea = "#3a6fd0", seaEdge = "#22468f", land = "#6fcf7e", grid = "#bcd4ff";

    // Рука від тіла до кулі + клешня, що тримає її знизу (малюємо ПІД кулею)
    ctx.fillStyle = C.body;
    const armY = gy + r - Math.round(S * 0.4);
    const armX0 = cx + Math.round(4.3 * S);
    ctx.fillRect(armX0, armY, gx - armX0 + Math.round(S * 0.6), Math.round(S * 1.1));
    ctx.fillRect(gx - Math.round(S * 0.7), gy + r - Math.round(S * 0.6),
                 Math.round(S * 1.4), Math.round(S * 1.2));

    // Куля: темний обідок, потім «море»
    for (let dy = -r; dy <= r; dy += step) {
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
      ctx.fillStyle = seaEdge;
      ctx.fillRect(gx - hw - 1, gy + dy, hw * 2 + 2, step);
    }
    for (let dy = -r; dy <= r; dy += step) {
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy))) - 1;
      if (hw <= 0) continue;
      ctx.fillStyle = sea;
      ctx.fillRect(gx - hw, gy + dy, hw * 2, step);
    }

    // Континенти (рухаються з обертанням, обрізані до кулі)
    ctx.fillStyle = land;
    for (let k = 0; k < 2; k++) {
      const phase = (t * 0.9 + 0.2 + k * 0.5) % 1;
      const mx = Math.round((phase * 2 - 1) * (r * 0.55));
      const my = k === 0 ? -Math.round(r * 0.3) : Math.round(r * 0.3);
      if (mx * mx + my * my < (r - 3) * (r - 3)) {
        ctx.fillRect(gx + mx - 3, gy + my - 2, 6, 5);
      }
    }

    // Меридіани, що прокручуються (ефект спіну) + екватор
    ctx.fillStyle = grid;
    for (let m = 0; m < 3; m++) {
      const phase = (t * 0.9 + m / 3) % 1;
      const mxr = Math.round((phase * 2 - 1) * r);
      const hh = Math.round(Math.sqrt(Math.max(0, r * r - mxr * mxr)));
      ctx.fillRect(gx + mxr - 1, gy - hh, 2, hh * 2);
    }
    ctx.fillRect(gx - r, gy - 1, r * 2, 2); // екватор
  }

  /* working: маленький термінал праворуч-унизу з рядками коду, що біжать угору,
     блимким курсором і клешнею краба, що «стукає» по клавішах. */
  _drawTerminal(cx, bodyRowY, S, g) {
    const ctx = this.ctx;
    const t = this.t;
    const w = Math.round(5 * S), h = Math.round(3.4 * S);
    const x = Math.min(Math.round(cx + 4 * S), this.W - w - 4);
    const yB = g - Math.round(0.3 * S);
    const y = yB - h;

    // Корпус і рамка
    ctx.fillStyle = "#0f0f1a";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#1b2233";
    ctx.fillRect(x, y, w, h);

    // Екран
    const pad = Math.round(S * 0.4);
    const sx = x + pad, sy = y + pad, sw = w - pad * 2, sh = h - pad * 2;
    ctx.fillStyle = "#07100a";
    ctx.fillRect(sx, sy, sw, sh);

    // Рядки «коду», що біжать угору
    ctx.fillStyle = "#9ece6a";
    const lh = Math.max(2, Math.round(S * 0.2));
    const gap = Math.round(S * 0.6);
    const scroll = Math.round(t * S * 0.9) % gap;
    let row = 0;
    for (let ly = sy + gap - scroll; ly < sy + sh - lh; ly += gap, row++) {
      const seed = (row + Math.floor(t)) % 4;
      const lw = [0.7, 0.4, 0.85, 0.55][seed] * (sw - 4);
      ctx.fillRect(sx + 2, ly, Math.round(lw), lh);
    }
    // Курсор, що блимає
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.fillRect(sx + 2, sy + sh - lh - 2, Math.round(S * 0.5), lh);
    }

    // Клешня, що «стукає» по клавішах
    const tap = Math.floor(t / 0.16) % 2 ? Math.round(S * 0.35) : 0;
    ctx.fillStyle = this.colors.body;
    ctx.fillRect(x - Math.round(S * 0.9), yB - Math.round(S * 1.2) + tap,
                 Math.round(S * 1.1), Math.round(S));
  }

  /* writing: нотатка праворуч-унизу; рядок «пишеться» (росте), олівець із
     клешнею рухається по рядку. Записує в памʼять. */
  _drawNote(cx, bodyRowY, S, g) {
    const ctx = this.ctx;
    const C = this.colors;
    const t = this.t;
    const w = Math.round(4.2 * S), h = Math.round(4.6 * S);
    const x = Math.min(Math.round(cx + 4 * S), this.W - w - 4);
    const yB = g - Math.round(0.3 * S);
    const y = yB - h;

    // Аркуш із рамкою
    ctx.fillStyle = C.paperLine;
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = C.paper;
    ctx.fillRect(x, y, w, h);

    const pad = Math.round(S * 0.6);
    const lh = Math.max(2, Math.round(S * 0.16));
    const gap = Math.round(S * 0.72);
    const maxW = w - pad * 2;
    const areaTop = y + pad;
    const areaBot = yB - pad;
    const writeY = areaBot - lh - gap;   // поточний рядок — біля низу аркуша
    const lineTime = 1.2;                 // секунд на один рядок
    const kf = t / lineTime;
    const cur = Math.floor(kf);           // індекс поточного рядка
    const frac = kf - cur;                // прогрес поточного рядка (0..1)

    // Рядки ПРОКРУЧУЮТЬСЯ вгору й РІЗНІ за довжиною (не одна й та сама строчка).
    // Обрізаємо до меж аркуша, щоб рядки не вилазили за верх.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + pad - 1, areaTop - 1, maxW + 2, areaBot - areaTop + 2);
    ctx.clip();
    ctx.fillStyle = C.paperLine;
    for (let j = cur; j >= 0 && j > cur - 12; j--) {
      const ly = writeY - (kf - j) * gap;
      if (ly < areaTop - lh || ly > areaBot) continue;
      const lw = j === cur
        ? maxW * frac                                        // пишеться зараз
        : maxW * (0.45 + 0.5 * Math.abs(Math.sin(j * 1.7))); // готові — різні
      if (lw >= 1) ctx.fillRect(x + pad, Math.round(ly), Math.round(lw), lh);
    }
    ctx.restore();

    // Олівець на кінчику поточного рядка + клешня, що його тримає
    const penX = x + pad + Math.round(maxW * frac);
    const penY = Math.round(writeY - frac * gap);
    ctx.fillStyle = "#e0af68";
    ctx.fillRect(penX, penY - Math.round(S * 1.5), Math.round(S * 0.5), Math.round(S * 1.5));
    ctx.fillStyle = "#3a3630";
    ctx.fillRect(penX, penY - Math.round(S * 0.2), Math.round(S * 0.5), Math.round(S * 0.4));
    ctx.fillStyle = C.body;
    ctx.fillRect(penX - Math.round(S * 0.4), penY - Math.round(S * 2.4),
                 Math.round(S * 1.2), Math.round(S));
  }

  /* Піксельне коло (заливка поточним fillStyle) — для хмарки думок і бульбашок */
  /* Мʼяч для «нудьги»: juggle — тенісний мʼяч чеканиться над піднятими клешнями;
     dribble — баскетбольний стукає об підлогу праворуч і вертається до клешні.
     Фаза мʼяча синхронна з позою краба (той самий this.t / період). */
  _drawBall(type, cx, bodyRowY, S, g) {
    const ctx = this.ctx, C = this.colors, t = this.t;

    if (type === "juggle") {
      const clawTop = bodyRowY(0) - 2 * S;                 // верх піднятих клешень
      const maxH = Math.min(4.2 * S, bodyRowY(0) - 2.5 * S); // не вилітати за верх полотна
      const h = Math.abs(Math.sin((t * Math.PI) / 0.7)) * maxH; // 0 — контакт, max — апекс
      const r = Math.round(0.85 * S);
      const bx = Math.round(cx);
      const by = Math.round(clawTop - r - 2 - h);          // сідає на клешні при контакті
      ctx.fillStyle = C.ballLine; this._pxCircle(bx, by, r + 1);  // світлий обідок
      ctx.fillStyle = C.ball;     this._pxCircle(bx, by, r);      // тіло мʼяча
      ctx.fillStyle = C.ballLine;                                  // тенісний «шов»
      ctx.fillRect(bx - r, by - 1, r * 2, 2);
      return;
    }

    // dribble: баскетбольний мʼяч стукає об підлогу праворуч від краба
    const r = Math.round(0.95 * S);
    const bounceH = 3.4 * S;
    const h = Math.abs(Math.sin((t * Math.PI) / 0.42)) * bounceH; // 0 — на підлозі
    const bx = Math.min(Math.round(cx + 3.8 * S), this.W - r - 4);
    const floorY = g - r;                                  // низ мʼяча торкається підлоги
    const by = Math.round(floorY - h);

    // Клешня веде мʼяч: тягнеться від тіла до верхньої точки дриблінгу
    ctx.fillStyle = C.body;
    const handY = Math.round(floorY - bounceH - r * 0.4 + (bounceH - h) * 0.25);
    const armX0 = cx + Math.round(3.0 * S);
    ctx.fillRect(armX0, handY, bx - armX0 + Math.round(0.6 * S), Math.round(0.9 * S));
    ctx.fillRect(bx - Math.round(0.7 * S), handY, Math.round(1.4 * S), Math.round(1.1 * S));

    // Тінь на підлозі — стискається, коли мʼяч високо
    const shW = Math.round(r * 2 * (1 - (h / bounceH) * 0.5));
    ctx.fillStyle = C.shadow;
    ctx.fillRect(bx - Math.round(shW / 2), g + Math.round(0.2 * S), shW, Math.max(2, Math.round(0.3 * S)));

    // Мʼяч
    ctx.fillStyle = C.basketLine; this._pxCircle(bx, by, r + 1); // темний обідок
    ctx.fillStyle = C.basket;     this._pxCircle(bx, by, r);     // помаранчеве тіло
    ctx.fillStyle = C.basketHi;                                   // блік
    this._pxCircle(bx - Math.round(r * 0.35), by - Math.round(r * 0.35), Math.round(r * 0.35));
    ctx.fillStyle = C.basketLine;                                 // шви
    ctx.fillRect(bx - r, by - 1, r * 2, 2);                       // горизонталь
    ctx.fillRect(bx - 1, by - r, 2, r * 2);                       // вертикаль
  }

  /* НИЗЬКИЙ столик збоку; книга лежить РОЗГОРНУТА ПЛАСКО, побачена згори під
     кутом: обкладинка визирає рамкою по всіх краях, дві сторінки з корінцем
     посередині, дальній край вужчий (перспектива), рядки тексту. Краб дивиться
     на неї згори-вниз. Раз на ~3с «гортає». Бік — this._readSide. */
  _drawBook(cx, bodyRowY, S, g) {
    const ctx = this.ctx, C = this.colors, t = this.t;
    const side = this._readSide || 1;

    // Пласка розгорнута книга: широка й невисока (дивимось згори)
    const topW = Math.round(4.0 * S);               // дальній край (вужчий)
    const botW = Math.round(5.2 * S);               // ближній край (ширший)
    const bookH = Math.round(1.5 * S);              // мала висота — лежить пласко
    const half = Math.round(botW / 2);
    let tableCx = Math.round(cx + side * 7.1 * S);
    tableCx = Math.max(half + 4, Math.min(tableCx, this.W - half - 4));

    // НИЗЬКИЙ столик: стільниця недалеко від підлоги
    const surfY = g - Math.round(2.1 * S);
    const ttH = Math.max(2, Math.round(0.5 * S));
    const legW = Math.max(2, Math.round(0.6 * S));
    ctx.fillStyle = C.wood;
    const legTop = surfY + ttH;
    const tW = botW + Math.round(1.4 * S);
    ctx.fillRect(tableCx - Math.round(tW / 2) + 2, legTop, legW, g - legTop);
    ctx.fillRect(tableCx + Math.round(tW / 2) - 2 - legW, legTop, legW, g - legTop);
    ctx.fillRect(tableCx - Math.round(tW / 2), surfY, tW, ttH);
    ctx.fillStyle = C.woodHi;
    ctx.fillRect(tableCx - Math.round(tW / 2), surfY, tW, Math.max(1, Math.round(0.2 * S)));

    const baseY = surfY;                            // книга лежить на стільниці
    const topY = baseY - bookH;
    const wAt = (f) => Math.round(topW + (botW - topW) * f); // f: 0 дальній..1 ближній

    // ОБКЛАДИНКА — суцільна трапеція-підкладка (визиратиме рамкою з усіх боків)
    for (let yy = -1; yy <= bookH; yy++) {
      const f = Math.min(1, Math.max(0, yy / bookH));
      const w = wAt(f) + Math.round(0.7 * S);       // ширша за сторінки — це «рамка»
      ctx.fillStyle = C.bookCover;
      ctx.fillRect(tableCx - Math.round(w / 2), topY + yy, w, 1);
    }
    // Блік на дальньому краї обкладинки
    ctx.fillStyle = C.bookCoverHi;
    ctx.fillRect(tableCx - Math.round(topW / 2) - Math.round(0.35 * S), topY - 1,
                 topW + Math.round(0.7 * S), Math.max(1, Math.round(0.2 * S)));

    // СТОРІНКИ поверх обкладинки (вужчі — лишають рамку обкладинки)
    const inset = Math.round(0.45 * S);
    for (let yy = 0; yy < bookH - 1; yy++) {
      const f = yy / bookH;
      const w = wAt(f) - inset * 2;
      ctx.fillStyle = C.paper;
      ctx.fillRect(tableCx - Math.round(w / 2), topY + Math.round(0.35 * S) + yy, Math.max(2, w), 1);
    }
    // Світлий торець стосу сторінок уздовж ближнього краю
    ctx.fillStyle = C.paperHi;
    ctx.fillRect(tableCx - Math.round(botW / 2) + inset, baseY - Math.round(0.4 * S),
                 botW - inset * 2, 2);

    // Корінець (згин) по центру — темна вертикаль
    ctx.fillStyle = C.paperBack;
    ctx.fillRect(tableCx - 1, topY + Math.round(0.35 * S), 2, bookH - Math.round(0.5 * S));

    // Рядки тексту на обох сторінках (ширшають до ближнього краю — перспектива)
    ctx.fillStyle = C.paperLine;
    const page = Math.floor(t / 3) % 2;             // «перегортання» кожні ~3с
    for (let i = 1; i <= 2; i++) {
      const f = i / 3;
      const y = Math.round(topY + Math.round(0.35 * S) + (bookH - 1) * f);
      const w = wAt(f) - inset * 2;
      const colW = Math.round(w / 2 - 0.5 * S);
      const seg = Math.max(2, Math.round(colW * (0.7 + 0.3 * ((i + page) % 2))));
      ctx.fillRect(tableCx - Math.round(w / 2) + 2, y, seg, 1);        // ліва сторінка
      ctx.fillRect(tableCx + Math.round(0.35 * S), y, seg, 1);         // права сторінка
    }
  }

  /* Окуляри для читання поверх очей: тонкі прямокутні оправи + перемичка й
     дужки. Симетрично (без дзеркалення), лінзи прозорі — очі видно. */
  _drawGlasses(cx, bodyRowY, S, ox) {
    const ctx = this.ctx;
    const eyeRowY = bodyRowY(1);
    const yy = Math.round(eyeRowY - 0.2 * S);
    const lensW = Math.round(1.8 * S), lensH = Math.round(1.55 * S);
    const th = Math.max(2, Math.round(0.2 * S));   // товщина оправи
    ctx.fillStyle = this.colors.glasses;
    const drawFrame = (fx) => {
      ctx.fillRect(fx, yy, lensW, th);                    // верх
      ctx.fillRect(fx, yy + lensH - th, lensW, th);       // низ
      ctx.fillRect(fx, yy, th, lensH);                    // ліва грань
      ctx.fillRect(fx + lensW - th, yy, th, lensH);       // права грань
    };
    const lx = ox + Math.round(1.1 * S);
    const rx = ox + Math.round(6.1 * S);
    drawFrame(lx);
    drawFrame(rx);
    // Перемичка між лінзами
    ctx.fillRect(lx + lensW, yy + Math.round(lensH * 0.45), rx - (lx + lensW), th);
    // Дужки до країв голови
    ctx.fillRect(ox - Math.round(0.3 * S), yy + Math.round(lensH * 0.3),
                 lx - (ox - Math.round(0.3 * S)), th);
    ctx.fillRect(rx + lensW, yy + Math.round(lensH * 0.3), Math.round(0.7 * S), th);
  }

  _pxCircle(gx, gy, r) {
    const step = 2;
    for (let dy = -r; dy <= r; dy += step) {
      const hw = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)));
      if (hw <= 0) continue;
      this.ctx.fillRect(Math.round(gx - hw), Math.round(gy + dy), hw * 2, step);
    }
  }

  /* Гліфи «?» та «!» піксельним бітмапом (fillStyle ставить викликач) */
  _drawGlyph(ch, cx0, cy0, S) {
    const G = {
      "?": ["01110", "10001", "00010", "00100", "00100", "00000", "00100"],
      "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    };
    const g = G[ch];
    if (!g) return;
    const px = Math.max(2, Math.round(0.28 * S));
    const ox = Math.round(cx0 - (g[0].length * px) / 2);
    const oy = Math.round(cy0 - (g.length * px) / 2);
    for (let r = 0; r < g.length; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] === "1") this.ctx.fillRect(ox + c * px, oy + r * px, px, px);
      }
    }
  }

  /* Хмарка думок над головою: трейл-бульбашки + хмарка з 3–4 кіл + вміст
     (brain — рожевий мозок і рядки «тексту», що блимають; question/exclaim — гліф). */
  _drawBubble(cx, bodyRowY, S, kind) {
    const ctx = this.ctx;
    const t = this.t;
    const light = "#eef1ff", dark = "#0f0f1a";
    const cloudCx = Math.round(cx + 1.8 * S);
    const rMain = Math.round(1.3 * S);
    const cloudCy = Math.max(rMain + 6, Math.round(bodyRowY(0) - 2.6 * S));

    // Трейл: дві маленькі бульбашки від голови до хмарки
    for (let i = 0; i < 2; i++) {
      const bx = cloudCx - Math.round((1.5 + i * 0.9) * S);
      const by = cloudCy + Math.round((1.7 + i * 1.0) * S);
      const br = Math.max(2, Math.round((0.4 - i * 0.14) * S));
      ctx.fillStyle = dark; this._pxCircle(bx, by, br + 1);
      ctx.fillStyle = light; this._pxCircle(bx, by, br);
    }

    // Хмарка: спершу темний контур усіх часток, потім світла заливка
    const lobes = [
      [cloudCx - Math.round(1.15 * S), cloudCy + Math.round(0.2 * S), Math.round(1.0 * S)],
      [cloudCx + Math.round(1.15 * S), cloudCy + Math.round(0.2 * S), Math.round(1.0 * S)],
      [cloudCx, cloudCy - Math.round(0.4 * S), Math.round(1.2 * S)],
      [cloudCx, cloudCy + Math.round(0.55 * S), Math.round(1.1 * S)],
    ];
    ctx.fillStyle = dark;
    for (const [lx, ly, lr] of lobes) this._pxCircle(lx, ly, lr + 1);
    ctx.fillStyle = light;
    for (const [lx, ly, lr] of lobes) this._pxCircle(lx, ly, lr);

    if (kind === "text") {
      // ЛИШЕ текст: 1..3 рядки, що зʼявляються по черзі (думає…), по центру хмарки
      ctx.fillStyle = "#3a3f5a";
      const th = Math.max(1, Math.round(0.14 * S));
      const lg = Math.round(0.5 * S);
      const widths = [1.4, 1.1, 0.75];
      const n = 1 + (Math.floor(t * 2) % 3);
      const startY = cloudCy - Math.round(0.55 * S);
      for (let i = 0; i < n; i++) {
        const lw = Math.round(widths[i] * S);
        ctx.fillRect(cloudCx - Math.round(lw / 2), startY + i * lg, lw, th);
      }
    } else {
      ctx.fillStyle = "#1b2233";
      this._drawGlyph(kind === "question" ? "?" : "!", cloudCx, cloudCy, S);
    }
  }

  /* Голосові хвилі (аудіо-візуалізатор): ряд вертикальних смужок праворуч від
     краба, що симетрично «дихають» вгору-вниз — показ, що бот говорить. */
  _drawVoice(cx, bodyRowY, S) {
    const ctx = this.ctx;
    const t = this.t;
    const live = this.audioLevel != null;
    const bars = 5;
    const bw = Math.max(2, Math.round(S * 0.35));
    const gapx = Math.round(S * 0.35);
    const totalW = bars * bw + (bars - 1) * gapx;
    const x0 = Math.min(Math.round(cx + 5.2 * S), this.W - totalW - 4);
    const midY = Math.round(bodyRowY(2));   // рівень «рота»/грудей
    const maxH = Math.round(S * 1.5);
    ctx.fillStyle = this.colors.z || "#7dcfff"; // блакитні хвилі
    for (let i = 0; i < bars; i++) {
      // Живий режим: висота бару = реальна гучність (центральні бари вищі,
      // як у справжньому візуалізаторі); без метра — старий синус.
      let k;
      if (live) {
        const shape = 1 - Math.abs(i - (bars - 1) / 2) / bars; // 0.6..1
        const flicker = 0.85 + 0.15 * Math.sin(t * 14 + i * 1.7);
        k = 0.12 + this.audioSmooth * shape * flicker * 1.25;
      } else {
        k = 0.25 + 0.75 * Math.abs(Math.sin(t * 6 + i * 0.9));
      }
      const hh = Math.max(1, Math.round(Math.min(1.15, k) * maxH));
      const bx = x0 + i * (bw + gapx);
      ctx.fillRect(bx, midY - hh, bw, hh * 2);
    }
  }

  /* greeting: піднята клешня, що махає з боку в бік (вітається) */
  _drawWave(cx, bodyRowY, S) {
    const ctx = this.ctx;
    const C = this.colors;
    const swing = Math.sin((this.t * Math.PI * 2) / 0.4); // -1..1
    // Рука від правого плеча вгору
    const armX = Math.round(cx + 4.0 * S);
    const armY = Math.round(bodyRowY(1));
    ctx.fillStyle = C.body;
    ctx.fillRect(armX, armY, Math.round(S * 0.9), Math.round(1.8 * S));
    // Клешня-«долоня», що махає (нахил вліво-вправо)
    const handX = Math.round(cx + 4.3 * S + swing * S * 0.9);
    const handY = Math.round(bodyRowY(0) - 1.1 * S);
    ctx.fillRect(handX, handY, Math.round(S * 1.3), Math.round(S * 1.3));
    // два «пальці» клешні згори
    ctx.fillRect(handX + Math.round(S * 0.1), handY - Math.round(S * 0.5),
                 Math.round(S * 0.4), Math.round(S * 0.6));
    ctx.fillRect(handX + Math.round(S * 0.8), handY - Math.round(S * 0.5),
                 Math.round(S * 0.4), Math.round(S * 0.6));
  }

  /* loading: спінер над головою — кільце крапок, яскравість «біжить» по колу */
  _drawSpinner(cx, bodyRowY, S) {
    const ctx = this.ctx;
    const t = this.t;
    const scx = Math.round(cx + 1.6 * S);
    const scy = Math.max(Math.round(1.6 * S), Math.round(bodyRowY(0) - 2.4 * S));
    const R = Math.round(1.3 * S);
    const dots = 8;
    const head = (t * 1.6) % 1; // позиція «голови» спінера
    ctx.fillStyle = "#7dcfff";
    for (let i = 0; i < dots; i++) {
      const a = (i / dots) * Math.PI * 2 - Math.PI / 2;
      const dx = Math.round(scx + Math.cos(a) * R);
      const dy = Math.round(scy + Math.sin(a) * R);
      const bright = 1 - (((i / dots) - head + 1) % 1); // спад від голови
      ctx.globalAlpha = 0.2 + 0.8 * bright;
      this._pxCircle(dx, dy, Math.max(2, Math.round(S * (0.18 + 0.12 * bright))));
    }
    ctx.globalAlpha = 1;
  }

  /* celebrating: різнокольорове конфеті сиплеться навколо краба */
  _drawConfetti(cx, bodyRowY, S, g) {
    const ctx = this.ctx;
    const t = this.t;
    const colors = ["#f7768e", "#9ece6a", "#7aa2f7", "#e0af68", "#ff9ac1", "#7dcfff"];
    const n = 16;
    const topY = Math.round(bodyRowY(0) - 2.6 * S);
    const spanY = g - topY + 2 * S;
    const cs = Math.max(2, Math.round(S * 0.4));
    for (let i = 0; i < n; i++) {
      const seedX = ((i * 73) % 100) / 100;      // детермінований x
      const baseX = cx - 4.2 * S + seedX * 8.4 * S;
      const speed = 0.6 + (i % 5) * 0.14;
      const fall = ((t * speed * S * 3) + i * 23) % spanY;
      const drift = Math.sin(t * 3 + i) * S * 0.45;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(Math.round(baseX + drift), Math.round(topY + fall), cs, cs);
    }
  }
}
