import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceClock} from '../src/app/device-clock.ts';

test('a throwing first observer cannot prevent timer registration or later ticks', () => {
  let now = 1_000, tick, schedules = 0, notices = 0, cancelled = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) { tick = callback; schedules++; return 0; },
    cancel(handle) { assert.equal(handle, 0); cancelled++; },
  });
  now = 2_000;
  const notify = () => { notices++; throw new Error('private UI details'); };
  assert.doesNotThrow(() => clock.start(notify));
  assert.equal(schedules, 1);
  now = 3_000;
  assert.doesNotThrow(() => tick());
  assert.equal(clock.timestamp, 3_000);
  assert.equal(notices, 2);
  clock.dispose();
  assert.equal(cancelled, 1);
});

test('a throwing observer cannot leave stale valid time after an invalid reading', () => {
  let now = 10_000, tick, notices = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) { tick = callback; return 1; },
    cancel() {},
  });
  const notify = () => { notices++; throw new Error('private observer'); };
  clock.start(notify);
  now = NaN;
  assert.doesNotThrow(() => tick());
  assert.ok(Number.isNaN(clock.timestamp));
  now = Infinity;
  assert.doesNotThrow(() => tick());
  assert.equal(notices, 1);
  now = 11_000;
  assert.doesNotThrow(() => tick());
  assert.equal(clock.timestamp, 11_000);
  assert.equal(notices, 2);
  clock.dispose();
});

test('scheduler failure with throwing observer stays retryable', () => {
  let now = 5_000, fail = true, tick, schedules = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) { schedules++; if (fail) throw new Error('scheduler'); tick = callback; return 0; },
    cancel() {},
  });
  const notify = () => { throw new Error('UI'); };
  assert.doesNotThrow(() => clock.start(notify));
  assert.ok(Number.isNaN(clock.timestamp));
  fail = false;
  now = 6_000;
  assert.doesNotThrow(() => clock.start(notify));
  now = 7_000;
  assert.doesNotThrow(() => tick());
  assert.equal(clock.timestamp, 7_000);
  assert.equal(schedules, 2);
  clock.dispose();
});

test('observer that disposes and throws during first refresh never installs a timer', () => {
  let now = 1_000, schedules = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule() { schedules++; return 1; },
    cancel() { assert.fail('no timer should exist'); },
  });
  now = 2_000;
  assert.doesNotThrow(() => clock.start(() => {
    clock.dispose();
    throw new Error('UI teardown');
  }));
  assert.equal(schedules, 0);
  assert.equal(clock.timestamp, 2_000);
});

test('pause and resume continue after observer errors and ignore obsolete timer callbacks', () => {
  let now = 1_000, next = 0, notifications = 0;
  const callbacks = new Map();
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) { const id = ++next; callbacks.set(id, callback); return id; },
    cancel(id) { callbacks.delete(id); },
  });
  const observer = () => { notifications++; throw new Error('private view state'); };
  clock.start(observer);
  const stale = callbacks.get(1);
  clock.pause();
  now = 5_000;
  assert.doesNotThrow(() => stale());
  assert.equal(clock.timestamp, 1_000);
  assert.doesNotThrow(() => clock.start(observer));
  assert.equal(clock.timestamp, 5_000);
  now = 6_000;
  assert.doesNotThrow(() => callbacks.get(2)());
  assert.equal(clock.timestamp, 6_000);
  assert.equal(notifications, 2);
  clock.dispose();
});
