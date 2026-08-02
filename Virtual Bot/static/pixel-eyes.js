"use strict";

/* ============================================================
   Піксельні очі Клод Бота (vanilla JS).
   Бітмапи успадковано з claude-bot-display/frontend/src/components/PixelEyes.jsx
   Емоції за контрактом API:
   idle | listening | thinking | speaking | happy | sad |
   confused | surprised | love | sleepy
   ============================================================ */

const EYE_BITMAPS = {
  idle: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
  listening: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ],
  thinking: [
    "......",
    ".####.",
    ".####.",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
  speaking: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    ".####.",
  ],
  happy: [
    "......",
    "......",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
    "......",
  ],
  /* «Сумний» — опущені зовнішні куточки (дзеркалиться для правого ока) */
  sad: [
    "......",
    "...###",
    ".#####",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
  confused: [
    "......",
    ".####.",
    "######",
    "##..##",
    "##..##",
    "######",
    ".####.",
    "..##..",
  ],
  surprised: [
    "......",
    ".####.",
    "######",
    "######",
    "######",
    "######",
    "######",
    ".####.",
  ],
  love: [
    "......",
    ".#..#.",
    "######",
    "######",
    "######",
    "######",
    ".####.",
    "..##..",
  ],
  sleepy: [
    "......",
    "......",
    ".####.",
    "######",
    "######",
    "######",
    ".####.",
    "......",
  ],
};

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
};

/* Рядок бітмапи, що лишається видимим під час моргання («закриті повіки») */
const BLINK_ROW = 4;

class PixelEyes {
  /**
   * @param {HTMLElement} container — куди вставити два ока (.eyes-row)
   * @param {HTMLElement|null} labelEl — елемент для підпису емоції
   * @param {HTMLElement|null} screenEl — елемент, якому ставиться data-emotion
   */
  constructor(container, labelEl, screenEl) {
    this.container = container;
    this.labelEl = labelEl || null;
    this.screenEl = screenEl || null;
    this.emotion = "idle";
    this.blinking = false;
    this.rows = 8;
    this.cols = 6;
    this.cells = { left: [], right: [] };
    this._blinkTimer = null;
    this._build();
    this._applyBitmap();
    this._scheduleBlink();
  }

  /* Створює DOM-сітки пікселів для лівого та правого ока */
  _build() {
    for (const side of ["left", "right"]) {
      const eye = document.createElement("div");
      eye.className = "pixel-eye";
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const px = document.createElement("div");
          px.className = "px";
          eye.appendChild(px);
          this.cells[side].push(px);
        }
      }
      this.container.appendChild(eye);
    }
  }

  /* Змінює емоцію (невідома емоція → idle) */
  setEmotion(emotion) {
    this.emotion = EYE_BITMAPS[emotion] ? emotion : "idle";
    if (this.labelEl) {
      this.labelEl.textContent = EMOTION_LABELS[this.emotion] || this.emotion;
    }
    if (this.screenEl) {
      this.screenEl.dataset.emotion = this.emotion;
    }
    this._applyBitmap();
  }

  /* Перемальовує пікселі згідно з поточною бітмапою та станом моргання.
     Ліве око — як у бітмапі, праве — дзеркальне. */
  _applyBitmap() {
    const bmp = EYE_BITMAPS[this.emotion];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const onL = bmp[r][c] === "#";
        const onR = bmp[r][this.cols - 1 - c] === "#";
        const visible = !this.blinking || r === BLINK_ROW;
        this.cells.left[idx].classList.toggle("on", onL && visible);
        this.cells.right[idx].classList.toggle("on", onR && visible);
      }
    }
  }

  /* Випадкове моргання кожні 2–6 секунд, як в оригінальному PixelEyes.jsx */
  _scheduleBlink() {
    const delay = 2000 + Math.random() * 4000;
    this._blinkTimer = setTimeout(() => {
      this.blinking = true;
      this._applyBitmap();
      setTimeout(() => {
        this.blinking = false;
        this._applyBitmap();
        this._scheduleBlink();
      }, 140);
    }, delay);
  }
}
