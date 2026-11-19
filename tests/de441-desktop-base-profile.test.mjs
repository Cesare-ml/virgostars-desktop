// VirgoStars Desktop original source, CPAL-1.0. See LICENSE and NOTICE.
// Modification 2026-11-19: synthetic DE441 base-profile contract tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopBaseProfile, hasDesktopBaseProfile,
  DESKTOP_BASE_FIRST_YEAR, DESKTOP_BASE_LAST_YEAR,
} from '../scripts/ephemeris/desktop-base-profile.mjs';

test('private installer defaults to a continuous 1000–2200 DE441 base', () => {
  assert.equal(DESKTOP_BASE_FIRST_YEAR, 1000);
  assert.equal(DESKTOP_BASE_LAST_YEAR, 2200);
  const profile = desktopBaseProfile(1000, 2200);
  assert.equal(profile.stagedFirstYear, 1000);
  assert.equal(profile.stagedLastYearInclusive, 2200);
  assert.equal(profile.timeScale, 'JD_TDB');
  assert.equal(profile.calendar, 'proleptic-gregorian-astronomical');
  assert.ok(Object.isFrozen(profile));
  assert.ok(hasDesktopBaseProfile(JSON.parse(JSON.stringify(profile))));
});

test('larger private data bundles may include the whole required base', () => {
  const profile = desktopBaseProfile(0, 2300);
  assert.equal(profile.stagedFirstYear, 0);
  assert.equal(profile.stagedLastYearInclusive, 2300);
  assert.ok(hasDesktopBaseProfile(profile));
});

test('stale and incomplete 1890–2110 or malformed metadata cannot pass', () => {
  for (const [first, last] of [
    [1890, 2110], [1001, 2200], [1000, 2199], [2200, 1000],
    ['1.5', 2200], ['not-year', 2200], [-20001, 2200], [1000, 20001],
  ]) {
    assert.throws(() => desktopBaseProfile(first, last), /entire 1000–2200 base/);
  }
  const valid = desktopBaseProfile(1000, 2200);
  for (const invalid of [
    null, [], {}, {...valid, stagedFirstYear: 1890},
    {...valid, timeScale: 'UTC'}, {...valid, extra: 'unreviewed'},
    {...valid, stagedFirstYear: '1000'},
  ]) {
    assert.equal(hasDesktopBaseProfile(invalid), false);
  }
});
