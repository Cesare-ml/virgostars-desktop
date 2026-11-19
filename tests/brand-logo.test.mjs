import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BRAND_WORDMARK} from '../src/app/brand-wordmark.ts';

test('offline welcome wordmark preserves the supplied image', () => {
  const prefix='data:image/png;base64,';
  assert.ok(BRAND_WORDMARK.startsWith(prefix));
  assert.deepEqual(Buffer.from(BRAND_WORDMARK.slice(prefix.length),'base64'),
    readFileSync(new URL('../src/assets/virgostars-opening.png',import.meta.url)));
});
