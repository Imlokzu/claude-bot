/*
 * Типізований бар'єр навколо React Bits · Micro.
 *
 * Вендорні файли — звичайний JSX без типів, і TypeScript, виводячи їх сам,
 * оголошує обов'язковим кожен пропс без значення за замовчуванням (style,
 * elapsed, delay…). Тому тут один раз описано те, чим ми справді
 * користуємось, а решта лишається дозволеною через index-сигнатуру.
 *
 * Компоненти імпортувати ЛИШЕ звідси — тоді оновлення upstream не тягне за
 * собою правок по всьому дереву.
 */
import type { ComponentType, CSSProperties, ReactNode } from 'react';

import SquishSwitchRaw from './SquishSwitch.jsx';
import RubberSegmentRaw from './RubberSegment.jsx';
import StatusMarkRaw from './StatusMark.jsx';
import LatticeLoaderRaw from './LatticeLoader.jsx';
import SwipeToastRaw from './SwipeToast.jsx';
import WarmTooltipRaw from './WarmTooltip.jsx';
import ThoughtLineRaw from './ThoughtLine.jsx';
import VoicePillRaw from './VoicePill.jsx';
import HoldButtonRaw from './HoldButton.jsx';
import SloshGaugeRaw from './SloshGauge.jsx';
import SlideCommitRaw from './SlideCommit.jsx';
import ScrubFieldRaw from './ScrubField.jsx';
import SwipeRowRaw from './SwipeRow.jsx';
import PromptBarRaw from './PromptBar.jsx';
import RefineFrameRaw from './RefineFrame.jsx';
import GlideSelectRaw from './GlideSelect.jsx';
import JellyRadioRaw from './JellyRadio.jsx';
import BranchedMenuRaw from './BranchedMenu.jsx';
import CallChipRaw from './CallChip.jsx';
import SlingButtonRaw from './SlingButton.jsx';
import FuseButtonRaw from './FuseButton.jsx';
import PulseHeartRaw from './PulseHeart.jsx';
import BellToggleRaw from './BellToggle.jsx';
import SpringCheckRaw from './SpringCheck.jsx';
import WakeSliderRaw from './WakeSlider.jsx';
import CometDialRaw from './CometDial.jsx';
import PeekRatingRaw from './PeekRating.jsx';
import FolderFloatRaw from './FolderFloat.jsx';
import AccordionGalleryRaw from './AccordionGallery.jsx';

import DockRaw from './Dock.jsx';
import SpotlightCardRaw from './SpotlightCard.jsx';
import PixelCardRaw from './PixelCard.jsx';
import AnimatedListRaw from './AnimatedList.jsx';
import DecryptedTextRaw from './DecryptedText.jsx';
import TextTypeRaw from './TextType.jsx';
import SplitFlapTextRaw from './SplitFlapText.jsx';
import ShinyTextRaw from './ShinyText.jsx';
import CountUpRaw from './CountUp.jsx';
import CounterRaw from './Counter.jsx';
import ClickSparkRaw from './ClickSpark.jsx';
import MagnetRaw from './Magnet.jsx';
import ElectricBorderRaw from './ElectricBorder.jsx';
import StarBorderRaw from './StarBorder.jsx';
import GlareHoverRaw from './GlareHover.jsx';
import DotGridRaw from './DotGrid.jsx';
import StepperRaw, { Step as StepRaw } from './Stepper.jsx';
import AnimatedContentRaw from './AnimatedContent.jsx';
import { ParticleCard as ParticleCardRaw, GlobalSpotlight as GlobalSpotlightRaw } from './MagicBento.jsx';

interface Common {
  className?: string;
  style?: CSSProperties;
  [key: string]: unknown;
}

export interface SquishSwitchProps extends Common {
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  width?: number;
  height?: number;
  radius?: number;
  trackColor?: string;
  trackOnColor?: string;
  thumbColor?: string;
  thumbOnColor?: string;
}

export interface RubberSegmentProps extends Common {
  items: { value: string; label: ReactNode }[];
  value?: string;
  defaultValue?: string;
  onChange?: (next: string) => void;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  disabled?: boolean;
  trackColor?: string;
  thumbColor?: string;
  textColor?: string;
  activeTextColor?: string;
  'aria-label'?: string;
}

export interface StatusMarkProps extends Common {
  status?: 'pending' | 'active' | 'done' | 'failed';
  progress?: number;
  label?: ReactNode;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  size?: number;
  strokeWidth?: number;
  fontSize?: number;
}

export interface LatticeLoaderProps extends Common {
  label?: string;
  doneLabel?: string;
  errorLabel?: string;
  status?: 'working' | 'done' | 'error';
  pattern?: string;
  cellSize?: number;
  gap?: number;
  fontSize?: number;
  color?: string;
  doneColor?: string;
  errorColor?: string;
  idleOpacity?: number;
  showTimer?: boolean;
  elapsed?: number;
}

export interface SwipeToastProps extends Common {
  title?: string;
  description?: string;
  icon?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  open?: boolean;
  onClose?: (reason?: string) => void;
  background?: string;
  color?: string;
  fuseColor?: string;
  width?: number;
  radius?: number;
  duration?: number;
  inline?: boolean;
  dismissible?: boolean;
}

export interface WarmTooltipProps extends Common {
  content: ReactNode;
  shortcut?: string;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  warmWindow?: number;
  surfaceColor?: string;
  inkColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  arrow?: boolean;
  disabled?: boolean;
}

export interface ThoughtLineProps extends Common {
  label?: string;
  doneLabel?: string;
  steps?: { label: string; status?: string }[];
  glyph?: string;
  collapsible?: boolean;
  collapseOnSettle?: boolean;
  color?: string;
  glyphColor?: string;
  fontSize?: number;
  working?: boolean;
  showTimer?: boolean;
  elapsed?: number;
  onSettle?: () => void;
}

export interface VoicePillProps extends Common {
  accentColor?: string;
  iconColor?: string;
  background?: string;
  size?: number;
  shape?: 'pill' | 'circle';
  showTime?: boolean;
  waveform?: boolean;
  slideToCancel?: boolean;
  mode?: 'auto' | 'hold' | 'toggle';
  reactive?: 'simulated' | 'mic';
  disabled?: boolean;
  ariaLabel?: string;
  onStart?: () => void;
  onStop?: (info: { duration?: number; cancelled?: boolean }) => void;
}

export interface HoldButtonProps extends Common {
  children?: ReactNode;
  doneLabel?: string;
  icon?: ReactNode;
  doneIcon?: ReactNode;
  onHold?: () => void;
  onTap?: () => void;
  holdTime?: number;
  backgroundColor?: string;
  textColor?: string;
  fillColor?: string;
  fillTextColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  disabled?: boolean;
}

export interface SloshGaugeProps extends Common {
  value?: number;
  min?: number;
  max?: number;
  glassColor?: string;
  liquidColor?: string;
  onLiquidColor?: string;
  width?: number;
  height?: number;
}

export interface SlideCommitProps extends Common {
  label?: string;
  doneLabel?: string;
  errorLabel?: string;
  onConfirm?: () => void | Promise<void>;
  onDone?: () => void;
  onError?: (error: unknown) => void;
  icon?: ReactNode;
  trackColor?: string;
  handleColor?: string;
  successColor?: string;
  dangerColor?: string;
  width?: number;
  height?: number;
  radius?: number;
  disabled?: boolean;
}

export interface ScrubFieldProps extends Common {
  value?: number;
  onChange?: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  accentColor?: string;
  chipColor?: string;
}

export interface SwipeRowAction {
  id: string;
  label: string;
  icon?: ReactNode;
  color?: string;
}

export interface SwipeRowProps extends Common {
  children: ReactNode;
  /** Перша — та, що спрацьовує повним змахом (коли fullSwipe увімкнено). */
  actions?: SwipeRowAction[];
  onAction?: (action: SwipeRowAction) => void;
  onCommit?: (action: SwipeRowAction) => void;
  onOpenChange?: (open: boolean) => void;
  actionColor?: string;
  drawerColor?: string;
  rowColor?: string;
  textColor?: string;
  height?: number;
  radius?: number;
  actionWidth?: number;
  direction?: 'left' | 'right';
  fullSwipe?: boolean;
  disabled?: boolean;
  label?: string;
}


/* ---------- структурні: з них складається новий вигляд панелі ---------- */

export interface DockItem {
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  className?: string;
}

export interface DockProps extends Common {
  items: DockItem[];
  magnification?: number;
  distance?: number;
  panelHeight?: number;
  dockHeight?: number;
  baseItemSize?: number;
  spring?: { mass: number; stiffness: number; damping: number };
  /** Наша правка у вендорному файлі — див. шапку Dock.jsx. */
  axis?: 'x' | 'y';
}

export interface SpotlightCardProps extends Common {
  children: ReactNode;
  spotlightColor?: string;
}

export interface PixelCardProps extends Common {
  children: ReactNode;
  variant?: 'default' | 'blue' | 'yellow' | 'pink';
  gap?: number;
  speed?: number;
  colors?: string;
  noFocus?: boolean;
}

export interface ParticleCardProps extends Common {
  children: ReactNode;
  disableAnimations?: boolean;
  particleCount?: number;
  /** Колір частинок у форматі "R, G, B" — так його очікує MagicBento. */
  glowColor?: string;
  enableTilt?: boolean;
  clickEffect?: boolean;
  enableMagnetism?: boolean;
}

export interface GlobalSpotlightProps {
  gridRef: { current: HTMLElement | null };
  disableAnimations?: boolean;
  enabled?: boolean;
  spotlightRadius?: number;
  glowColor?: string;
}

export interface AnimatedListProps extends Common {
  items: ReactNode[];
  onItemSelect?: (item: ReactNode, index: number) => void;
  showGradients?: boolean;
  enableArrowNavigation?: boolean;
  itemClassName?: string;
  displayScrollbar?: boolean;
  initialSelectedIndex?: number;
}

export interface DecryptedTextProps extends Common {
  text: string;
  speed?: number;
  maxIterations?: number;
  sequential?: boolean;
  revealDirection?: 'start' | 'end' | 'center';
  useOriginalCharsOnly?: boolean;
  characters?: string;
  animateOn?: 'hover' | 'view';
  parentClassName?: string;
  encryptedClassName?: string;
}

export interface TextTypeProps extends Common {
  text: string | string[];
  as?: string;
  typingSpeed?: number;
  initialDelay?: number;
  pauseDuration?: number;
  deletingSpeed?: number;
  loop?: boolean;
  showCursor?: boolean;
  cursorCharacter?: string;
  cursorClassName?: string;
  textColors?: string[];
  startOnVisible?: boolean;
}

export interface SplitFlapTextProps extends Common {
  text?: string;
  words?: string[];
  flipDuration?: number;
  stagger?: number;
  cycleDelay?: number;
  charset?: string;
  tileColor?: string;
  textColor?: string;
  tileRadius?: number;
  gap?: number;
  fontSize?: number;
  loop?: boolean;
  padTo?: number;
}

export interface ShinyTextProps extends Common {
  text: string;
  disabled?: boolean;
  speed?: number;
  color?: string;
  shineColor?: string;
  spread?: number;
  pauseOnHover?: boolean;
}

export interface CountUpProps extends Common {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  separator?: string;
  startWhen?: boolean;
}

export interface CounterProps extends Common {
  value: number;
  fontSize?: number;
  gap?: number;
  textColor?: string;
  fontWeight?: string | number;
  borderRadius?: number;
  horizontalPadding?: number;
  padding?: number;
}

export interface ClickSparkProps {
  children: ReactNode;
  sparkColor?: string;
  sparkSize?: number;
  sparkRadius?: number;
  sparkCount?: number;
  duration?: number;
  extraScale?: number;
}

export interface MagnetProps extends Common {
  children: ReactNode;
  padding?: number;
  disabled?: boolean;
  magnetStrength?: number;
  wrapperClassName?: string;
  innerClassName?: string;
}

export interface ElectricBorderProps extends Common {
  children: ReactNode;
  color?: string;
  speed?: number;
  chaos?: number;
  borderRadius?: number;
}

export interface StarBorderProps extends Common {
  children: ReactNode;
  as?: string;
  color?: string;
  speed?: string;
  thickness?: number;
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  onClick?: () => void;
}

export interface GlareHoverProps extends Common {
  children: ReactNode;
  width?: string;
  height?: string;
  background?: string;
  borderRadius?: string;
  borderColor?: string;
  glareColor?: string;
  glareOpacity?: number;
  glareAngle?: number;
  glareSize?: number;
  transitionDuration?: number;
}

export interface DotGridProps extends Common {
  dotSize?: number;
  gap?: number;
  baseColor?: string;
  activeColor?: string;
  proximity?: number;
  shockRadius?: number;
  shockStrength?: number;
  returnDuration?: number;
}

export interface StepperProps extends Common {
  children: ReactNode;
  initialStep?: number;
  onStepChange?: (step: number) => void;
  onFinalStepCompleted?: () => void;
  backButtonText?: string;
  nextButtonText?: string;
  disableStepIndicators?: boolean;
  stepCircleContainerClassName?: string;
  contentClassName?: string;
  footerClassName?: string;
}

export interface AnimatedContentProps extends Common {
  children: ReactNode;
  distance?: number;
  direction?: 'vertical' | 'horizontal';
  reverse?: boolean;
  duration?: number;
  ease?: string;
  initialOpacity?: number;
  animateOpacity?: boolean;
  scale?: number;
  threshold?: number;
  delay?: number;
}

/* ---------- готові компоненти ---------- */


/* ---------- керування: модель, зусилля, вкладення, надсилання ---------- */

export interface GlideOption {
  value: string;
  label: string;
  tag?: string;
  disabled?: boolean;
}

export interface GlideSelectProps extends Common {
  options: GlideOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  showTags?: boolean;
  accentColor?: string;
  surfaceColor?: string;
  highlightColor?: string;
  textColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  menuWidth?: number;
  placement?: 'top' | 'bottom';
  align?: 'left' | 'right';
  disabled?: boolean;
  ariaLabel?: string;
}

export interface JellyRadioProps extends Common {
  items: { value: string; label: string }[] | string[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  chipColor?: string;
  activeColor?: string;
  textColor?: string;
  activeTextColor?: string;
  size?: 'sm' | 'md' | 'lg';
  gap?: number;
  radius?: number;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface BranchedMenuItem {
  label: string;
  value?: string;
  icon?: ReactNode;
  children?: BranchedMenuItem[];
}

export interface BranchedMenuProps extends Common {
  items: BranchedMenuItem[];
  defaultOpen?: number | number[];
  defaultActive?: string;
  onSelect?: (item: BranchedMenuItem) => void;
  color?: string;
  accentColor?: string;
  lineColor?: string;
  width?: number;
  rowHeight?: number;
  fontSize?: number;
  radius?: number;
}

export interface CallChipProps extends Common {
  icon?: string;
  name?: string;
  argument?: string;
  status?: 'running' | 'done' | 'error';
  expectedMs?: number;
  size?: number;
  radius?: number;
  color?: string;
  surfaceColor?: string;
  doneColor?: string;
  errorColor?: string;
  showTimer?: boolean;
  onRetry?: () => void;
}

export interface SlingButtonProps extends Common {
  children?: ReactNode;
  onSend?: () => void;
  padColor?: string;
  iconColor?: string;
  accentColor?: string;
  wellColor?: string;
  bandColor?: string;
  size?: number;
  maxPull?: number;
  tapSends?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface FuseButtonProps extends Common {
  label?: string;
  undoLabel?: string;
  doneLabel?: string;
  icon?: ReactNode;
  color?: string;
  background?: string;
  fuseColor?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  undoWindow?: number;
  disabled?: boolean;
  onCommit?: () => void;
  onUndo?: () => void;
}

export interface PulseHeartProps extends Common {
  liked?: boolean;
  defaultLiked?: boolean;
  count?: number;
  onChange?: (liked: boolean) => void;
  showCount?: boolean;
  icon?: string;
  size?: number;
  likedColor?: string;
  idleColor?: string;
  pillColor?: string;
  textColor?: string;
  label?: string;
}

export interface BellToggleProps extends Common {
  offLabel?: string;
  onLabel?: string;
  pressed?: boolean;
  defaultPressed?: boolean;
  onChange?: (on: boolean) => void;
  color?: string;
  background?: string;
  onColor?: string;
  onBackground?: string;
  size?: 'sm' | 'md' | 'lg';
  radius?: number;
  badge?: boolean;
  count?: number;
}

export interface SpringCheckProps extends Common {
  label?: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  color?: string;
  fillColor?: string;
  checkColor?: string;
  boxSize?: number;
  fontSize?: number;
  ariaLabel?: string;
}

export interface WakeSliderProps extends Common {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  bars?: number;
  height?: number;
  restHeight?: number;
  gap?: number;
  fillColor?: string;
  trackColor?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  disabled?: boolean;
  ariaLabel?: string;
}

export interface CometDialProps extends Common {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  accent?: string;
  ink?: string;
  size?: number;
  thickness?: number;
  disabled?: boolean;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void;
}

export interface PeekRatingProps extends Common {
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  count?: number;
  shape?: string;
  labels?: string[];
  activeColor?: string;
  idleColor?: string;
  tipColor?: string;
  tipTextColor?: string;
  size?: number;
  readOnly?: boolean;
  ariaLabel?: string;
}

export interface PromptBarModel {
  key: string;
  name: string;
  /** Компонент вставляє це у рядок як є, тож сюди можна класти й розмітку —
      у нас це значки особливостей моделі замість підпису. */
  tag?: ReactNode;
}

export interface PromptBarSource {
  key: string;
  name: string;
  description?: string;
  icon?: unknown;
  attach?: boolean;
}

export interface PromptBarCommand {
  key: string;
  name: string;
  description?: string;
}

export interface PromptBarProps extends Common {
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  defaultModel?: string;
  efforts?: string[];
  defaultEffort?: string;
  onEffortChange?: (effort: string) => void;
  /** Наші правки у вендорному файлі — див. шапку PromptBar.jsx. */
  onModelChange?: (key: string) => void;
  /** Чим замінити кнопку «+» (у нас — радіальне меню). */
  plusSlot?: ReactNode;
  /** Підписи компонента — у вендора вони зашиті англійською. */
  labels?: {
    effort?: string;
    effortHint?: string;
    faster?: string;
    smarter?: string;
    sources?: string;
    commands?: string;
    models?: string;
    chooseModel?: string;
    chooseEffort?: string;
    prompt?: string;
    add?: string;
    listening?: string;
    dictate?: string;
    stopDictation?: string;
    send?: string;
    stop?: string;
  };
  busy?: boolean;
  /** `model` приходить ОБʼЄКТОМ зі списку `models`, а не ключем. */
  onSend?: (
    text: string,
    meta: { attachments: unknown[]; model?: PromptBarModel; effort?: string },
  ) => void;
  onStop?: () => void;
  onAttach?: () => unknown;
  onDictate?: () => unknown;
  /** Наша правка: людина натиснула мікрофон удруге — фразу закінчено,
      запис треба закрити й віддати на розпізнавання. */
  onDictateStop?: () => void;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  width?: number | string;
  radius?: number;
  maxRows?: number;
}

export interface RefineFrameProps extends Common {
  children?: ReactNode;
  status?: 'generating' | 'refining' | 'done' | 'error';
  aspectRatio?: string;
  width?: number | string;
  radius?: number;
  background?: string;
  color?: string;
  labels?: Record<string, string>;
  retryLabel?: string;
  onRetry?: () => void;
  showStatus?: boolean;
}

export interface FolderFloatProps extends Common {
  items: ({ label: string; value?: string } | string)[];
  label?: string;
  sublabel?: string;
  trigger?: 'hover' | 'click';
  defaultOpen?: boolean;
  closeOnSelect?: boolean;
  physics?: boolean;
  drift?: number;
  onSelect?: (item: { label: string; value?: string }) => void;
  onOpenChange?: (open: boolean) => void;
  folderColor?: string;
  frontColor?: string;
  paperColor?: string;
  itemColor?: string;
  itemTextColor?: string;
  labelColor?: string;
  width?: number;
  height?: number;
  radius?: number;
  spread?: number;
  lift?: number;
  tilt?: number;
}

export interface AccordionGalleryItem {
  image: string;
  label?: string;
  alt?: string;
  link?: string;
}

/*
 * ПРАВКА вендорного файла: доданий `onOpen(index)`.
 *
 * Upstream по кліку лише розгортає панель, а повторний клік по вже
 * розгорнутій не робить нічого — у демо це просто вітрина. У чаті ж друге
 * натискання мусить відкривати картинку на весь екран, і робити це через
 * `link` не можна: посилання веде геть зі сторінки. Там же — Enter/Пробіл,
 * щоб перегляд відкривався і з клавіатури.
 */
export interface AccordionGalleryProps extends Common {
  items: AccordionGalleryItem[];
  defaultIndex?: number;
  accentColor?: string;
  overlayColor?: string;
  textColor?: string;
  height?: number;
  gap?: number;
  radius?: number;
  expandRatio?: number;
  orientation?: 'horizontal' | 'vertical';
  duration?: number;
  ease?: string;
  parallax?: number;
  tilt?: number;
  stagger?: number;
  trigger?: 'hover' | 'click';
  showLabels?: boolean;
  grayscale?: boolean;
  onOpen?: (index: number) => void;
}

export const AccordionGallery = AccordionGalleryRaw as unknown as ComponentType<AccordionGalleryProps>;
export const FolderFloat = FolderFloatRaw as unknown as ComponentType<FolderFloatProps>;
export const PromptBar = PromptBarRaw as unknown as ComponentType<PromptBarProps>;
export const RefineFrame = RefineFrameRaw as unknown as ComponentType<RefineFrameProps>;

export const SquishSwitch = SquishSwitchRaw as unknown as ComponentType<SquishSwitchProps>;
export const RubberSegment = RubberSegmentRaw as unknown as ComponentType<RubberSegmentProps>;
export const StatusMark = StatusMarkRaw as unknown as ComponentType<StatusMarkProps>;
export const LatticeLoader = LatticeLoaderRaw as unknown as ComponentType<LatticeLoaderProps>;
export const SwipeToast = SwipeToastRaw as unknown as ComponentType<SwipeToastProps>;
export const WarmTooltip = WarmTooltipRaw as unknown as ComponentType<WarmTooltipProps>;
export const ThoughtLine = ThoughtLineRaw as unknown as ComponentType<ThoughtLineProps>;
export const VoicePill = VoicePillRaw as unknown as ComponentType<VoicePillProps>;
export const HoldButton = HoldButtonRaw as unknown as ComponentType<HoldButtonProps>;
export const SloshGauge = SloshGaugeRaw as unknown as ComponentType<SloshGaugeProps>;
export const SlideCommit = SlideCommitRaw as unknown as ComponentType<SlideCommitProps>;
export const ScrubField = ScrubFieldRaw as unknown as ComponentType<ScrubFieldProps>;
export const SwipeRow = SwipeRowRaw as unknown as ComponentType<SwipeRowProps>;

export const Dock = DockRaw as unknown as ComponentType<DockProps>;
export const SpotlightCard = SpotlightCardRaw as unknown as ComponentType<SpotlightCardProps>;
export const PixelCard = PixelCardRaw as unknown as ComponentType<PixelCardProps>;
export const ParticleCard = ParticleCardRaw as unknown as ComponentType<ParticleCardProps>;
export const GlobalSpotlight = GlobalSpotlightRaw as unknown as ComponentType<GlobalSpotlightProps>;
export const AnimatedList = AnimatedListRaw as unknown as ComponentType<AnimatedListProps>;
export const DecryptedText = DecryptedTextRaw as unknown as ComponentType<DecryptedTextProps>;
export const TextType = TextTypeRaw as unknown as ComponentType<TextTypeProps>;
export const SplitFlapText = SplitFlapTextRaw as unknown as ComponentType<SplitFlapTextProps>;
export const ShinyText = ShinyTextRaw as unknown as ComponentType<ShinyTextProps>;
export const CountUp = CountUpRaw as unknown as ComponentType<CountUpProps>;
export const Counter = CounterRaw as unknown as ComponentType<CounterProps>;
export const ClickSpark = ClickSparkRaw as unknown as ComponentType<ClickSparkProps>;
export const Magnet = MagnetRaw as unknown as ComponentType<MagnetProps>;
export const ElectricBorder = ElectricBorderRaw as unknown as ComponentType<ElectricBorderProps>;
export const StarBorder = StarBorderRaw as unknown as ComponentType<StarBorderProps>;
export const GlareHover = GlareHoverRaw as unknown as ComponentType<GlareHoverProps>;
export const DotGrid = DotGridRaw as unknown as ComponentType<DotGridProps>;
export const Stepper = StepperRaw as unknown as ComponentType<StepperProps>;
export const Step = StepRaw as unknown as ComponentType<{ children: ReactNode }>;
export const AnimatedContent = AnimatedContentRaw as unknown as ComponentType<AnimatedContentProps>;

export const GlideSelect = GlideSelectRaw as unknown as ComponentType<GlideSelectProps>;
export const JellyRadio = JellyRadioRaw as unknown as ComponentType<JellyRadioProps>;
export const BranchedMenu = BranchedMenuRaw as unknown as ComponentType<BranchedMenuProps>;
export const CallChip = CallChipRaw as unknown as ComponentType<CallChipProps>;
export const SlingButton = SlingButtonRaw as unknown as ComponentType<SlingButtonProps>;
export const FuseButton = FuseButtonRaw as unknown as ComponentType<FuseButtonProps>;
export const PulseHeart = PulseHeartRaw as unknown as ComponentType<PulseHeartProps>;
export const BellToggle = BellToggleRaw as unknown as ComponentType<BellToggleProps>;
export const SpringCheck = SpringCheckRaw as unknown as ComponentType<SpringCheckProps>;
export const WakeSlider = WakeSliderRaw as unknown as ComponentType<WakeSliderProps>;
export const CometDial = CometDialRaw as unknown as ComponentType<CometDialProps>;
export const PeekRating = PeekRatingRaw as unknown as ComponentType<PeekRatingProps>;
