import { useCallback, useEffect, useRef } from 'react';
import type { PointerEventHandler } from 'react';

/** Minimum horizontal travel required to change a section. */
export const DEFAULT_SWIPE_THRESHOLD = 48;

/** Horizontal travel must beat vertical travel by this factor. */
export const DEFAULT_HORIZONTAL_AXIS_RATIO = 1.2;

/** Keep clear of the browser's edge back/forward gesture on touch devices. */
export const DEFAULT_EDGE_GUARD = 24;

const AXIS_LOCK_DISTANCE = 8;
const HORIZONTAL_OVERFLOW_VALUES = new Set(['auto', 'scroll', 'overlay']);

const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="searchbox"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(',');

const SWIPE_EXCLUSION_SELECTOR = [
  INTERACTIVE_SELECTOR,
  '[data-swipe-ignore]',
  '[data-swipe-scroll]',
  '[data-horizontal-scroll]',
  '[data-scroll-axis="x"]',
].join(',');

type ElementLike = {
  closest?: (selector: string) => ElementLike | null;
  parentElement?: ElementLike | null;
  hasAttribute?: (name: string) => boolean;
  getAttribute?: (name: string) => string | null;
  style?: { overflowX?: string } | null;
  scrollWidth?: number;
  clientWidth?: number;
  nodeType?: number;
};

function asElement(target: EventTarget | null): ElementLike | null {
  if (!target) return null;

  const candidate = target as ElementLike;
  if (candidate.nodeType === 1 || typeof candidate.closest === 'function') return candidate;
  return candidate.parentElement ?? null;
}

function hasAttribute(element: ElementLike, name: string): boolean {
  if (typeof element.hasAttribute === 'function') return element.hasAttribute(name);
  const value = element.getAttribute?.(name);
  return value !== undefined && value !== null;
}

function readOverflowX(element: ElementLike): string {
  const inlineValue = element.style?.overflowX?.trim();
  if (inlineValue) return inlineValue.toLowerCase();

  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    try {
      return window.getComputedStyle(element as Element).overflowX;
    } catch {
      // Detached or test-only nodes may not be accepted by getComputedStyle.
    }
  }
  return '';
}

/** Return true when an element can consume a horizontal drag as scrolling. */
export function isHorizontallyScrollable(element: Element): boolean {
  const node = element as ElementLike;
  if (
    hasAttribute(node, 'data-swipe-scroll') ||
    hasAttribute(node, 'data-horizontal-scroll') ||
    node.getAttribute?.('data-scroll-axis') === 'x'
  ) {
    return true;
  }

  if (!HORIZONTAL_OVERFLOW_VALUES.has(readOverflowX(node))) return false;
  const scrollWidth = Number(node.scrollWidth);
  const clientWidth = Number(node.clientWidth);
  return Number.isFinite(scrollWidth) && Number.isFinite(clientWidth) && scrollWidth > clientWidth;
}

/** Return true when a gesture should belong to a control or a scroll surface. */
export function shouldIgnoreSwipeTarget(target: EventTarget | null): boolean {
  const element = asElement(target);
  if (!element) return false;

  if (typeof element.closest === 'function') {
    try {
      if (element.closest(SWIPE_EXCLUSION_SELECTOR)) return true;
    } catch {
      // Fall through to the attribute and ancestor checks for test doubles.
    }
  }

  let current: ElementLike | null = element;
  while (current) {
    if (
      hasAttribute(current, 'data-swipe-ignore') ||
      hasAttribute(current, 'data-swipe-scroll') ||
      hasAttribute(current, 'data-horizontal-scroll') ||
      current.getAttribute?.('data-scroll-axis') === 'x' ||
      isHorizontallyScrollable(current as Element)
    ) {
      return true;
    }
    current = current.parentElement ?? null;
  }

  return false;
}

/** Resolve whether a pointer event is suitable for coarse/touch navigation. */
export function isCoarsePointer(event: { pointerType?: string }): boolean {
  if (event.pointerType === 'mouse') return false;
  if (event.pointerType === 'touch') return true;

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(pointer: coarse)').matches;
    } catch {
      // Older embedded webviews can expose matchMedia but reject this query.
    }
  }
  return false;
}

/** Return true when a drag begins in the browser-reserved edge gesture zone. */
export function isInEdgeGuard(clientX: number, viewportWidth: number, edge = DEFAULT_EDGE_GUARD): boolean {
  if (!Number.isFinite(clientX) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) return false;
  const safeEdge = Number.isFinite(edge) ? edge : DEFAULT_EDGE_GUARD;
  const inset = Math.max(0, Math.min(safeEdge, viewportWidth / 2));
  return clientX <= inset || clientX >= viewportWidth - inset;
}

export type SwipeDirection = 'next' | 'previous';

function normalizeThreshold(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0
    ? (value as number)
    : DEFAULT_SWIPE_THRESHOLD;
}

function normalizeAxisRatio(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) >= 1
    ? (value as number)
    : DEFAULT_HORIZONTAL_AXIS_RATIO;
}

/** Classify a completed drag while enforcing its threshold and axis bias. */
export function getSwipeDirection(
  deltaX: number,
  deltaY: number,
  threshold = DEFAULT_SWIPE_THRESHOLD,
  axisRatio = DEFAULT_HORIZONTAL_AXIS_RATIO,
): SwipeDirection | null {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return null;
  const horizontalDistance = Math.abs(deltaX);
  const verticalDistance = Math.abs(deltaY);
  if (horizontalDistance < normalizeThreshold(threshold)) return null;
  if (horizontalDistance <= verticalDistance * normalizeAxisRatio(axisRatio)) return null;
  return deltaX < 0 ? 'next' : 'previous';
}

/** Resolve a completed drag to a neighbouring section, or null at a boundary. */
export function getSwipeDestination(
  current: string,
  deltaX: number,
  deltaY: number,
  sectionIds: readonly string[],
  threshold = DEFAULT_SWIPE_THRESHOLD,
  axisRatio = DEFAULT_HORIZONTAL_AXIS_RATIO,
): string | null {
  const direction = getSwipeDirection(deltaX, deltaY, threshold, axisRatio);
  if (!direction) return null;

  const index = sectionIds.indexOf(current);
  if (index < 0) return null;

  const offset = direction === 'next' ? 1 : -1;
  return sectionIds[index + offset] ?? null;
}

export interface SwipeNavigationOptions {
  current: string;
  onNavigate: (id: string) => void;
  sectionIds: readonly string[];
  threshold?: number;
  axisRatio?: number;
  edgeGuard?: number;
}

export interface SwipeNavigationHandlers {
  onPointerDown: PointerEventHandler<HTMLElement>;
}

interface ActiveGesture {
  pointerId: number;
  startX: number;
  startY: number;
  current: string;
  sectionIds: readonly string[];
  threshold: number;
  axisRatio: number;
  axis: 'horizontal' | 'vertical' | null;
  move: (event: PointerEvent) => void;
  end: (event: PointerEvent) => void;
}

/**
 * Add section navigation to a surface that already owns the page layout.
 * Spread the returned handlers onto that surface, for example:
 * `<main {...swipeHandlers}>...</main>`.
 */
export function useSwipeNavigation({
  current,
  onNavigate,
  sectionIds,
  threshold,
  axisRatio,
  edgeGuard,
}: SwipeNavigationOptions): SwipeNavigationHandlers {
  const optionsRef = useRef({
    current,
    onNavigate,
    sectionIds,
    threshold,
    axisRatio,
    edgeGuard,
  });
  optionsRef.current = {
    current,
    onNavigate,
    sectionIds,
    threshold,
    axisRatio,
    edgeGuard,
  };

  const activeRef = useRef<ActiveGesture | null>(null);

  const cleanup = useCallback(() => {
    const active = activeRef.current;
    if (!active) return;

    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', active.move);
      window.removeEventListener('pointerup', active.end);
      window.removeEventListener('pointercancel', active.end);
      window.removeEventListener('lostpointercapture', active.end);
    }
    activeRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (typeof window === 'undefined') return;
    if (event.button !== 0 || !event.isPrimary || event.defaultPrevented) return;
    if (!isCoarsePointer(event.nativeEvent)) return;
    if (shouldIgnoreSwipeTarget(event.target)) return;

    const config = optionsRef.current;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const guard = Number.isFinite(config.edgeGuard)
      ? (config.edgeGuard as number)
      : DEFAULT_EDGE_GUARD;
    if (isInEdgeGuard(event.clientX, viewportWidth, guard)) return;
    if (activeRef.current) return;

    const gesture: ActiveGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      current: config.current,
      sectionIds: config.sectionIds,
      threshold: normalizeThreshold(config.threshold),
      axisRatio: normalizeAxisRatio(config.axisRatio),
      axis: null,
      move: () => undefined,
      end: () => undefined,
    };

    const end = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId !== gesture.pointerId) return;
      const shouldNavigate = nativeEvent.type === 'pointerup' && gesture.axis === 'horizontal';
      cleanup();
      if (!shouldNavigate) return;

      const destination = getSwipeDestination(
        gesture.current,
        nativeEvent.clientX - gesture.startX,
        nativeEvent.clientY - gesture.startY,
        gesture.sectionIds,
        gesture.threshold,
        gesture.axisRatio,
      );
      if (destination) optionsRef.current.onNavigate(destination);
    };

    const move = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId !== gesture.pointerId) return;
      const deltaX = nativeEvent.clientX - gesture.startX;
      const deltaY = nativeEvent.clientY - gesture.startY;
      if (!gesture.axis && Math.hypot(deltaX, deltaY) >= AXIS_LOCK_DISTANCE) {
        const horizontal = Math.abs(deltaX) > Math.abs(deltaY) * gesture.axisRatio;
        const vertical = Math.abs(deltaY) > Math.abs(deltaX) * gesture.axisRatio;
        if (horizontal) gesture.axis = 'horizontal';
        else if (vertical) {
          gesture.axis = 'vertical';
          cleanup();
          return;
        }
      }

      if (gesture.axis === 'horizontal' && nativeEvent.cancelable) nativeEvent.preventDefault();
    };

    gesture.move = move;
    gesture.end = end;
    activeRef.current = gesture;
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('lostpointercapture', end);
  }, [cleanup]);

  return { onPointerDown };
}
