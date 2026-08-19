/* ============================================================
   Звичайні (векторні) іконки для стилів «однотонні» та «кольорові».

   Піксельний набір лишається там, де він доречний: годинник, дрібні
   перемикачі, стрічка керування. Але у великій круглій плитці лаунчера
   піксель читається як пляма — там потрібна нормальна контурна іконка,
   як у будь-якому телефоні.

   Стиль спільний з панеллю: viewBox 24×24, лише обведення (stroke:
   currentColor), без заливки — тож колір і товщина живуть у CSS.
   ============================================================ */

const PATHS = {
  face:
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M9 10.5h.01M15 10.5h.01"/>' +
    '<path d="M8.8 14.5a4.2 4.2 0 0 0 6.4 0"/>',
  clock:
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M12 7.2V12l3.2 2"/>',
  mic:
    '<rect x="9.2" y="3.2" width="5.6" height="10" rx="2.8"/>' +
    '<path d="M6.5 11.2a5.5 5.5 0 0 0 11 0"/>' +
    '<path d="M12 16.7V20M9 20h6"/>',
  bubble:
    '<path d="M20 13.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 3.2V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5z"/>',
  gauge:
    '<path d="M3.5 12h3.2l2-4.5 3 9 2.4-6 1.7 3h4.7"/>',
  sliders:
    '<path d="M3.5 8.5h17M3.5 15.5h17"/>' +
    '<circle cx="9" cy="8.5" r="2.2"/>' +
    '<circle cx="15.5" cy="15.5" r="2.2"/>',
  camera:
    '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.3l1.2-2h7l1.2 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>' +
    '<circle cx="12" cy="12.5" r="3.3"/>',
  server:
    '<rect x="3.5" y="4.5" width="17" height="6" rx="1.6"/>' +
    '<rect x="3.5" y="13.5" width="17" height="6" rx="1.6"/>' +
    '<path d="M7 7.5h.01M7 16.5h.01"/>',
  monitor:
    '<rect x="3.2" y="4.5" width="17.6" height="12" rx="1.8"/>' +
    '<path d="M9 20h6M12 16.5V20"/>',
  settings:
    '<path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18"/>' +
    '<circle cx="12" cy="12" r="4.2"/>',
  grid:
    '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/>' +
    '<rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/>' +
    '<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/>' +
    '<rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
  memory:
    '<path d="M6 4.5h10.5A2.5 2.5 0 0 1 19 7v12.5H8.5A2.5 2.5 0 0 1 6 17z"/>' +
    '<path d="M6 7h-1.5A1.5 1.5 0 0 0 3 8.5v8A2.5 2.5 0 0 0 5.5 19H8M9 9h6M9 12.5h6M9 16h4"/>',
  history:
    '<path d="M4.5 9.5A8 8 0 1 1 6.8 17"/>' +
    '<path d="M4.5 4.5v5h5M12 7.5v5l3 2"/>',
  /* Далі — відповідники піксельних іконок дрібного керування: без них
     стиль «звичайні» діяв би лише в шухляді, а решта екрана лишалась би
     піксельною, і вибір виглядав би зламаним. */
  moon: '<path d="M20 14.2A8.5 8.5 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2z"/>',
  sun:
    '<circle cx="12" cy="12" r="3.8"/>' +
    '<path d="M12 3v2M12 19v2M21 12h-2M5 12H3M18.4 5.6l-1.4 1.4M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6"/>',
  contrast:
    '<circle cx="12" cy="12" r="8.5"/>' +
    '<path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>',
  speaker:
    '<path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z"/>' +
    '<path d="M15.5 9.2a4 4 0 0 1 0 5.6"/>',
  power:
    '<path d="M12 3.5v8"/>' +
    '<path d="M7.5 6.6a7 7 0 1 0 9 0"/>',
  expand:
    '<path d="M8.5 3.5H3.5v5M15.5 3.5h5v5M20.5 15.5v5h-5M3.5 15.5v5h5"/>',
  pencil:
    '<path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list:
    '<path d="M4 6.5h.01M4 12h.01M4 17.5h.01M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5"/>',
};

/* Кольорова палітра: кожна іконка має свій відтінок, як застосунки на
   телефоні. Використовується лише в стилі «кольорові». */
export const ICON_COLORS = {
  face: "#d98263",
  clock: "#7fa8d8",
  mic: "#79b07a",
  bubble: "#b48ad8",
  gauge: "#d7a65b",
  sliders: "#5fb0a8",
  camera: "#d98aa8",
  server: "#8b9dd8",
  monitor: "#9aa3a8",
  settings: "#d7a65b",
  grid: "#6fa8dc",
  memory: "#d7a65b",
  history: "#7fa8d8",
  moon: "#8b9dd8",
  sun: "#d7a65b",
  contrast: "#b48ad8",
  speaker: "#79b07a",
  power: "#d07a6a",
  expand: "#5fb0a8",
  pencil: "#9aa3a8",
  plus: "#9aa3a8",
  list: "#9aa3a8",
};

/** Готовий <svg> як елемент; колір і товщина — з CSS. */
export function makeSvgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("svgicon");
  svg.innerHTML = PATHS[name] || PATHS.grid;
  return svg;
}

export const ICON_NAMES = Object.keys(PATHS);
