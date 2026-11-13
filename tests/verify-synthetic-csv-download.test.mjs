import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedFictionalCsvBytes, verifySyntheticCsvDownload } from '../scripts/verify-synthetic-csv-download.mjs';

const script = fileURLToPath(new URL('../scripts/verify-synthetic-csv-download.mjs', import.meta.url));
const newFixture = t => {
  const folder = mkdtempSync(join(tmpdir(), 'vs-csv-acceptance-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'example.csv');
  writeFileSync(file, expectedFictionalCsvBytes());
  return { folder, file };
};

test('exact fictional CSV passes byte-for-byte comparison without modifying the file', t => {
  const { file } = newFixture(t);
  const expected = expectedFictionalCsvBytes();
  assert.equal(expected.toString('utf8').split('\r\n').length, 24);
  assert.ok(expected.toString('utf8').includes('FICTIONAL_NOT_CALCULATED'));
  assert.equal(verifySyntheticCsvDownload(file), true);
  assert.equal(verifySyntheticCsvDownload(file), true);
});

for (const [description, mutation] of [
  ['different planet coordinate', bytes => Buffer.from(bytes.toString('utf8').replace('19.3', '19.4'))],
  ['missing provenance marker', bytes => Buffer.from(bytes.toString('utf8').replace('FICTIONAL_NOT_CALCULATED', 'FICTIONAL__OT_CALCULATED'))],
  ['different house coordinate', bytes => Buffer.from(bytes.toString('utf8').replace('house,1,103.0', 'house,1,104.0'))],
  ['LF rather than CRLF', bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))],
  ['UTF8 BOM prepended', bytes => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])],
  ['appended text', bytes => Buffer.concat([bytes, Buffer.from('ignored')])],
  ['truncated file', bytes => bytes.subarray(0, bytes.length - 1)],
  ['zero-filled unrelated bytes of same size', bytes => Buffer.alloc(bytes.length)],
]) {
  test('rejects ' + description, t => {
    const { file } = newFixture(t);
    writeFileSync(file, mutation(expectedFictionalCsvBytes()));
    assert.equal(verifySyntheticCsvDownload(file), false);
  });
}

test('rejects missing/invalid paths and directory without printing their names', t => {
  const { folder } = newFixture(t);
  for (const path of [null, undefined, '', {}, folder, join(folder, 'missing.csv')]) {
    assert.equal(verifySyntheticCsvDownload(path), false);
  }
});

test('rejects a final symlink even when it points to an exact fixture file', t => {
  const { file, folder } = newFixture(t);
  const link = join(folder, 'symlink.csv');
  try { symlinkSync(file, link, 'file'); }
  catch (error) {
    if (['EPERM','EACCES','ENOTSUP','ENOSYS'].includes(error.code)) { t.skip('Symlinks unavailable on this host'); return; }
    throw error;
  }
  assert.equal(verifySyntheticCsvDownload(link), false);
});

test('CLI reports PASS for exact CSV and FAIL for changed CSV, without echoing selected path', t => {
  const { file } = newFixture(t);
  const run = () => spawnSync(process.execPath, ['--experimental-strip-types', script, '--file', file], { encoding: 'utf8' });
  const pass = run();
  assert.equal(pass.status, 0, pass.stderr);
  assert.match(pass.stdout, /^PASS: local file exactly matches/m);
  assert.ok(![pass.stdout, pass.stderr].join('').includes(file));
  writeFileSync(file, Buffer.alloc(expectedFictionalCsvBytes().length));
  const fail = run();
  assert.equal(fail.status, 1);
  assert.match(fail.stderr, /^FAIL: local file does not match/m);
  assert.ok(![fail.stdout, fail.stderr].join('').includes(file));
});

test('CLI refuses unexpected flags/arguments rather than reading an unrelated file', t => {
  const { file } = newFixture(t);
  for (const args of [[], ['--file'], [file], ['--file', file, '--verbose'], ['--file', '--help']]) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.ok(!result.stderr.includes(file));
  }
});
