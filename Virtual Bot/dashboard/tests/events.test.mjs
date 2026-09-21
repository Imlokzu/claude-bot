import assert from 'node:assert/strict';
import test from 'node:test';

test('simultaneous subscribers share one event stream and close it when idle', async () => {
  const previousEventSource = globalThis.EventSource;
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
    globalThis.window = previousWindow;
  }
});
