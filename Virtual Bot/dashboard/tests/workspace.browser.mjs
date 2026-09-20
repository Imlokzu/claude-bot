/** Opt-in UI regression using agent-browser and an already-running server. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const session = `workspace-test-${process.pid}`;
const origin = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:8100';
const browser = (...args) => execFileSync('agent-browser', ['--session', session, ...args], { encoding: 'utf8' });
const evaluate = (code) => JSON.parse(browser('--json', 'eval', code)).data.result;
const route = (url, body) => browser('network', 'route', url, '--body', JSON.stringify(body));

try {
  browser('open', `${origin}/dash/#/chat`);
  browser('set', 'viewport', '1280', '850');
  // Fixtures affect this isolated browser only; server auth and user data stay untouched.
  route('**/api/auth/config', { disabled: true });
  route('**/api/sessions', { sessions: [{ id: 'ui-fixture', title: 'Gallery check', count: 1 }] });
  route('**/api/sessions/ui-fixture', { id: 'ui-fixture', messages: [{ role: 'assistant', content:
    '**First caption**\n\n![First](/static/dash/icon.svg)\n\n**Second caption**\n\n![Second](/static/dash/icon.svg)',
  }] });
  route('**/api/projects', { projects: [{ id: 'sample', name: 'Sample project' }] });
  route('**/api/brain/models', { models: [{ id: 'test', label: 'Test', context: 200000 }],
    selected: 'test', default: 'test', thinking: 'high', thinking_levels: ['high'], available: true });
  browser('reload');
  browser('wait', '.chat-gallery');
  assert.equal(evaluate('document.querySelectorAll(".chat-gallery").length'), 1);
  assert.equal(evaluate('document.querySelectorAll(".ag-panel").length'), 2);
  assert.equal(evaluate('document.querySelectorAll(".chat-shot").length'), 0);
  assert.equal(evaluate('document.querySelector(".chat-pins").getBoundingClientRect().bottom'), 850);

  browser('wait', '.fan-core');
  for (let index = 0; index < 2; index++) {
    browser('click', '.fan-core');
    assert.equal(evaluate('document.querySelector(".fan-core").ariaExpanded'), index ? 'false' : 'true');
  }
  browser('focus', '.fan-core');
  for (let index = 0; index < 2; index++) {
    browser('press', 'Space');
    assert.equal(evaluate('document.querySelector(".fan-core").ariaExpanded'), index ? 'false' : 'true');
    assert.equal(evaluate('document.activeElement.matches(".fan-core")'), true);
  }
  browser('find', 'role', 'button', 'click', '--name', 'Додати панель', '--exact');
  for (const label of ['Мініекран', 'Проєкти', 'Зір бота']) {
    browser('find', 'role', 'button', 'click', '--name', label, '--exact');
  }
  browser('press', 'Escape');
  browser('wait', '.pin-screen-frame');
  assert.deepEqual(evaluate('[...document.querySelectorAll("[data-pin]")].map(e=>e.dataset.pin)'), ['screen', 'projects', 'vision']);
  browser('reload');
  browser('wait', '.pin-screen-frame');
  assert.deepEqual(evaluate('[...document.querySelectorAll("[data-pin]")].map(e=>e.dataset.pin)'), ['screen', 'projects', 'vision']);
  browser('find', 'role', 'button', 'click', '--name', 'Відкріпити: Мініекран', '--exact');
  assert.equal(evaluate('document.querySelectorAll(".pin-screen-frame").length'), 0);

  for (const side of ['left', 'right', 'top', 'bottom']) {
    evaluate(`localStorage.setItem('claudeBotDockSide', '${side}')`);
    browser('reload');
    browser('wait', '.fan-core');
    assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(evaluate('document.querySelector(".chat-sessions").getBoundingClientRect().bottom'), 850);
    assert.equal(evaluate(`(() => { const r = document.querySelector('.dock-panel').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })()`), true);
  }
  browser('set', 'viewport', '390', '844');
  browser('wait', '--fn', 'document.querySelector(".chat-pins") === null');
  assert.equal(evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(evaluate('document.querySelector(".prompt-bar").getBoundingClientRect().bottom <= document.querySelector(".dock-panel").getBoundingClientRect().top'), true);
  console.log('PASS: gallery, radial mouse/keyboard toggle, persistent pins, all dock edges, mobile layout');
} finally {
  browser('close');
}
