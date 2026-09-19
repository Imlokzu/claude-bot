/*
 * Міст між React Bits і нашим набором іконок.
 *
 * Компоненти з reactbits.dev/c/micro приходять із @hugeicons. Другий набір
 * іконок у проєкті нам не потрібен (дефолт — Lucide, див. ~/stack/ui-effects.md),
 * тому тут ті самі імена перепризначені на гліфи Lucide.
 *
 * ЧОМУ ДАНІ, А НЕ КОМПОНЕНТИ. Спершу тут стояли React-компоненти Lucide, і
 * це ламалось: частина вендорних файлів читає іконку як ДАНІ, а не рендерить
 * її — напр. SpringCheck бере `Tick02Icon[0][1].d`, а PulseHeart робить
 * `paths.map(([, attrs]) => attrs.d)`. На компоненті це давало
 * «Cannot read properties of undefined» ще на імпорті модуля, і через
 * спільний бар'єр падав увесь застосунок. Тому формат тут — той самий
 * масив [тег, атрибути], що й у @hugeicons, а <HugeiconsIcon> уміє його
 * намалювати. Обидва способи використання працюють без правок у вендорі.
 *
 * Дані згенеровані з реально встановленого lucide-react, а не переписані
 * руками: `node src/vendor/reactbits/_icons.gen.mjs > /tmp/icons.json`.
 * Якщо новий компонент просить іконку, якої тут немає — додай її в MAP
 * генератора й перегенеруй.
 */

export const Alert02Icon = [
  ['path', { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
  ['path', { d: "M12 9v4" }],
  ['path', { d: "M12 17h.01" }],
];

export const Archive02Icon = [
  ['rect', { "width": "20", "height": "5", "x": "2", "y": "3", "rx": "1" }],
  ['path', { d: "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" }],
  ['path', { d: "M10 12h4" }],
];

export const ArrowDown01Icon = [
  ['path', { d: "m6 9 6 6 6-6" }],
];

export const ArrowLeft01Icon = [
  ['path', { d: "m15 18-6-6 6-6" }],
];

export const ArrowRight02Icon = [
  ['path', { d: "M5 12h14" }],
  ['path', { d: "m12 5 7 7-7 7" }],
];

export const ArrowUp02Icon = [
  ['path', { d: "m5 12 7-7 7 7" }],
  ['path', { d: "M12 19V5" }],
];

export const Cancel01Icon = [
  ['path', { d: "M18 6 6 18" }],
  ['path', { d: "m6 6 12 12" }],
];

export const CommandLineIcon = [
  ['path', { d: "m7 11 2-2-2-2" }],
  ['path', { d: "M11 13h4" }],
  ['rect', { "width": "18", "height": "18", "x": "3", "y": "3", "rx": "2", "ry": "2" }],
];

export const CursorPointer01Icon = [
  ['path', { d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" }],
];

export const Delete02Icon = [
  ['path', { d: "M10 11v6" }],
  ['path', { d: "M14 11v6" }],
  ['path', { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
  ['path', { d: "M3 6h18" }],
  ['path', { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
];

export const Download04Icon = [
  ['path', { d: "M12 15V3" }],
  ['path', { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
  ['path', { d: "m7 10 5 5 5-5" }],
];

export const FavouriteIcon = [
  ['path', { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" }],
];

export const File02Icon = [
  ['path', { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
  ['path', { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
];

export const FlashIcon = [
  ['path', { d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" }],
];

export const Globe02Icon = [
  ['circle', { "cx": "12", "cy": "12", "r": "10" }],
  ['path', { d: "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" }],
  ['path', { d: "M2 12h20" }],
];

export const HelpCircleIcon = [
  ['circle', { "cx": "12", "cy": "12", "r": "10" }],
  ['path', { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
  ['path', { d: "M12 17h.01" }],
];

export const Layers01Icon = [
  ['path', { d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" }],
  ['path', { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }],
  ['path', { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }],
];

export const Loading03Icon = [
  ['path', { d: "M21 12a9 9 0 1 1-6.219-8.56" }],
];

export const Mail01Icon = [
  ['path', { d: "m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" }],
  ['rect', { "x": "2", "y": "4", "width": "20", "height": "16", "rx": "2" }],
];

export const Mic01Icon = [
  ['path', { d: "M12 19v3" }],
  ['path', { d: "M19 10v2a7 7 0 0 1-14 0v-2" }],
  ['rect', { "x": "9", "y": "2", "width": "6", "height": "13", "rx": "3" }],
];

export const Notification03Icon = [
  ['path', { d: "M10.268 21a2 2 0 0 0 3.464 0" }],
  ['path', { d: "M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" }],
];

export const PaintBoardIcon = [
  ['path', { d: "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" }],
  ['circle', { "cx": "13.5", "cy": "6.5", "r": ".5", "fill": "currentColor" }],
  ['circle', { "cx": "17.5", "cy": "10.5", "r": ".5", "fill": "currentColor" }],
  ['circle', { "cx": "6.5", "cy": "12.5", "r": ".5", "fill": "currentColor" }],
  ['circle', { "cx": "8.5", "cy": "7.5", "r": ".5", "fill": "currentColor" }],
];

export const PencilEdit01Icon = [
  ['path', { d: "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" }],
  ['path', { d: "m15 5 4 4" }],
];

export const PlusSignIcon = [
  ['path', { d: "M5 12h14" }],
  ['path', { d: "M12 5v14" }],
];

export const RefreshIcon = [
  ['path', { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
  ['path', { d: "M21 3v5h-5" }],
  ['path', { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
  ['path', { d: "M8 16H3v5" }],
];

export const Rocket01Icon = [
  ['path', { d: "M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" }],
  ['path', { d: "M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" }],
  ['path', { d: "M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" }],
  ['path', { d: "M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" }],
];

export const Search01Icon = [
  ['path', { d: "m21 21-4.34-4.34" }],
  ['circle', { "cx": "11", "cy": "11", "r": "8" }],
];

export const Settings02Icon = [
  ['path', { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }],
  ['circle', { "cx": "12", "cy": "12", "r": "3" }],
];

export const SparklesIcon = [
  ['path', { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }],
  ['path', { d: "M20 2v4" }],
  ['path', { d: "M22 4h-4" }],
  ['circle', { "cx": "4", "cy": "20", "r": "2" }],
];

export const StarIcon = [
  ['path', { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }],
];

export const Attachment01Icon = [
  ['path', { d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551" }],
];

export const Calendar03Icon = [
  ['path', { d: "M8 2v3" }],
  ['path', { d: "M16 2v3" }],
  ['rect', { "x": "3", "y": "3", "width": "18", "height": "18", "rx": "2" }],
  ['path', { d: "M3 9h18" }],
];

export const ChartLineData01Icon = [
  ['path', { d: "M3 3v16a2 2 0 0 0 2 2h16" }],
  ['path', { d: "m19 9-5 5-4-4-3 3" }],
];

export const CheckIcon = [
  ['path', { d: "M20 6 9 17l-5-5" }],
];

export const DockIcon = [
  ['rect', { "width": "18", "height": "18", "x": "3", "y": "3", "rx": "2" }],
  ['path', { d: "M3 15h18" }],
];

export const TextFontIcon = [
  ['path', { d: "M12 4v16" }],
  ['path', { d: "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2" }],
  ['path', { d: "M9 20h6" }],
];

export const ThumbsUpIcon = [
  ['path', { d: "M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" }],
  ['path', { d: "M7 10v12" }],
];

export const Tick02Icon = [
  ['path', { d: "M20 6 9 17l-5-5" }],
];

export const Undo02Icon = [
  ['path', { d: "M9 14 4 9l5-5" }],
  ['path', { d: "M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" }],
];

/**
 * Рендер іконки. Приймає і масив вузлів (наш формат вище), і звичайний
 * React-компонент — щоб виклики з інших наборів теж не ламались.
 */
export function HugeiconsIcon({
  icon,
  size = 20,
  strokeWidth = 1.8,
  color = 'currentColor',
  fill = 'none',
  ...rest
}) {
  if (!icon) return null;

  if (!Array.isArray(icon)) {
    const Icon = icon;
    return <Icon size={size} strokeWidth={strokeWidth} color={color} {...rest} />;
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {icon.map(([Tag, attrs], index) => (
        <Tag key={index} {...attrs} />
      ))}
    </svg>
  );
}
