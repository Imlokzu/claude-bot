import assert from 'node:assert/strict';
import test from 'node:test';

test('simultaneous subscribers share one event stream and close it when idle', async () => {
  const previousEventSource = globalThis.EventSource;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const streams = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      streams.push(this);
    }

    close() {
      this.closed = true;
    }
  }

  globalThis.EventSource = FakeEventSource;
  globalThis.document = new EventTarget();
  Object.defineProperty(globalThis.document, 'hidden', { value: false, writable: true });
  globalThis.window = { location: { origin: 'http://127.0.0.1:8100' } };

  try {
    const { subscribe } = await import(`../src/lib/events.ts?test=${Date.now()}`);
    const stops = [subscribe(() => {}), subscribe(() => {}), subscribe(() => {})];

    await Promise.resolve();
    await Promise.resolve();

    assert.equal(streams.length, 1);
    assert.equal(streams[0].closed, false);

    stops.forEach((stop) => stop());
    assert.equal(streams[0].closed, true);
  } finally {
    globalThis.EventSource = previousEventSource;
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('hidden tabs release their stream and reconnect only when visible', async () => {
  const previousEventSource = globalThis.EventSource;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const streams = [];

  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.closed = false;
      streams.push(this);
    }

    close() {
      this.closed = true;
    }
  }

  globalThis.EventSource = FakeEventSource;
  globalThis.document = new EventTarget();
  Object.defineProperty(globalThis.document, 'hidden', { value: true, writable: true });
  globalThis.window = { location: { origin: 'http://127.0.0.1:8100' } };

  try {
    const { subscribe } = await import(`../src/lib/events.ts?visibility=${Date.now()}`);
    const stop = subscribe(() => {});
    await Promise.resolve();
    assert.equal(streams.length, 0);

    globalThis.document.hidden = false;
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(streams.length, 1);
    assert.equal(streams[0].closed, false);

    globalThis.document.hidden = true;
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    assert.equal(streams[0].closed, true);

    stop();
  } finally {
    globalThis.EventSource = previousEventSource;
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
