import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, symlinkSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyNativeBundleFreshness } from '../scripts/verify-native-bundle-freshness.mjs';

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), 'vs-native-bundle-'));
  const exe = join(root, 'app.exe');
  const dist = join(root, 'dist');
  mkdirSync(dist);
  mkdirSync(join(dist, 'chunks'));
  writeFileSync(exe, 'synthetic binary fixture');
  const files = [join(dist, 'index.html'), join(dist, 'main.js'), join(dist, 'styles.css'), join(dist, 'chunks', 'shared.mjs')];
  for (const file of files) writeFileSync(file, 'synthetic fixture');
  const early = new Date('2026-11-01T12:00:00.000Z');
  const late = new Date('2026-11-01T12:01:00.000Z');
  for (const file of files) utimesSync(file, early, early);
  utimesSync(exe, late, late);
  try { check({ root, exe, dist, files, early, late }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts a newer executable than nested synthetic HTML, JS and CSS artifacts', () => fixture(({exe,dist}) => {
  assert.deepEqual(verifyNativeBundleFreshness(exe, dist), { files: 4, status: 'plausibly_current' });
}));

test('rejects a CSS file newer than the executable', () => fixture(({exe,dist,files,late}) => {
  const newer = new Date(late.getTime() + 60_000);
  utimesSync(files[2], newer, newer);
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_STALE_EXECUTABLE/);
}));

test('rejects a nested lazy JS chunk newer than the executable', () => fixture(({exe,dist,files,late}) => {
  const newer = new Date(late.getTime() + 30_000);
  utimesSync(files[3], newer, newer);
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_STALE_EXECUTABLE/);
}));

test('rejects an executable older than index.html', () => fixture(({exe,dist,files,late}) => {
  const newer = new Date(late.getTime() + 45_000);
  utimesSync(files[0], newer, newer);
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_STALE_EXECUTABLE/);
}));

test('rejects missing HTML, JavaScript or CSS entrypoints', () => {
  for (const item of ['index.html', 'main.js', 'styles.css']) fixture(({exe,dist}) => {
    rmSync(join(dist, item));
    assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_INCOMPLETE_BUNDLE/);
  });
});

test('rejects symlinked file and directory paths', () => fixture(({root,exe,dist,files}) => {
  symlinkSync(files[1], join(dist, 'extra.js'));
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_UNSAFE_PATH/);
  rmSync(join(dist, 'extra.js'));
  symlinkSync(dist, join(root, 'alias'));
  assert.throws(() => verifyNativeBundleFreshness(exe, join(root, 'alias')), /NATIVE_BUNDLE_UNSAFE_PATH/);
}));

test('rejects missing executable and bundle paths', () => fixture(({exe,dist,root}) => {
  assert.throws(() => verifyNativeBundleFreshness(join(root, 'missing.exe'), dist), /NATIVE_BUNDLE_MISSING/);
  assert.throws(() => verifyNativeBundleFreshness(exe, join(root, 'missing')), /NATIVE_BUNDLE_MISSING/);
}));

test('does not change file timestamps or create reports', () => fixture(({exe,dist,files}) => {
  const before = [...files,exe].map(file=>({file,mtime: lstatSync(file).mtimeMs}));
  verifyNativeBundleFreshness(exe, dist);
  assert.deepEqual([...files,exe].map(file=>({file,mtime: lstatSync(file).mtimeMs})), before);
}));
