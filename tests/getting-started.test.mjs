import test from 'node:test';
import assert from 'node:assert/strict';
import {GETTING_STARTED_KEY, GETTING_STARTED_STEPS, shouldShowGettingStarted, dismissGettingStarted} from '../src/app/getting-started.ts';
import {STRINGS} from '../src/app/translations.ts';

test('first-run guide can be dismissed without storing chart or personal data', () => {
  let value = null;
  const storage = {getItem(key) { assert.equal(key,GETTING_STARTED_KEY); return value; },
    setItem(key, next) { assert.equal(key,GETTING_STARTED_KEY); value = next; }};
  assert.equal(shouldShowGettingStarted(storage),true);
  dismissGettingStarted(storage);
  assert.equal(value,'done'); assert.equal(shouldShowGettingStarted(storage),false);
  value = 'unexpected'; assert.equal(shouldShowGettingStarted(storage),true);
  const broken = {getItem() { throw Error(); }, setItem() { throw Error(); }};
  assert.equal(shouldShowGettingStarted(broken),true);
  assert.doesNotThrow(() => dismissGettingStarted(broken));
});
test('guide steps are translated and cover workspace, charts and tools', () => {
  assert.equal(GETTING_STARTED_STEPS.length,3);
  for (const step of GETTING_STARTED_STEPS) for (const locale of ['it','en']) {
    assert.ok(STRINGS[locale][step.title]); assert.ok(STRINGS[locale][step.body]);
  }
});
