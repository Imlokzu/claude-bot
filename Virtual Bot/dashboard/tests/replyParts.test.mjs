import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyBreak, applyDelta, applyNote, applyStep, answerText, restoreParts, stepsFor, toParts,
} from '../src/panels/chat/replyParts.ts';

test('narration, tools and answer keep the order they happened in', () => {
  let timeline = applyNote([], 'n1', ['One sec, looking']);
  timeline = applyNote(timeline, 'n1', ['One sec, looking it up.']);
  timeline = applyStep(timeline, 'c1');
  timeline = applyStep(timeline, 'c2');
  timeline = applyDelta(timeline, 'Found three.');
  timeline = applyBreak(timeline);
  timeline = applyDelta(timeline, ' The 9:10 is cheapest.');
  assert.deepEqual(toParts(timeline), [
    { type: 'text', text: 'One sec, looking it up.', note: true },
    { type: 'steps', ids: ['c1', 'c2'] },
    { type: 'text', text: 'Found three.' },
    { type: 'text', text: 'The 9:10 is cheapest.' },
  ]);
  assert.equal(answerText(timeline), 'Found three.\n\nThe 9:10 is cheapest.');
});

test('a repeated tool event does not open a second activity row', () => {
  let timeline = applyStep([], 'c1');
  timeline = applyNote(timeline, 'n1', ['still on it']);
  timeline = applyStep(timeline, 'c1');
  assert.deepEqual(toParts(timeline).map((p) => p.type), ['steps', 'text']);
});

test('a break never leaves an empty bubble', () => {
  let timeline = applyBreak([]);
  assert.deepEqual(timeline, []);
  timeline = applyDelta(timeline, 'Hi');
  timeline = applyBreak(applyBreak(timeline));
  assert.deepEqual(toParts(timeline), [{ type: 'text', text: 'Hi' }]);
});

test('replies saved before bubbles look exactly as they did', () => {
  const steps = [{ id: 's1', label: 'read', detail: '', status: 'done' }];
  assert.deepEqual(restoreParts(undefined, 'old answer', steps), [
    { type: 'steps', ids: ['s1'] },
    { type: 'text', text: 'old answer' },
  ]);
  assert.deepEqual(restoreParts([], '', []), []);
  assert.deepEqual(restoreParts([{ type: 'text', text: 'x', note: 1 }, { type: 'bogus' }], 'x', []), [
    { type: 'text', text: 'x', note: true },
  ]);
});

test('steps are looked up by id and unknown ids are skipped', () => {
  const steps = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(stepsFor(['b', 'zzz', 'a'], steps).map((s) => s.id), ['b', 'a']);
});
