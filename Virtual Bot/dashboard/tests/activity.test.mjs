import assert from 'node:assert/strict';
import test from 'node:test';
import { updateActivity, finishActivity, restoreActivity } from '../src/panels/chat/activity.ts';

test('parallel calls with the same name finish independently', () => {
  let steps = updateActivity([], { type: 'tool_start', tool: 'read', call_id: 'one' });
  steps = updateActivity(steps, { type: 'tool_start', tool: 'read', call_id: 'two' });
  steps = updateActivity(steps, { type: 'tool_done', tool: 'read', call_id: 'one', result: 'first' });
  assert.deepEqual(steps.map(s => s.status), ['done', 'active']);
  assert.equal(steps[0].result, 'first');
});

test('native snapshots replace rows and preserve structured details', () => {
  const step = { id: 'one', label: 'web_search', status: 'active', detail: 'query', input: { query: 'Python' } };
  let steps = updateActivity([], { type: 'tool_start', step });
  steps = updateActivity(steps, { type: 'tool_start', step });
  steps = updateActivity(steps, { type: 'tool_done', step: { ...step, status: 'done', result: 'found' } });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].result, 'found');
  assert.deepEqual(steps[0].input, { query: 'Python' });
});

test('failed calls never turn green and cancel keeps unknown outcomes', () => {
  let steps = updateActivity([], { type: 'tool_start', tool: 'read' });
  steps = updateActivity(steps, { type: 'tool_done', tool: 'read', result: { error: 'missing' } });
  steps = updateActivity(steps, { type: 'tool_start', tool: 'write' });
  const finished = finishActivity(steps);
  assert.deepEqual(finished.map(s => s.status), ['failed', 'interrupted']);
  assert.equal(steps[1].status, 'active', 'the reducer must not mutate previous renders');
});

test('progress retains the tool identity, input and partial result', () => {
  let steps = updateActivity([], { type: 'tool_start', tool: 'read', input: { path: 'notes.md' } });
  steps = updateActivity(steps, { type: 'tool_progress', tool: 'read', detail: 'reading', result: 'partial' });
  assert.equal(steps.length, 1);
  assert.equal(steps[0].status, 'active');
  assert.equal(steps[0].detail, 'reading');
  assert.equal(steps[0].result, 'partial');
  assert.deepEqual(steps[0].input, { path: 'notes.md' });
});

test('legacy history never crashes the activity panel or claims unknown success', () => {
  assert.deepEqual(restoreActivity(null), []);
  const steps = restoreActivity([null, { tool: 'read', args: { path: 'old.md' } },
    { id: 'new', label: 'search', status: 'done', detail: 'Python' }]);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].status, 'interrupted');
  assert.equal(steps[0].label, 'read');
  assert.deepEqual(steps[0].input, { path: 'old.md' });
  assert.equal(steps[1].status, 'done');
});
