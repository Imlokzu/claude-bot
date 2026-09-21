import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_EDGE_GUARD,
  DEFAULT_SWIPE_THRESHOLD,
  getSwipeDestination,
  getSwipeDirection,
  isCoarsePointer,
  isHorizontallyScrollable,
  isInEdgeGuard,
  shouldIgnoreSwipeTarget,
} from '../src/hooks/useSwipeNavigation.ts';

const sections = ['overview', 'chat', 'memory'];

test('classifies only decisive horizontal travel as a swipe', () => {
  assert.equal(getSwipeDirection(-DEFAULT_SWIPE_THRESHOLD, 0), 'next');
  assert.equal(getSwipeDirection(DEFAULT_SWIPE_THRESHOLD, 0), 'previous');
  assert.equal(getSwipeDirection(-DEFAULT_SWIPE_THRESHOLD + 1, 0), null);
  assert.equal(getSwipeDirection(-100, 90), null, 'vertical travel must retain the axis');
  assert.equal(getSwipeDirection(-100, 80), 'next');
  assert.equal(getSwipeDirection(Number.NaN, 0), null);
});

test('resolves neighbouring sections and stops at either boundary', () => {
  assert.equal(getSwipeDestination('overview', -80, 0, sections), 'chat');
  assert.equal(getSwipeDestination('chat', 80, 0, sections), 'overview');
  assert.equal(getSwipeDestination('overview', 80, 0, sections), null);
  assert.equal(getSwipeDestination('memory', -80, 0, sections), null);
  assert.equal(getSwipeDestination('missing', -80, 0, sections), null);
});

test('reserves both viewport edges for browser back and forward gestures', () => {
  assert.equal(isInEdgeGuard(DEFAULT_EDGE_GUARD, 390), true);
  assert.equal(isInEdgeGuard(390 - DEFAULT_EDGE_GUARD, 390), true);
  assert.equal(isInEdgeGuard(200, 390), false);
  assert.equal(isInEdgeGuard(24, 390, 0), false);
});

test('accepts touch and coarse non-mouse pointers but rejects mouse input', () => {
  assert.equal(isCoarsePointer({ pointerType: 'touch' }), true);
  assert.equal(isCoarsePointer({ pointerType: 'pen' }), false);
  assert.equal(isCoarsePointer({ pointerType: 'mouse' }), false);
});

test('ignores interactive targets and marked horizontal scroll zones', () => {
  const interactive = {
    closest: (selector) => selector.includes('button') ? interactive : null,
    hasAttribute: () => false,
    getAttribute: () => null,
    parentElement: null,
  };
  const scrollZone = {
    closest: () => null,
    hasAttribute: (name) => name === 'data-swipe-scroll',
    getAttribute: () => null,
    parentElement: null,
  };
  const page = {
    closest: () => null,
    hasAttribute: () => false,
    getAttribute: () => null,
    parentElement: null,
  };

  assert.equal(shouldIgnoreSwipeTarget(interactive), true);
  assert.equal(shouldIgnoreSwipeTarget(scrollZone), true);
  assert.equal(shouldIgnoreSwipeTarget(page), false);
});

test('detects an actual horizontal overflow surface without DOM globals', () => {
  const scrollZone = {
    style: { overflowX: 'auto' },
    scrollWidth: 720,
    clientWidth: 320,
    hasAttribute: () => false,
    getAttribute: () => null,
    parentElement: null,
  };
  const fittedZone = { ...scrollZone, scrollWidth: 320 };

  assert.equal(isHorizontallyScrollable(scrollZone), true);
  assert.equal(isHorizontallyScrollable(fittedZone), false);
});
