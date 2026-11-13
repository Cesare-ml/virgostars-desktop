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
