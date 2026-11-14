import test from 'node:test';
import assert from 'node:assert/strict';
import { StageLayoutRefresh } from '../src/app/stage-resize-monitor.ts';

for (const mode of ['invalid-handle', 'throws-after-reentry']) {
  test('new nested request survives stale registration failure: ' + mode, () => {
    const callbacks = new Map();
    let nextId = 0;
    let attempts = 0;
    let refreshed = 0;
    let layout;
    const driver = {
      request(callback) {
        if (++attempts === 1) {
          layout.request(); // reentrant request becomes the newest operation
          if (mode === 'invalid-handle') return NaN;
          throw Error('WebView transient driver failure');
        }
        const handle = ++nextId;
        callbacks.set(handle, callback);
        return handle;
      },
      cancel(id) { callbacks.delete(id); },
    };
    layout = new StageLayoutRefresh(() => refreshed++, driver);
    layout.request();
    assert.equal(callbacks.size, 1, 'newest pending frame must be preserved');
    for (let frame = 0; frame < 2; frame++) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    }
    assert.equal(refreshed, 1, 'latest request must complete both frames');
    layout.dispose();
  });
}
