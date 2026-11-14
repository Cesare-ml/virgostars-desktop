import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {StageLayoutRefresh} from '../src/app/stage-resize-monitor.ts';

function frames() {
  const pending = new Map();
  const historical = new Map();
  const canceled = [];
  let id = 0;
  const driver = {
    request(callback) {
      const ticket = ++id;
      pending.set(ticket, callback);
      historical.set(ticket, callback);
      return ticket;
    },
    cancel(ticket) {
      canceled.push(ticket);
      pending.delete(ticket);
    },
  };
  return {
    driver, pending, canceled,
    flush() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    fire(ticket) { historical.get(ticket)?.(); },
  };
}

test('two frames defer measurement until after the sidebar DOM can render', () => {
  const f = frames(); let refreshes = 0;
  const layout = new StageLayoutRefresh(() => refreshes++, f.driver);
  layout.request(); layout.request(); layout.request();
  assert.equal(f.pending.size, 1, 'rapid toggles coalesce');
  f.flush(); assert.equal(refreshes, 0);
  assert.equal(f.pending.size, 1, 'second frame is scheduled');
  f.flush(); assert.equal(refreshes, 1);
  assert.equal(f.pending.size, 0);
  layout.dispose();
});

test('a toggle between frames restarts two measurements after the latest change', () => {
  const f = frames(); let updates = 0;
  const layout = new StageLayoutRefresh(() => updates++, f.driver);
  layout.request();
  f.flush(); // first animation frame queued the old second one
  assert.deepEqual([...f.pending.keys()], [2]);
  layout.request(); // another panel changed before that old second frame
  assert.deepEqual(f.canceled, [2]);
  assert.deepEqual([...f.pending.keys()], [3]);
  f.fire(2); // canceled callback is still inert even if WebView queues it
  assert.equal(updates, 0);
  f.flush(); assert.equal(updates, 0, 'latest change still needs a second frame');
  f.flush(); assert.equal(updates, 1);
  layout.dispose();
});

test('restarting a pending frame tolerates failed cancel and excludes stale callbacks', () => {
  const f = frames(); let updates = 0;
  const driver = {
    request: cb => f.driver.request(cb),
    cancel() { throw Error('WebView cancellation failed'); },
  };
  const layout = new StageLayoutRefresh(() => updates++, driver);
  layout.request();
  const obsolete = [...f.pending.keys()][0];
  layout.request(); // must not throw, despite a failed cancel
  f.fire(obsolete);
  assert.equal(updates, 0, 'old ticket must not refresh');
  f.flush(); // both old and new callback may still be queued
  assert.equal(updates, 0);
  f.flush(); assert.equal(updates, 1);
  layout.dispose();
});

test('disposing inside cancellation never creates another pending frame', () => {
  const f = frames(); let layout;
  const driver = {
    request: cb => f.driver.request(cb),
    cancel(id) { f.driver.cancel(id); layout.dispose(); },
  };
  layout = new StageLayoutRefresh(() => assert.fail('disposed'), driver);
  layout.request();
  layout.request(); // cancel() synchronously destroys the host component
  assert.equal(f.pending.size, 0);
  assert.deepEqual(f.canceled, [1]);
  layout.request(); // disposed requests remain inert
  assert.equal(f.pending.size, 0);
});

test('nested panel request during cancellation wins without orphan frames', () => {
  const f = frames(); let layout; let nested = false; let refreshes = 0;
  const driver = {
    request: cb => f.driver.request(cb),
    cancel(id) {
      f.driver.cancel(id);
      if (!nested) {
        nested = true;
        layout.request();
      }
    },
  };
  layout = new StageLayoutRefresh(() => refreshes++, driver);
  layout.request();
  layout.request(); // cancel() synchronously invokes an even newer request
  assert.deepEqual([...f.pending.keys()], [2]);
  f.flush(); f.flush();
  assert.equal(refreshes, 1);
  assert.equal(f.pending.size, 0);
  layout.dispose();
});

test('disposal while the frame driver registers cancels the returned stale handle', () => {
  const f = frames(); let layout;
  const driver = {
    request(callback) {
      const handle = f.driver.request(callback);
      layout.dispose(); // reentrant teardown before request() returns
      return handle;
    },
    cancel: id => f.driver.cancel(id),
  };
  layout = new StageLayoutRefresh(() => assert.fail('disposed'), driver);
  layout.request();
  assert.deepEqual(f.canceled, [1]);
  assert.equal(f.pending.size, 0);
  f.fire(1); // callbacks already delivered by the host remain inert
  assert.doesNotThrow(() => layout.dispose());
});

test('a new panel toggle after refresh starts a fresh pair of frames', () => {
  const f = frames(); let refreshes = 0;
  const layout = new StageLayoutRefresh(() => refreshes++, f.driver);
  layout.request(); f.flush(); f.flush();
  layout.request(); f.flush(); f.flush();
  assert.equal(refreshes, 2);
});

test('destroy cancels pending frame and rejects late callbacks', () => {
  const f = frames(); let refreshes = 0;
  const layout = new StageLayoutRefresh(() => refreshes++, f.driver);
  layout.request(); layout.dispose(); layout.dispose();
  assert.deepEqual(f.canceled, [1]);
  f.fire(1); layout.request(); f.flush();
  assert.equal(refreshes, 0);
  assert.equal(f.pending.size, 0);
});

test('destroy between first and second frames cancels the second', () => {
  const f = frames(); let refreshes = 0;
  const layout = new StageLayoutRefresh(() => refreshes++, f.driver);
  layout.request(); f.flush(); assert.equal(f.pending.size, 1);
  layout.dispose();
  assert.deepEqual(f.canceled, [2]);
  f.fire(2); assert.equal(refreshes, 0);
});

test('cancellation errors cannot escape component destruction', () => {
  let late;
  const layout = new StageLayoutRefresh(
    () => assert.fail('destroyed callback must be inert'),
    {request(callback) { late = callback; return 0; }, cancel() { throw Error('closed WebView'); }},
  );
  layout.request();
  assert.doesNotThrow(() => layout.dispose());
  assert.doesNotThrow(() => late());
});

test('broken scheduler fails closed; subsequent retry can refresh', () => {
  const f = frames(); let attempts = 0; let refreshes = 0;
  const port = {
    request(callback) {
      if (++attempts === 1) throw Error('animation frame temporarily unavailable');
      return f.driver.request(callback);
    },
    cancel: ticket => f.driver.cancel(ticket),
  };
  const layout = new StageLayoutRefresh(() => refreshes++, port);
  layout.request(); assert.equal(f.pending.size, 0);
  layout.request(); f.flush(); f.flush();
  assert.equal(refreshes, 1);
});

test('invalid frame handles are ignored without accepting late callbacks', () => {
  let orphan; let changes = 0;
  const layout = new StageLayoutRefresh(() => changes++, {
    request(callback) { orphan = callback; return NaN; },
    cancel() { assert.fail('no valid handle to cancel'); },
  });
  layout.request();
  orphan();
  assert.equal(changes, 0);
  assert.doesNotThrow(() => layout.dispose());
});

test('a throwing UI layout callback does not prevent a later panel refresh', () => {
  const f = frames(); let calls = 0;
  const layout = new StageLayoutRefresh(() => {
    calls++;
    if (calls === 1) throw Error('temporary layout failure');
  }, f.driver);
  layout.request(); f.flush(); f.flush();
  layout.request(); f.flush(); f.flush();
  assert.equal(calls, 2);
});

test('Angular panel toggles schedule a guarded post-render layout refresh', () => {
  const src = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(src, /new StageLayoutRefresh\(\(\) => this\.fitStage\(\)\)/);
  for (const name of ['toggleNavigation', 'toggleInspector']) {
    const body = src.match(new RegExp(name + '\\(\\): void \\{([\\s\\S]*?)\\n  \\}'))?.[1];
    assert.ok(body, name + ' handler missing');
    assert.match(body, /if \(this\.destroyed\) return;/);
    assert.match(body, /this\.cd\.markForCheck\(\);[\s\S]*this\.panelLayoutRefresh\.request\(\);/);
  }
  assert.match(src, /this\.panelLayoutRefresh\.dispose\(\)/);
});
