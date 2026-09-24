import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSources } from '../src/panels/chat/sources.ts';

const done = (label, result) => ({ id: label, label, detail: '', status: 'done', result });

test('web_search results become sources with titles and bare hostnames', () => {
  const sources = collectSources([done('web_search', {
    query: 'python',
    results: [
      { title: 'Python', url: 'https://www.python.org/', snippet: 'official' },
      { title: 'Вікіпедія', url: 'https://uk.wikipedia.org/wiki/Python' },
    ],
  })]);
  assert.deepEqual(sources.map((s) => s.host), ['python.org', 'uk.wikipedia.org']);
  assert.equal(sources[0].title, 'Python');
  assert.equal(sources[0].tool, 'web_search');
});

test('a bare {title, url} answer is a source too', () => {
  const sources = collectSources([done('facts', {
    title: 'Ada Lovelace', extract: '…', url: 'https://uk.wikipedia.org/wiki/Ада_Лавлейс',
  })]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'Ada Lovelace');
});

test('only completed calls count — a failed search is not evidence', () => {
  const steps = [
    { id: '1', label: 'web_search', detail: '', status: 'failed', result: { url: 'https://a.com' } },
    { id: '2', label: 'web_search', detail: '', status: 'interrupted', result: { url: 'https://b.com' } },
    { id: '3', label: 'web_search', detail: '', status: 'active', result: { url: 'https://c.com' } },
  ];
  assert.deepEqual(collectSources(steps), []);
});

test('the same page found twice is one source, and keeps the better label', () => {
  const sources = collectSources([
    done('web_search', { results: [{ url: 'https://example.com/page#top' }] }),
    done('read_page', { url: 'https://example.com/page/', title: 'The page' }),
  ]);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].title, 'The page');
});

test('pictures are not sources: the reply already shows them', () => {
  const sources = collectSources([
    done('image_search', { images: [{ url: 'https://cdn.example.com/cat.jpg' }] }),
    done('web_search', { results: [
      { url: 'https://example.com/logo.png' },
      { url: 'https://example.com/article' },
    ] }),
  ]);
  assert.deepEqual(sources.map((s) => s.url), ['https://example.com/article']);
});

test('links written inside a snippet are found as well', () => {
  const sources = collectSources([done('workspace_read',
    'Details are at https://docs.example.com/guide, see also (https://example.org/x).')]);
  assert.deepEqual(sources.map((s) => s.url),
    ['https://docs.example.com/guide', 'https://example.org/x']);
});

test('nothing usable in the result means no strip at all', () => {
  assert.deepEqual(collectSources([done('workspace_write', { ok: true })]), []);
  assert.deepEqual(collectSources([done('weather', 'ftp://files.example.com/x')]), []);
  assert.deepEqual(collectSources([]), []);
});

test('MCP wrapping is unpacked, so titles survive the round trip through text', () => {
  // This is the real shape OpenClaw returns: the tool's JSON, stringified,
  // inside a content list. Without unpacking, only bare URLs are scraped and
  // every source shows up untitled.
  const payload = JSON.stringify({
    query: 'mini pc',
    results: [{ title: 'ESM Computer', url: 'https://www.esm-computer.de/gebrauchte-mini-pcs/' }],
  });
  const sources = collectSources([done('tools__web_search',
    { content: [{ type: 'text', text: payload }] })]);
  assert.deepEqual(sources.map((s) => [s.host, s.title, s.tool]),
    [['esm-computer.de', 'ESM Computer', 'web_search']]);
});

test('advertising redirects are not sources', () => {
  const sources = collectSources([done('tools__web_search', { results: [
    { title: 'HP PCs Online Shop - Bis -60%', url: 'https://duckduckgo.com/y.js?ad_domain=x&ad_provider=bingv7aa' },
    { title: 'Sponsored', url: 'https://www.bing.com/aclick?ld=abc' },
    { title: 'Real page', url: 'https://www.lenovo.com/m720-tiny' },
  ] })]);
  assert.deepEqual(sources.map((s) => s.host), ['lenovo.com']);
});

test('HTML-escaped query strings are unescaped before the link is used', () => {
  const [source] = collectSources([done('web_search',
    { results: [{ url: 'https://example.com/s?a=1&amp;b=2' }] })]);
  assert.equal(source.url, 'https://example.com/s?a=1&b=2');
});

test('the qualified tool name is shown the way a person names the tool', () => {
  const [source] = collectSources([done('tools__facts',
    { title: 'Ada', url: 'https://uk.wikipedia.org/wiki/Ada' })]);
  assert.equal(source.tool, 'facts');
});

test('pictures stay out even when the image tool is namespaced', () => {
  assert.deepEqual(collectSources([done('tools__image_search',
    { images: [{ url: 'https://cdn.example.com/cat' }] })]), []);
});
