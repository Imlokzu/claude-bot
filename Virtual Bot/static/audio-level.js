"use strict";

/* ============================================================
   «Клод Бот» — вимірювач живого рівня звуку (RMS) для анімації.

   Навіщо: анімація краба раніше «говорила» по синусу — вона не залежала
   від того, що саме озвучує Piper/MiMo і чи взагалі чути голос. Тепер
   рівень береться з реального аудіо:
     • speaking  — з елемента <audio>, який відтворює TTS;
     • listening — з потоку мікрофона (MediaStream).

   Один AudioContext на сторінку (браузери обмежують їхню кількість).
   Джерело з <audio> ОБОВʼЯЗКОВО під'єднуємо і до destination, інакше
   звук перестане бути чутним після createMediaElementSource.
   ============================================================ */

const AudioCtor = window.AudioContext || window.webkitAudioContext;

class AudioLevelMeter {
  constructor(onLevel) {
    this.onLevel = typeof onLevel === "function" ? onLevel : () => {};
    this.ctx = null;
    this.analyser = null;
    this.source = null;
    this.raf = 0;
    // Кеш джерел для <audio>: createMediaElementSource можна викликати
    // для одного елемента лише РАЗ, інакше буде InvalidStateError.
    this.elementSources = new WeakMap();
  }

  /* Лінивий спільний AudioContext (створюється після жесту користувача) */
  _ensureCtx() {
    if (!AudioCtor) return null;
    if (!this.ctx) {
      try { this.ctx = new AudioCtor(); } catch (e) { return null; }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  _ensureAnalyser() {
    const ctx = this._ensureCtx();
    if (!ctx) return null;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
    }
    return this.analyser;
  }

  /* Рівень з відтворюваного <audio> (озвучка бота) */
  attachElement(audioEl) {
    const ctx = this._ensureCtx();
    const analyser = this._ensureAnalyser();
    if (!ctx || !analyser || !audioEl) return false;
    try {
      let src = this.elementSources.get(audioEl);
      if (!src) {
        src = ctx.createMediaElementSource(audioEl);
        this.elementSources.set(audioEl, src);
      }
      this._disconnectSource();
      src.connect(analyser);
      src.connect(ctx.destination); // без цього звук зникне
      this.source = src;
      this._start();
      return true;
    } catch (e) {
      return false; // напр. cross-origin аудіо — тихо лишаємось без рівня
    }
  }

  /* Рівень з мікрофона (слухання користувача) */
  attachStream(stream) {
    const ctx = this._ensureCtx();
    const analyser = this._ensureAnalyser();
    if (!ctx || !analyser || !stream) return false;
    try {
      this._disconnectSource();
      const src = ctx.createMediaStreamSource(stream);
      src.connect(analyser); // мікрофон у destination НЕ шлемо (буде відлуння)
      this.source = src;
      this._start();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Зупинити вимірювання і повідомити «тишу» */
  detach() {
    this._stop();
    this._disconnectSource();
    this.onLevel(0);
  }

  _disconnectSource() {
    if (this.source) {
      try { this.source.disconnect(); } catch (e) {}
      this.source = null;
    }
  }

  _start() {
    if (this.raf) return;
    const buf = new Uint8Array(this.analyser.fftSize);
    const loop = () => {
      if (!this.analyser || !this.source) { this.raf = 0; return; }
      this.analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const s = (buf[i] - 128) / 128;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / buf.length); // 0..~1, мова зазвичай 0.02..0.25
      // Нормалізуємо мову у зручний для анімації діапазон 0..1
      const level = Math.min(1, rms / 0.18);
      this.onLevel(level);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  _stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }
}

window.AudioLevelMeter = AudioLevelMeter;
