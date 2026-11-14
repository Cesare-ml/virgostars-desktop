import test from 'node:test';
import assert from 'node:assert/strict';
import { StageLayoutRefresh } from '../src/app/stage-resize-monitor.ts';

// Deterministic model testing of the real scheduler. No browser, DOM, network,
// personal data, or nondeterministic timers are needed.
function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value;
  };
}

function driver() {
  let nextHandle = 0;
  const pending = new Map();
  const historical = new Map();
  const canceled = [];
  return {
    port: {
      request(callback) {
        const id = ++nextHandle;
        pending.set(id, callback);
        historical.set(id, callback);
        return id;
      },
      cancel(id) {
        canceled.push(id);
        pending.delete(id);
      },
    },
    get pendingCount() { return pending.size; },
    get canceled() { return canceled; },
    flush() {
      // A newly scheduled second frame is not eligible until the next tick.
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    replayCanceled(id) { historical.get(id)?.(); },
  };
}

test('seeded panel-toggle model never publishes stale frames across 64 event traces', () => {
  for (let seed = 1; seed <= 64; seed++) {
    const random = rng(seed);
    const animation = driver();
    let publishes = 0;
    let expectedPublishes = 0;
    // Model: each panel request replaces the pending two-frame wait.
    let remainingFrames = null;
    const layout = new StageLayoutRefresh(() => publishes++, animation.port);
    for (let step = 0; step < 96; step++) {
      const action = random() % 5;
      if (action < 3) {
        layout.request();
        remainingFrames = 2;
      } else if (action === 3) {
        animation.flush();
        if (remainingFrames !== null) {
          remainingFrames--;
          if (remainingFrames === 0) {
            expectedPublishes++;
            remainingFrames = null;
          }
        }
      } else if (animation.canceled.length) {
        // A canceled WebView callback can still be delivered late.
        const oldId = animation.canceled[random() % animation.canceled.length];
        animation.replayCanceled(oldId);
      }
      assert.equal(publishes, expectedPublishes, `seed=${seed} step=${step}`);
      assert.ok(animation.pendingCount <= 1, `seed=${seed}: at most one live frame`);
    }
    // When the final click is pending, exactly two more frames complete it.
    if (remainingFrames !== null) {
      for (let frame = 0; frame < remainingFrames; frame++) animation.flush();
      expectedPublishes++;
    }
    assert.equal(publishes, expectedPublishes, `seed=${seed} final`);
    assert.equal(animation.pendingCount, 0, `seed=${seed}: no orphaned frames`);
    layout.dispose();
    for (const oldId of animation.canceled) animation.replayCanceled(oldId);
    assert.equal(publishes, expectedPublishes, `seed=${seed}: teardown guards late callbacks`);
  }
});

test('disposal between frame phases wins against stale callback replays', () => {
  const animation = driver();
  let publishes = 0;
  const layout = new StageLayoutRefresh(() => publishes++, animation.port);
  layout.request();
  animation.flush(); // first frame completed, second is pending
  layout.dispose();
  animation.flush();
  for (const oldId of animation.canceled) animation.replayCanceled(oldId);
  layout.request(); // cannot restart after destroy
  animation.flush();
  assert.equal(publishes, 0);
  assert.equal(animation.pendingCount, 0);
});
