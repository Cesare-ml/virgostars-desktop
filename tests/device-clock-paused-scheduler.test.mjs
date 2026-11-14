import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceClock } from '../src/app/device-clock.ts';

test('pause during a throwing scheduler preserves clock snapshot without stale notification', () => {
  let clock;
  const original = 8_000;
  let notifications = 0;
  clock = new DeviceClock({
    now: () => original,
    schedule() {
      clock.pause();
      throw new Error('scheduler failed after pause');
    },
    cancel() { assert.fail('no interval was installed'); },
  });
  clock.start(() => notifications++);
  assert.equal(clock.timestamp, original);
  assert.equal(notifications, 0);
});

test('pause during null-handle schedule preserves clock snapshot and allows retry', () => {
  let clock;
  let schedules = 0;
  let wallTime = 8_000;
  let tick;
  let notifications = 0;
  clock = new DeviceClock({
    now: () => wallTime,
    schedule(callback) {
      schedules++;
      if (schedules === 1) { clock.pause(); return null; }
      tick = callback;
      return schedules;
    },
    cancel() {},
  });
  clock.start(() => notifications++);
  assert.equal(clock.timestamp, wallTime);
  assert.equal(notifications, 0);
  wallTime = 11_000;
  clock.start(() => notifications++);
  assert.equal(clock.timestamp, wallTime);
  assert.equal(notifications, 1);
  wallTime = 12_000;
  tick();
  assert.equal(clock.timestamp, wallTime);
  assert.equal(notifications, 2);
  clock.dispose();
});

test('ordinary scheduler failure still marks stale visible time unavailable', () => {
  let clock;
  let notified = 0;
  clock = new DeviceClock({
    now: () => 8_000,
    schedule() { throw new Error('missing timer'); },
    cancel() {},
  });
  clock.start(() => notified++);
  assert.ok(Number.isNaN(clock.timestamp));
  assert.equal(notified, 1);
});
