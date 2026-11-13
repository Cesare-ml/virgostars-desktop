import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {closePeDescriptorRedacted} from '../scripts/pe-safe-close.mjs';

test('PE descriptor is closed exactly once on the successful path', () => {
  const seen = [];
  closePeDescriptorRedacted(37, fd => seen.push(fd));
  assert.deepEqual(seen, [37]);
});

test('PE descriptor close I/O failures never disclose filesystem paths', () => {
  const sensitive = 'EIO: cannot close C:\\Users\\private-birth-data\\case.exe';
  assert.throws(
    () => closePeDescriptorRedacted(37, () => { throw new Error(sensitive); }),
    error => {
      assert.equal(error.message, 'WINDOWS_PE_UNREADABLE');
      assert.doesNotMatch(error.message, /private-birth-data|EIO|case\\.exe/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
});

test('PE descriptor close also redacts primitive and non-Error throws', () => {
  for (const failure of ['secret-path', {path: 'secret-path'}, null]) {
    assert.throws(
      () => closePeDescriptorRedacted(2, () => { throw failure; }),
      /^Error: WINDOWS_PE_UNREADABLE$/,
    );
  }
});

test('a successful finally close preserves the existing parse error', () => {
  let closed = false;
  assert.throws(() => {
    try {
      throw new Error('WINDOWS_PE_ENTRYPOINT_SECTION');
    } finally {
      closePeDescriptorRedacted(3, () => { closed = true; });
    }
  }, /^Error: WINDOWS_PE_ENTRYPOINT_SECTION$/);
  assert.equal(closed, true);
});

test('a failed finally close takes precedence but remains redacted', () => {
  assert.throws(() => {
    try {
      throw new Error('WINDOWS_PE_ENTRYPOINT_SECTION');
    } finally {
      closePeDescriptorRedacted(3, () => { throw new Error('/private/root/failure'); });
    }
  }, /^Error: WINDOWS_PE_UNREADABLE$/);
});

test('production PE verifier closes through the redacted boundary', () => {
  const source = readFileSync(new URL('../scripts/verify-windows-pe.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("import {closePeDescriptorRedacted} from './pe-safe-close.mjs';"));
  assert.ok(source.includes('if (fd !== undefined) closePeDescriptorRedacted(fd, closeSync);'));
  const finalBlock = source.slice(source.lastIndexOf('} finally {'));
  assert.ok(finalBlock.includes('if (fd !== undefined) closePeDescriptorRedacted(fd, closeSync);'));
});
