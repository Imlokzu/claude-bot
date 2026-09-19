import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as L from 'lucide-react';

const MAP = {
  Alert02Icon: 'TriangleAlert', Archive02Icon: 'Archive', ArrowDown01Icon: 'ChevronDown',
  ArrowLeft01Icon: 'ChevronLeft', ArrowRight02Icon: 'ArrowRight', ArrowUp02Icon: 'ArrowUp',
  Cancel01Icon: 'X', CommandLineIcon: 'SquareTerminal', CursorPointer01Icon: 'MousePointer2',
  Delete02Icon: 'Trash2', Download04Icon: 'Download', FavouriteIcon: 'Heart', File02Icon: 'File',
  FlashIcon: 'Zap', Globe02Icon: 'Globe', HelpCircleIcon: 'CircleHelp', Layers01Icon: 'Layers',
  Loading03Icon: 'LoaderCircle', Mail01Icon: 'Mail', Mic01Icon: 'Mic', Notification03Icon: 'Bell',
  PaintBoardIcon: 'Palette', PencilEdit01Icon: 'Pencil', PlusSignIcon: 'Plus', RefreshIcon: 'RefreshCw',
  Rocket01Icon: 'Rocket', Search01Icon: 'Search', Settings02Icon: 'Settings', SparklesIcon: 'Sparkles',
  StarIcon: 'Star', Attachment01Icon: 'Paperclip', Calendar03Icon: 'Calendar',
  ChartLineData01Icon: 'ChartLine', CheckIcon: 'Check', DockIcon: 'PanelBottom', TextFontIcon: 'Type', ThumbsUpIcon: 'ThumbsUp', Tick02Icon: 'Check', Undo02Icon: 'Undo2',
};

const out = [];
for (const [alias, lucideName] of Object.entries(MAP)) {
  const Icon = L[lucideName];
  if (!Icon) { console.error('MISSING', lucideName); continue; }
  const html = renderToStaticMarkup(createElement(Icon));
  // Витягуємо кожен дочірній елемент svg із його атрибутами.
  const nodes = [...html.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*)\/?>/g)].map((m) => {
    const tag = m[1];
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return [tag, attrs];
  });
  if (!nodes.length) { console.error('NO NODES', lucideName); continue; }
  out.push([alias, nodes]);
}
console.log(JSON.stringify(Object.fromEntries(out), null, 0));
