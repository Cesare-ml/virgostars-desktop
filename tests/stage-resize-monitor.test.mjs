import test from 'node:test';
import assert from 'node:assert/strict';
import {watchChartStageResize} from '../src/app/stage-resize-monitor.ts';

function environment({failCreate = false, failObserve = false, failAdd = false, failRemove = false, failDisconnect = false} = {}) {
  const calls = [];
  let observerNotify;
  let windowNotify;
  const port = {
    createObserver(notify) {
      calls.push('create');
      if (failCreate) throw new Error('Observer unavailable');
      observerNotify = notify;
      return {
        observe(target) {
          calls.push('observe');
          assert.equal(target, element);
          if (failObserve) throw new Error('Cannot observe');
        },
        disconnect() {
          calls.push('disconnect');
          if (failDisconnect) throw new Error('Cannot disconnect');
        },
      };
    },
    addWindowListener(notify) {
      calls.push('addWindow');
      if (failAdd) throw new Error('Window listener unavailable');
      windowNotify = notify;
    },
    removeWindowListener(notify) {
      calls.push('removeWindow');
      assert.equal(notify, windowNotify);
      if (failRemove) throw new Error('Cannot remove');
    },
  };
  return {port, calls, observerTick: () => observerNotify?.(), windowTick: () => windowNotify?.()};
}
const element = {};

test('observer path tracks stage, never adds global listener, and stops late events', () => {
  const e = environment(); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  assert.deepEqual(e.calls, ['create', 'observe']);
  e.observerTick(); assert.equal(changes, 1);
  stop(); stop(); e.observerTick();
  assert.equal(changes, 1);
  assert.deepEqual(e.calls, ['create', 'observe', 'disconnect']);
});

test('missing ResizeObserver uses window event fallback with reliable cleanup', () => {
  const e = environment({failCreate: true}); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  e.windowTick(); assert.equal(changes, 1);
  stop(); stop(); e.windowTick(); assert.equal(changes, 1);
  assert.deepEqual(e.calls, ['create', 'addWindow', 'removeWindow']);
});

test('observer attachment failure disconnects partial registration before fallback', () => {
  const e = environment({failObserve: true}); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  e.observerTick(); assert.equal(changes, 0, 'discarded observer must not update chart');
  e.windowTick(); assert.equal(changes, 1);
  stop(); e.observerTick(); e.windowTick(); assert.equal(changes, 1);
  assert.deepEqual(e.calls, ['create', 'observe', 'disconnect', 'addWindow', 'removeWindow']);
});

test('failed fallback setup does not stop chart initialization', () => {
  const e = environment({failCreate: true, failAdd: true});
  const stop = watchChartStageResize(element, () => assert.fail('No listener'), e.port);
  assert.doesNotThrow(() => { stop(); stop(); });
  assert.deepEqual(e.calls, ['create', 'addWindow', 'removeWindow']);
});

test('disconnect errors are contained and late callbacks become inert', () => {
  const e = environment({failDisconnect: true}); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  assert.doesNotThrow(stop); e.observerTick(); assert.equal(changes, 0);
});

test('failed fallback removal is contained and late callbacks become inert', () => {
  const e = environment({failCreate: true, failRemove: true}); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  assert.doesNotThrow(stop); e.windowTick(); assert.equal(changes, 0);
});

test('live fallback remains usable after observer cleanup itself throws', () => {
  const e = environment({failObserve: true, failDisconnect: true}); let changes = 0;
  const stop = watchChartStageResize(element, () => changes++, e.port);
  e.windowTick(); assert.equal(changes, 1); stop();
  assert.deepEqual(e.calls, ['create', 'observe', 'disconnect', 'addWindow', 'removeWindow']);
});

test('observer notification errors are contained without downgrading into window fallback', () => {
  let notify;
  let windowRegistrations = 0;
  let calls = 0;
  const env = {
    createObserver(callback) {
      notify = callback;
      return {observe() { callback(); }, disconnect() {}};
    },
    addWindowListener() { windowRegistrations++; },
    removeWindowListener() {},
  };
  const stop = watchChartStageResize(element, () => {
    calls++;
    if (calls === 1) throw new Error('Transient layout read');
  }, env);
  assert.equal(windowRegistrations, 0, 'a throwing UI observer is not a broken ResizeObserver');
  assert.doesNotThrow(() => notify());
  assert.equal(calls, 2);
  stop();
});

test('window fallback isolates transient UI callback failure and continues observing', () => {
  let notify;
  let calls = 0;
  const env = {
    createObserver() { throw new Error('No ResizeObserver'); },
    addWindowListener(callback) { notify = callback; },
    removeWindowListener() {},
  };
  const stop = watchChartStageResize(element, () => {
    calls++;
    if (calls === 1) throw new Error('Transient stage');
  }, env);
  assert.doesNotThrow(() => notify());
  assert.doesNotThrow(() => notify());
  assert.equal(calls, 2);
  stop();
});

test('creation failure with captured observer callback ignores its late notifications', () => {
  let abandoned;
  let fallback;
  let changes = 0;
  const env = {
    createObserver(notify) {
      abandoned = notify;
      throw new Error('Partially created observer');
    },
    addWindowListener(notify) { fallback = notify; },
    removeWindowListener() {},
  };
  const stop = watchChartStageResize(element, () => changes++, env);
  abandoned(); assert.equal(changes, 0);
  fallback(); assert.equal(changes, 1);
  abandoned(); assert.equal(changes, 1);
  stop(); abandoned(); fallback(); assert.equal(changes, 1);
});

test('disconnect-triggered callbacks are already invalid before fallback activation', () => {
  let abandoned;
  let fallback;
  let changes = 0;
  const env = {
    createObserver(notify) {
      abandoned = notify;
      return {
        observe() { throw new Error('Broken observer registration'); },
        disconnect() { abandoned(); },
      };
    },
    addWindowListener(notify) { fallback = notify; },
    removeWindowListener() {},
  };
  const stop = watchChartStageResize(element, () => changes++, env);
  assert.equal(changes, 0);
  fallback(); assert.equal(changes, 1);
  stop();
});

test('partially registered fallback is inert when event listener registration throws', () => {
  let abandoned;
  let fallback;
  let removed = false;
  let changes = 0;
  const env = {
    createObserver(notify) { abandoned = notify; throw new Error('Missing observer'); },
    addWindowListener(notify) {
      fallback = notify;
      throw new Error('Window registration failed after attachment');
    },
    removeWindowListener(notify) {
      assert.equal(notify, fallback);
      removed = true;
    },
  };
  const stop = watchChartStageResize(element, () => changes++, env);
  assert.equal(removed, true, 'partial fallback attachment must be removed');
  abandoned(); fallback();
  assert.equal(changes, 0);
  assert.doesNotThrow(stop);
});
