import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceClock} from '../src/app/device-clock.ts';
import {RuntimeCheckController} from '../src/app/native/runtime-check-controller.ts';

function clockHarness() {
  let wallTime = 1_000;
  let nextHandle = 0;
  const active = new Map();
  const clock = new DeviceClock({
    now: () => wallTime,
    schedule(callback) { const id = ++nextHandle; active.set(id, callback); return id; },
    cancel(id) { active.delete(id); },
  });
  return { clock, active, setWallTime: time => { wallTime = time; }, get schedules() {return nextHandle;} };
}

test('hidden clock pauses independently of a pending native status recheck', async () => {
  const fixture = clockHarness();
  let clockNotifications = 0;
  let nativeNotifications = 0;
  let resolveNative;
  const pending = new Promise(resolve => {resolveNative = resolve;});
  const controller = new RuntimeCheckController(() => pending, () => nativeNotifications++);
  fixture.clock.start(() => clockNotifications++);
  const staleTick = fixture.active.get(1);
  const request = controller.check();
  assert.equal(controller.checking, true);
  assert.equal(nativeNotifications, 1);
  fixture.clock.pause();
  fixture.setWallTime(9_000);
  staleTick();
  assert.equal(fixture.clock.timestamp, 1_000);
  fixture.clock.start(() => clockNotifications++);
  assert.equal(fixture.clock.timestamp, 9_000);
  assert.equal(clockNotifications, 1);
  assert.equal(fixture.schedules, 2);
  resolveNative({kind:'browser_preview',info:null});
  await request;
  assert.equal(controller.status, 'browser');
  assert.equal(controller.checking, false);
  assert.equal(nativeNotifications, 2);
  controller.dispose();
  fixture.clock.dispose();
});

test('destroying both services suppresses late interval ticks and IPC completions', async () => {
  const fixture = clockHarness();
  let clockNotifications = 0;
  let nativeNotifications = 0;
  let resolveNative;
  const pending = new Promise(resolve => {resolveNative = resolve;});
  const controller = new RuntimeCheckController(() => pending, () => nativeNotifications++);
  fixture.clock.start(() => clockNotifications++);
  const staleTick = fixture.active.get(1);
  const request = controller.check();
  fixture.clock.dispose();
  controller.dispose();
  fixture.setWallTime(99_000);
  staleTick();
  resolveNative({kind:'native_unavailable',info:null});
  await request;
  assert.equal(fixture.clock.timestamp, 1_000);
  assert.equal(clockNotifications, 0);
  assert.equal(nativeNotifications, 1, 'only the initial checking status was notified');
  assert.equal(controller.checking, false);
});

test('native probe failure and recovery do not interrupt the civil clock', async () => {
  const fixture = clockHarness();
  let notifications = 0;
  let attempts = 0;
  const controller = new RuntimeCheckController(async () => {
    if (++attempts === 1) throw new Error('private IPC details');
    return {kind:'browser_preview',info:null};
  }, () => {});
  fixture.clock.start(() => notifications++);
  await controller.check();
  assert.equal(controller.status,'unavailable');
  fixture.setWallTime(4_000);
  fixture.active.get(1)();
  assert.equal(notifications,1);
  await controller.check();
  assert.equal(controller.status,'browser');
  assert.equal(fixture.schedules,1,'native recheck does not create new clock timers');
  controller.dispose();
  fixture.clock.dispose();
});
