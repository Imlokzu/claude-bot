# DESIGN.md — панель Клод Бота

Цей файл читає кожен, хто (людина чи агент) торкається `dashboard/`. Він описує
_чому_ панель виглядає саме так. Якщо зміна суперечить чомусь тут — або зміна
неправильна, або файл застарів; третього не буває.

## Що це за річ

Не «AI-продукт». Це **прилад**: панель керування домашнім роботом, яка стоїть
відкритою годинами на другому моніторі й до якої тягнуться з телефона з дивана.
Отже: читабельність важливіша за ефектність, стан важливіший за оздоблення,
нічого не блимає без причини.

Характер — **тепла земля + термінал**. Польовий записник лаборанта, а не
неонова панель з фільму. Бот — піксельний краб; панель не мусить бути
піксельною, але має бути з ним однієї крові: тепла, рукотворна, трохи технічна.

## П'ять правил

1. **Ґрунт, а не скло.** Глибина будується контрастом поверхонь і межею в 1px.
   Ніякого `backdrop-filter` як основи, ніяких великих розмитих тіней, жодних
   «скляних» карток. Тінь допустима одна — м'яка амбієнтна під спливним шаром.
   Виняток — пробне рідке скло в чаті (бульбашка бота і поле вводу). Рецепт і
   заборона розносити його далі, поки власник не скаже що вигляд нормальний,
   лежать у `LIQUID-GLASS.md`.
2. **Моноширинний = дані.** Цифри, статуси, шляхи, ID, логи, назви моделей,
   гарячі клавіші — `--font-mono`. Проза, підписи й кнопки — `--font-sans`.
   Це не смак, це навігація: за шрифтом видно, де факт, а де інтерфейс.
3. **Один акцент на екран.** Акцентний колір позначає те, що зараз головне,
   і нічого більше. Якщо акцентних плям дві — одна з них неправа. Стани
   (працює / спить / помилка) мають власну шкалу й до акценту не належать.
4. **Рух дрібний і пружинний.** `spring`, не `ease`. 120–260 мс. Рух пояснює,
   звідки взявся елемент, або підтверджує натиск — і більше нічого.
   `prefers-reduced-motion` вимикає все, крім зміни непрозорості.
5. **Порожнеча — це матеріал.** Щедрі поля, вузька міра рядка (62–70 символів
   у чаті). Коли бракує місця — ріжемо вміст, а не повітря.

## Заборонено

- Градієнтні заливки як тло панелей і кнопок (акцентний градієнт — лише в
  фірмовому знаку та в індикаторі прогресу).
- Емодзі в ролі іконок. Іконки — Lucide, 1.75 товщина штриха.
- Тіні глибші за `--shadow-pop`.
- Більш ніж два розміри радіуса в одному складеному елементі.
- Спінер там, де можна показати скелетон або реальний прогрес.
- Текст-заглушка англійською. Інтерфейс україномовний повністю.

## Типографіка

**IBM Plex Sans Variable** (текст) + **IBM Plex Mono** (дані). Обидва
self-hosted через `@fontsource`, з кирилицею — панель мусить працювати без
мережі. Plex обрано не з нуля: лендінг проєкту вже на Plex Mono.

| Роль | Шрифт | Розмір / трекінг |
|---|---|---|
| Заголовок екрана | Sans 600 | 22–26px, `-0.02em` |
| Мітка секції | **Mono 500, UPPERCASE** | 11px, `+0.12em` |
| Текст | Sans 400 | 14–15px, висота 1.55 |
| Репліка в чаті | Sans 400 | 15px, висота 1.62, ширина ≤ 68ch |
| Дані / лог | Mono 400 | 12–13px |

Мітка секції моноширинними капітеллю — фірмовий прийом панелі. Він же дає
«приладовість» без жодної картинки.

Український текст проганяється через `glue()` (`src/lib/glue.ts`): короткі
прийменники й сполучники (`у в з і й та на до не що як`), числа з одиницями та
останню пару слів абзацу зшиваємо нерозривним пробілом. Ідея — з Typehug із
«UI things»; сам пакет має правила лише для англійської та польської, тож
українські правила написані свої.

## Колір

Дві теми — **Світла пустеля** й **Темний графіт** — і чотири акценти
(теракота / шавлія / океан / бурштин). Ключі `localStorage` ті самі, що в старій
панелі (`claudeBotTheme`, `claudeBotAccent`), щоб налаштування пережили переїзд.

Бази теплі: темна — не синьо-чорна, а коричнево-чорна; світла — пісок, не
білий папір. Кожен акцент має два тони: у темряві світлий варіант, інакше він
випікається.

Шкала станів окремо від акценту: `ok` (працює), `warn` (увага), `err` (впало),
`idle` (спить). Вони однакові в усіх акцентах — стан не має залежати від смаку.

## Звідки взяті готові шматки

З нотатки «UI things»:

- **React Bits · Micro** (`src/vendor/reactbits/`) — `VoicePill`, `ThoughtLine`,
  `HoldButton`, `StatusMark`, `SloshGauge`, `RubberSegment`, `SquishSwitch`,
  `SwipeToast`, `WarmTooltip`, `LatticeLoader`, `SlideCommit`, `ScrubField`,
  `SwipeRow`, `PromptBar`. Іконки перемкнуто з `@hugeicons` на Lucide
  (`_icons.jsx`), решта коду майже недоторкана — оновлюється з upstream одним
  `curl`.
- **bencho.dev** (`src/vendor/bencho/`) — радіальне меню на «+» у чаті (MIT).
  Відкрити, вибрати й підтвердити — один жест: натиснув, повів у бік
  потрібного, відпустив. Код їхнього репозиторію закритий, тож зібрано за
  опублікованими на сайті API та CSS-технікою (полярна розкладка через
  `--i`/`--n`, тригонометрія просто в CSS).
- **voice-glow** — сяйво під полем вводу, що реагує на голос. Ввімкнене ЛИШЕ
  поки слухає мікрофон (`active`, `idle=0`): постійне «дихання» під полем
  зробило б із показника запису прикрасу.
- **metal-fx** — рідкий метал на назві в шапці. Єдине місце, де такий ефект
  доречний: логотип на те й логотип, що його розглядають, а не читають. Без
  WebGL лишається `ShinyText` — той самий напис без шейдера.
- **Torph** (`torph/react`) — морфінг тексту там, де рядок міняється на місці:
  чим бот зайнятий, назва моделі, назва треку.
- **Typehug** — ідея нерозривних пробілів (реалізація своя, див. вище).
- **Colorion Toggles** — джерело форми для чистих CSS-перемикачів.
- **aicss.dev** (`src/vendor/aicss/`) — чотири «агентні» шматки з реєстру
  shadcn: `ThinkingReasoning` (блок «Думаю…», що згортається в «Думав N с»),
  `Orb` (25 індикаторів дії — по одному на кожен різновид роботи), `FileDiff`
  (картка змін у файлі) і `DataTable` (таблиця з відповіді).

  На відміну від React Bits ці файли КОПІЮЮТЬСЯ в проєкт (так працює
  `npx shadcn add`) і призначені для правок — усі вони приїхали демонстраціями
  з зашитим вмістом, тож тут приймають дані пропсами. Що саме змінено —
  написано в шапці кожного файлу.

  Наповнення цих компонентів — принципове місце. `ThinkingReasoning` в
  оригіналі показує вигадані речення «про хід думки»; наші моделі потоку
  міркувань не віддають (у SSE є лише `delta` і `tool_*`), тож блок показує
  РЕАЛЬНІ дії — кожен виклик інструмента з його аргументом. Коли бот просто
  відповів, лишається сама тривалість. Вигадувати міркування, яких не було,
  ми не стали.

Готовий чат — **@assistant-ui/react**: headless-примітиви (стрім, tool-calls,
вкладення, гілки) без нав'язаного вигляду, тож дизайн звідси видно, а не
бібліотечний.

## Навігація

Док плаває над вмістом і переноситься: затиснути й повести — прилипне до
найближчого краю (низ, верх, ліворуч, праворуч). Вибір живе в
`localStorage.claudeBotDockSide` поруч із темою й акцентом — це така сама
особиста звичка.

Dock clearance follows `data-dock` on `<html>`. In chat, only the conversation
column reserves bottom clearance; both sidebars extend to the window edge.
Vertical navigation occupies a continuous 72px surface with a dividing rule.

Вертикальний варіант — не поворот через CSS: у повернутого елемента
`getBoundingClientRect` віддає повернуту рамку, і збільшення під курсором
перестає за ним слідувати. Тому вісь стала параметром самого компонента
(див. шапку `Dock.jsx`).

## Розкладка

Три пороги: `< 760px` телефон (нижня навігація, один стовпець, шухляди
замість бічних панелей), `760–1180px` планшет, `> 1180px` стіл (бічна рейка
розділів + дві-три колонки). Безпечні зони iOS через `env(safe-area-inset-*)` —
панель ставиться на домашній екран як PWA.

## Chat workspace (2026-09-20)

- Preserve the existing warm palette, Plex typography, and thin surface borders.
- Desktop chat's right rail offers opt-in Projects, Vision, and Screen pins from
  a bottom-anchored plus menu. Selection and order persist locally. Pins remain a desktop column;
  narrow layouts reach them through the "+" sheet as a dialog.
- The screen pin embeds the real same-origin `/screen` at its native 320x240 size.
  Removing a pin unmounts its iframe/stream. Pinning Vision does not start a camera.
- Standalone Markdown images in one reply share the existing React Bits accordion,
  even with prose between them. Captions and all prose remain; inline illustrations,
  links, tables, and code examples are not regrouped.
- Radial-menu taps toggle it; dragging selects once; Escape and outside clicks close
  it. Keyboard activation must retain trigger focus, not focus the composer.
- New labels use `src/locales/workspace.ts` (Ukrainian and English).
- Checks: `npm test`, `npm run typecheck`, `npm run build`; optional
  `npm run test:browser` uses an installed agent-browser and a running server with
  isolated browser-only fixtures, never real chat writes. Tests require Node 22.6+.

## Narrow chat (2026-09-23)

Below the desk breakpoint the chat is reorganised around the thumb, after the
owner's sketch:

- **Header:** conversations list | model name as the title | new conversation.
  The title opens `ModelMenu`: the model list and the thinking level as a row
  of stops. The compact face is gone from this header — at this width it was
  an ornament competing with the model name.
- **Prompt bar:** only what you type with — "+", the field, mic, send. The
  model and thinking pickers moved to the header; they squeezed the field to
  a few words.
- **"+" sheet** (`AttachSheet`), opening in place above the bar: camera,
  photos and files as thumb-sized tiles, then context, tools and panels as
  rows. The context meter moved here from under the bar.
- Escape peels one layer at a time; a tap inside the context popover does not
  count as a tap outside the sheet.
- The desktop layout is unchanged.

## Model picker (2026-09-24)

One `ModelMenu` for every layout — the phone chat header's title, and on the
desk the slot in the prompt bar where the vendor pickers were (PromptBar
edit 6, `modelSlot`). The catalog grew to ~60 models with the same model
often listed under three hosts, and a plain dropdown in catalog order meant
scrolling past all of it.

- **Maker logos** from lobe-icons (`src/vendor/lobe-icons/`, MIT), copied
  rather than installed: ~15 of the package's 950 icons. Monochrome, filled
  with `currentColor` — they take the text colour and follow both themes; a
  column of brand colours would break rule 3. The maker comes from the model
  part of the id, never the host (`regolo/gpt-oss-120b` is OpenAI's). Unknown
  makers get a neutral mark rather than a guessed logo.
- **Search** matches the start of any word, in any order, ignoring the
  catalog's punctuation ("gpt6", "qwen 3.8", "regolo qwen", "xai").
- **Sort**: by maker (grouped, sticky headings), A–Z, or by context window.
  The choice persists in `localStorage.claudeBotModelSort`.
- **Recent**: the last three picks lead the list while nothing is typed.
- The host is shown under each name, so the copies of one model can be told
  apart.

