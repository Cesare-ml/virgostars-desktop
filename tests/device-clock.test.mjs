import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceClock, formatDeviceClock } from '../src/app/device-clock.ts';

function mockDriver(initial = 0) {
  let now = initial;
  let callback = null;
  let schedules = 0;
  let cancels = 0;
  return {
    driver: {
      now: () => now,
      schedule(fn) { callback = fn; schedules++; return 0; },
      cancel(id) { assert.equal(id, 0); cancels++; callback = null; },
    },
    advance(value) { now = value; callback?.(); },
    get schedules() { return schedules; },
    get cancels() { return cancels; },
  };
}

test('clock ticks from real sampled time and does not accumulate interval drift', () => {
  const fake = mockDriver(1_000);
  const clock = new DeviceClock(fake.driver);
  let renders = 0;
  clock.start(() => renders++);
  fake.advance(1_900);
  assert.equal(renders, 0);
  fake.advance(6_500);
  assert.equal(clock.timestamp, 6_500);
  assert.equal(renders, 1);
  fake.advance(900); // system clock corrected backwards
  assert.equal(clock.timestamp, 900);
  assert.equal(renders, 2);
});

test('start is idempotent and disposal cancels even a zero-valued timer id', () => {
  const fake = mockDriver(0);
  const clock = new DeviceClock(fake.driver);
  let changes = 0;
  clock.start(() => changes++);
  clock.start(() => changes++);
  assert.equal(fake.schedules, 1);
  clock.dispose();
  clock.dispose();
  fake.advance(10_000);
  clock.refresh(() => changes++);
  clock.start(() => changes++);
  assert.equal(fake.cancels, 1);
  assert.equal(fake.schedules, 1);
  assert.equal(changes, 0);
});

test('invalid device readings neither throw nor reach the UI', () => {
  const fake = mockDriver(NaN);
  const clock = new DeviceClock(fake.driver);
  let changes = 0;
  assert.ok(Number.isNaN(clock.timestamp));
  clock.start(() => changes++);
  fake.advance(Infinity);
  fake.advance(8_640_000_000_000_001);
  assert.equal(changes, 0);
  fake.advance(12_000);
  assert.equal(clock.timestamp, 12_000);
  assert.equal(changes, 1);
});

test('Italian/English formats expose explicit device offset/zone with 24-hour seconds', () => {
  const instant = Date.parse('2026-11-12T16:31:10Z');
  const it = formatDeviceClock(instant, 'it', false, 'Europe/Rome');
  const en = formatDeviceClock(instant, 'en', false, 'Europe/Rome');
  assert.match(it, /17:31:10/);
  assert.match(en, /17:31:10/);
  assert.match(it, /2026/);
  assert.match(en, /2026/);
  assert.ok(it.length > formatDeviceClock(instant, 'it', true, 'Europe/Rome').length);
});

test('DST and civil timezone are provided by Intl, not by invented fixed offsets', () => {
  const jan = Date.parse('2026-01-12T12:00:00Z');
  const jul = Date.parse('2026-07-12T12:00:00Z');
  assert.match(formatDeviceClock(jan,'en',true,'Europe/Rome'),/13:00:00/);
  assert.match(formatDeviceClock(jul,'en',true,'Europe/Rome'),/14:00:00/);
  assert.match(formatDeviceClock(jan,'en',true,'UTC'),/12:00:00/);
});

test('invalid time/timezone fails closed without showing an artificial real date', () => {
  assert.equal(formatDeviceClock(NaN,'it'), '—');
  assert.equal(formatDeviceClock(Infinity,'en'), '—');
  assert.equal(formatDeviceClock(0,'it',false,'Not/A_Zone'), '—');
});


test('invalid samples replace stale displayed time with unavailable and recover', () => {
  const fake = mockDriver(10_000);
  const clock = new DeviceClock(fake.driver);
  let renders = 0;
  clock.start(() => renders++);
  fake.advance(NaN);
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(formatDeviceClock(clock.timestamp, 'it'), '—');
  assert.equal(renders, 1);
  fake.advance(Infinity);
  fake.advance(8_640_000_000_000_001);
  assert.equal(renders, 1, 'repeat invalid readings do not trigger redraw storms');
  fake.advance(10_700);
  assert.equal(clock.timestamp, 10_700);
  assert.equal(renders, 2, 'valid reading recovers even within the original second');
  clock.dispose();
});

test('throwing system time source is contained at construction and on ticks', () => {
  let value = 1_000;
  let shouldThrow = true;
  let tick = null;
  const driver = {
    now() { if (shouldThrow) throw new Error('private local time provider details'); return value; },
    schedule(callback) { tick = callback; return 0; },
    cancel(id) { assert.equal(id, 0); tick = null; },
  };
  const clock = new DeviceClock(driver);
  assert.ok(Number.isNaN(clock.timestamp));
  let renders = 0;
  clock.start(() => renders++);
  assert.equal(renders, 0, 'invalid->invalid does not notify');
  shouldThrow = false;
  tick();
  assert.equal(clock.timestamp, 1_000);
  assert.equal(renders, 1);
  shouldThrow = true;
  assert.doesNotThrow(() => tick());
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(renders, 2);
  assert.equal(formatDeviceClock(clock.timestamp, 'en'), '—');
  clock.dispose();
});


test('scheduler failure is contained and live time becomes unavailable until retry', () => {
  let now = 5_000;
  let failSchedule = true;
  let tick = null;
  let schedules = 0;
  const driver = {
    now: () => now,
    schedule(fn) {
      schedules++;
      if (failSchedule) throw new Error('private timer details');
      tick = fn;
      return 0;
    },
    cancel(id) { assert.equal(id, 0); tick = null; },
  };
  const clock = new DeviceClock(driver);
  let notifications = 0;
  assert.doesNotThrow(() => clock.start(() => notifications++));
  assert.ok(Number.isNaN(clock.timestamp), 'not a frozen plausible clock');
  assert.equal(formatDeviceClock(clock.timestamp, 'en'), '—');
  assert.equal(notifications, 1);
  assert.equal(schedules, 1);
  now = 6_000;
  failSchedule = false;
  clock.start(() => notifications++);
  assert.equal(clock.timestamp, 6_000);
  assert.equal(notifications, 2);
  assert.equal(schedules, 2);
  clock.start(() => notifications++);
  assert.equal(schedules, 2, 'successful start is idempotent');
  now = 7_000;
  tick();
  assert.equal(clock.timestamp, 7_000);
  assert.equal(notifications, 3);
  clock.dispose();
});

test('scheduler rejecting an empty handle fails closed and can be retried', () => {
  let handle = undefined;
  let schedules = 0;
  const driver = {
    now: () => 0,
    schedule() { schedules++; return handle; },
    cancel: () => assert.fail('nothing to cancel'),
  };
  const clock = new DeviceClock(driver);
  let notifications = 0;
  clock.start(() => notifications++);
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(notifications, 1);
  handle = null;
  clock.start(() => notifications++);
  assert.equal(schedules, 2);
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(notifications, 3, 'retry refresh then fails to schedule and hides the time');
  clock.dispose();
});

test('cancel failures and late callbacks never prevent destruction', () => {
  let lateTick;
  const driver = {
    now: () => 1000,
    schedule(fn) { lateTick = fn; return 0; },
    cancel() { throw new Error('private cancel failure'); },
  };
  const clock = new DeviceClock(driver);
  let changes = 0;
  clock.start(() => changes++);
  assert.doesNotThrow(() => clock.dispose());
  assert.doesNotThrow(() => clock.dispose());
  assert.doesNotThrow(() => lateTick());
  assert.equal(changes, 0);
  clock.start(() => changes++);
  assert.equal(changes, 0);
});

test('synchronous disposal inside scheduler cancels returned handle without resurrecting timer', () => {
  let clock;
  let cancels = 0;
  let callback;
  const driver = {
    now: () => 1_000,
    schedule(fn) { callback = fn; clock.dispose(); return 0; },
    cancel(id) { assert.equal(id, 0); cancels++; },
  };
  clock = new DeviceClock(driver);
  assert.doesNotThrow(() => clock.start(() => assert.fail('unexpected change')));
  assert.equal(cancels, 1);
  callback();
  assert.equal(clock.timestamp, 1_000);
});

test('start reentry from initial refresh cannot install a second timer', () => {
  let now = 0;
  let schedules = 0;
  const cancelled = [];
  const clock = new DeviceClock({
    now: () => now,
    schedule() { return ++schedules; },
    cancel: handle => cancelled.push(handle),
  });
  now = 2_000;
  let notifications = 0;
  clock.start(() => {
    notifications++;
    clock.start(() => assert.fail('nested start must not register a timer'));
  });
  assert.equal(notifications, 1);
  assert.equal(schedules, 1, 'at most one interval even when the UI callback reenters start');
  clock.dispose();
  assert.deepEqual(cancelled, [1]);
});

test('disposal during initial refresh never schedules an interval', () => {
  let now = 0;
  let schedules = 0;
  let cancels = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule() { schedules++; return 0; },
    cancel() { cancels++; },
  });
  now = 2_000;
  clock.start(() => clock.dispose());
  assert.equal(schedules, 0, 'destroyed owner must not start even a temporary timer');
  assert.equal(cancels, 0);
  assert.equal(clock.timestamp, 2_000);
});

test('synchronous scheduler tick cannot reenter a second start', () => {
  let now = 0;
  let schedules = 0;
  let cancels = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) {
      schedules++;
      if (schedules === 1) {
        now = 2_000;
        callback();
      }
      return schedules;
    },
    cancel() { cancels++; },
  });
  let notifications = 0;
  clock.start(() => {
    notifications++;
    clock.start(() => assert.fail('nested start must not register a timer'));
  });
  assert.equal(clock.timestamp, 2_000);
  assert.equal(notifications, 1);
  assert.equal(schedules, 1);
  clock.dispose();
  assert.equal(cancels, 1);
});

test('throwing initial notification does not prevent a live timer', () => {
  let now = 0, tick = null, schedules = 0, cancels = 0, notices = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(fn) { tick = fn; schedules++; return 0; },
    cancel(id) { assert.equal(id, 0); cancels++; tick = null; },
  });
  const notify = () => { notices++; throw new Error('private observer details'); };
  now = 2_000;
  assert.doesNotThrow(() => clock.start(notify));
  assert.equal(schedules, 1);
  now = 3_000;
  assert.doesNotThrow(() => tick());
  assert.equal(clock.timestamp, 3_000);
  assert.equal(notices, 2);
  clock.dispose();
  assert.equal(cancels, 1);
});

test('throwing invalidation observer still hides stale time and recovers', () => {
  let now = 10_000, tick, notices = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(fn) { tick = fn; return 0; },
    cancel() { tick = null; },
  });
  const notify = () => { notices++; throw new Error('private observer details'); };
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
  let now = 5_000, failing = true, tick, schedules = 0, notices = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule(fn) { schedules++; if (failing) throw Error('private scheduler'); tick = fn; return 0; },
    cancel() { tick = null; },
  });
  const notify = () => { notices++; throw Error('private observer'); };
  assert.doesNotThrow(() => clock.start(notify));
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(notices, 1);
  failing = false;
  now = 6_000;
  assert.doesNotThrow(() => clock.start(notify));
  assert.equal(schedules, 2);
  now = 7_000;
  assert.doesNotThrow(() => tick());
  assert.equal(clock.timestamp, 7_000);
  assert.equal(notices, 3);
  clock.dispose();
});

test('observer disposing and throwing during first refresh starts no timer', () => {
  let now = 1_000, schedules = 0;
  const clock = new DeviceClock({
    now: () => now,
    schedule() { schedules++; return 0; },
    cancel() { assert.fail('no interval should exist'); },
  });
  now = 2_000;
  assert.doesNotThrow(() => clock.start(() => { clock.dispose(); throw Error('private UI teardown'); }));
  assert.equal(schedules, 0);
  assert.equal(clock.timestamp, 2_000);
});
