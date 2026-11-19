import test from 'node:test';
import assert from 'node:assert/strict';
import {withLocalOwnerFeatures} from '../scripts/local-owner-features.mjs';

test('local dev and build include both persistent and production account features', () => {
  for (const command of ['dev', 'build']) {
    assert.deepEqual(withLocalOwnerFeatures([command]),
      [command, '--features', 'production-connected-account,persistent-connected-account']);
  }
});

test('existing feature options are preserved and not duplicated', () => {
  assert.deepEqual(withLocalOwnerFeatures(['build', '--features', 'other,persistent-connected-account']),
    ['build', '--features', 'other,persistent-connected-account,production-connected-account']);
  assert.deepEqual(withLocalOwnerFeatures(['dev', '--features=other']),
    ['dev', '--features=other,production-connected-account,persistent-connected-account']);
  assert.throws(() => withLocalOwnerFeatures(['dev', '--features']));
});
