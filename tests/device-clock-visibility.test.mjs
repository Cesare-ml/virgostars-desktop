import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DeviceClock} from '../src/app/device-clock.ts';

function fakeClock(initial = 1_000) {
  let now = initial;
  let nextHandle = 0;
  const handlers = new Map();
  const cancelled = [];
  const driver = {
    now: () => now,
    schedule(callback) {
      const handle = nextHandle++;
      handlers.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      cancelled.push(handle);
      handlers.delete(handle);
    },
  };
  return {
    driver, cancelled, handlers,
    setNow(value) { now = value; },
    get schedules() { return nextHandle; },
  };
}

test('pause cancels hidden-window ticking and start resumes at wall time', () => {
  const fake = fakeClock();
  const clock = new DeviceClock(fake.driver);
  let changes = 0;
  clock.start(() => changes++);
  const obsoleteTick = fake.handlers.get(0);
  assert.equal(fake.schedules, 1);

  clock.pause();
  assert.deepEqual(fake.cancelled, [0]);
  fake.setNow(9_000);
  obsoleteTick(); // Callback queued before cancel must not update the UI.
  assert.equal(clock.timestamp, 1_000);
  assert.equal(changes, 0);

  clock.start(() => changes++);
  assert.equal(fake.schedules, 2);
  assert.equal(clock.timestamp, 9_000);
  assert.equal(changes, 1, 'resume samples actual wall time, not elapsed ticks');
  obsoleteTick(); // Old callback remains stale even after a fresh timer exists.
  assert.equal(changes, 1);
  fake.setNow(11_000);
  fake.handlers.get(1)();
  assert.equal(clock.timestamp, 11_000);
  assert.equal(changes, 2);
  clock.dispose();
  assert.deepEqual(fake.cancelled, [0, 1]);
});

test('repeated pause is safe, and disposed clocks cannot restart', () => {
  const fake = fakeClock();
  const clock = new DeviceClock(fake.driver);
  let changes = 0;
  clock.start(() => changes++);
  clock.pause();
  clock.pause();
  assert.deepEqual(fake.cancelled, [0]);
  clock.start(() => changes++);
  clock.dispose();
  clock.pause();
  clock.start(() => changes++);
  assert.deepEqual(fake.cancelled, [0, 1]);
  assert.equal(fake.schedules, 2);
});

test('pause during synchronous scheduler setup cancels the returned handle', () => {
  let clock;
  let schedules = 0;
  const cancelled = [];
  let staleCallback;
  const driver = {
    now: () => 2_000,
    schedule(callback) {
      staleCallback = callback;
      schedules++;
      if (schedules === 1) clock.pause();
      return schedules;
    },
    cancel(handle) { cancelled.push(handle); },
  };
  clock = new DeviceClock(driver);
  let changes = 0;
  clock.start(() => changes++);
  assert.deepEqual(cancelled, [1]);
  staleCallback();
  assert.equal(changes, 0);
  clock.start(() => changes++);
  assert.equal(schedules, 2, 'aborted schedule must not leave a phantom running timer');
  clock.dispose();
  assert.deepEqual(cancelled, [1, 2]);
});

test('failed timer cancellation does not block resume and stale callbacks stay fenced', () => {
  let now = 1_000;
  const handlers = [];
  const clock = new DeviceClock({
    now: () => now,
    schedule(callback) { handlers.push(callback); return handlers.length; },
    cancel() { throw new Error('private timer details'); },
  });
  let changes = 0;
  clock.start(() => changes++);
  assert.doesNotThrow(() => clock.pause());
  now = 5_000;
  handlers[0]();
  assert.equal(clock.timestamp, 1_000);
  clock.start(() => changes++);
  assert.equal(clock.timestamp, 5_000);
  handlers[0]();
  assert.equal(changes, 1);
  assert.doesNotThrow(() => clock.dispose());
  handlers[1]();
  assert.equal(changes, 1);
});

test('Angular Desktop registers and removes one visibility listener for clock lifetime', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(source, /document\.addEventListener\('visibilitychange', this\.onVisibilityChange\)/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', this\.onVisibilityChange\)/);
  assert.match(source, /document\.visibilityState === 'hidden'/);
  assert.match(source, /this\.deviceClock\.pause\(\)/);
  assert.match(source, /this\.deviceClock\.start\(this\.onClockChanged\)/);
  assert.match(source, /if \(this\.destroyed\) return;/);
});
