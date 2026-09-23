import assert from 'node:assert/strict';
import test from 'node:test';
import { speakableText } from '../src/panels/chat/speech.ts';

test('code blocks are dropped, not pronounced', () => {
  const spoken = speakableText('Ось як це робиться:\n\n```bash\nrm -rf /tmp/x\n```\n\nОсь і все.');
  assert.equal(spoken, 'Ось як це робиться: Ось і все.');
});

test('emphasis, headings, quotes and bullets lose their marks but keep the words', () => {
  const spoken = speakableText('## Підсумок\n\n- **перше** слово\n- _друге_ слово\n\n> цитата');
  assert.equal(spoken, 'Підсумок перше слово друге слово цитата');
});

test('links are read as their text and images are not read at all', () => {
  assert.equal(speakableText('Дивись [документацію](https://example.com/docs).'),
    'Дивись документацію.');
  assert.equal(speakableText('![кіт](https://example.com/cat.png) Ось кіт.'), 'Ось кіт.');
});

test('inline code keeps its content — a file name is worth hearing', () => {
  assert.equal(speakableText('Відкрий `config.yaml` і зміни порт.'),
    'Відкрий config.yaml і зміни порт.');
});

test('a reply that is only code has nothing to say', () => {
  assert.equal(speakableText('```python\nprint(1)\n```'), '');
});
