import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { remarkImageGroups } from '../src/panels/chat/remarkImageGroups.ts';
import { parsePins } from '../src/panels/chat/pins.ts';
import { splitAccounts } from '../src/panels/chat/accounts.ts';

const parse = (markdown) => {
  const processor = unified().use(remarkParse).use(remarkImageGroups);
  return processor.runSync(processor.parse(markdown));
};
const imageParagraphs = (tree) => tree.children.filter((node) =>
  node.type === 'paragraph' && node.children.some((child) => child.type.startsWith('image')));

test('legacy caption-separated photos use one gallery without losing prose or captions', () => {
  const tree = parse('**Coral crab** — reef\n\n![Coral crab](coral.jpg)\n\n**Red crab** — island\n\n![Red crab](red.jpg)\n\nLast paragraph.');
  const photos = imageParagraphs(tree);
  assert.equal(photos.length, 1);
  assert.deepEqual(photos[0].children.map(({ url, alt }) => ({ url, alt })), [
    { url: 'coral.jpg', alt: 'Coral crab' }, { url: 'red.jpg', alt: 'Red crab' },
  ]);
  assert.equal(tree.children.length, 4);
  assert.equal(tree.children[2].children[0].children[0].value, 'Red crab');
  assert.equal(tree.children[3].children[0].value, 'Last paragraph.');
});

test('adjacent images, blank lines and references retain order', () => {
  const tree = parse('![A](a.jpg)\n![B](b.jpg)\n\n![C][ref]\n\n[ref]: c.jpg');
  assert.equal(imageParagraphs(tree).length, 1);
  assert.deepEqual(imageParagraphs(tree)[0].children.map((node) => node.alt), ['A', 'B', 'C']);
  assert.equal(tree.children.at(-1).type, 'definition');
});

test('single images, inline images, links and fenced examples are not rewritten', () => {
  const markdown = '![A](a.jpg)\n\nInline ![B](b.jpg) text.\n\n[![C](c.jpg)](page)\n\n```md\n![D](d.jpg)\n```';
  const before = unified().use(remarkParse).parse(markdown);
  assert.deepEqual(parse(markdown), before);
});

test('grouping is idempotent during streaming rerenders', () => {
  const tree = parse('![A](a.jpg)\n\nCaption\n\n![B](b.jpg)');
  const snapshot = structuredClone(tree);
  remarkImageGroups()(tree);
  assert.deepEqual(tree, snapshot);
});

test('pin preferences allow only known panels, once each', () => {
  assert.deepEqual(parsePins('["screen", "screen", "unknown", "vision"]'), ['screen', 'vision']);
  assert.deepEqual(parsePins('["projects"]'), ['projects']);
  for (const saved of [null, '', '{', '{}', 'null', '7', '"screen"']) assert.deepEqual(parsePins(saved), []);
});

test('the picked account leads; a missing pick falls back to the server order', () => {
  const list = [{ provider: 'openai' }, { provider: 'nvidia' }, { provider: 'regolo' }];
  const picked = splitAccounts(list, 'nvidia');
  assert.equal(picked.main.provider, 'nvidia');
  assert.deepEqual(picked.others.map((account) => account.provider), ['openai', 'regolo']);
  for (const preferred of [null, '', 'anthropic']) {
    const fallback = splitAccounts(list, preferred);
    assert.equal(fallback.main.provider, 'openai');
    assert.equal(fallback.others.length, 2);
  }
  assert.deepEqual(splitAccounts([], 'openai'), { main: null, others: [] });
});
