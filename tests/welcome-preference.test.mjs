import test from 'node:test';
import assert from 'node:assert/strict';
import {clearGuestMode, GUEST_MODE_KEY, hasChosenGuestMode, rememberGuestMode} from '../src/app/welcome-preference.ts';

test('guest choice survives a new launch without storing identity or credentials', () => {
  const data = new Map();
  const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value)};
  assert.equal(hasChosenGuestMode(storage), false);
  assert.equal(rememberGuestMode(storage), true);
  assert.equal(hasChosenGuestMode(storage), true);
  assert.deepEqual([...data], [[GUEST_MODE_KEY, 'chosen']]);
  assert.equal(clearGuestMode(storage), true);
  assert.equal(hasChosenGuestMode(storage), false);
});

test('invalid or inaccessible storage does not claim a guest choice', () => {
  const broken = {getItem() { throw Error(); }, setItem() { throw Error(); }};
  assert.equal(hasChosenGuestMode(null), false);
  assert.equal(hasChosenGuestMode({getItem: () => 'other'}), false);
  assert.equal(hasChosenGuestMode(broken), false);
  assert.equal(rememberGuestMode(broken), false);
  assert.equal(clearGuestMode(broken), false);
});
