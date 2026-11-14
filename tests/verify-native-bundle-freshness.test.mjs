import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, symlinkSync, lstatSync, readFileSync } from 'node:fs';
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

test('rejects symlinked file and directory paths where the OS permits symlinks', t => fixture(({root,exe,dist,files}) => {
  try { symlinkSync(files[1], join(dist, 'extra.js'), 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) { t.skip('symlinks require elevated Windows privileges'); return; }
    throw error;
  }
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_UNSAFE_PATH/);
  rmSync(join(dist, 'extra.js'));
  symlinkSync(dist, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyNativeBundleFreshness(exe, join(root, 'alias')), /NATIVE_BUNDLE_UNSAFE_PATH/);
}));

test('rejects missing executable and bundle paths', () => fixture(({exe,dist,root}) => {
  assert.throws(() => verifyNativeBundleFreshness(join(root, 'missing.exe'), dist), /NATIVE_BUNDLE_MISSING/);
  assert.throws(() => verifyNativeBundleFreshness(exe, join(root, 'missing')), /NATIVE_BUNDLE_MISSING/);
}));

test('tolerates 1s filesystem timestamp granularity but rejects later modifications', () => fixture(({exe,dist,files,late}) => {
  const within = new Date(late.getTime() + 900);
  utimesSync(files[2], within, within);
  assert.equal(verifyNativeBundleFreshness(exe, dist).status, 'plausibly_current');
  const later = new Date(late.getTime() + 5000);
  utimesSync(files[2], later, later);
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_STALE_EXECUTABLE/);
}));

test('rejects excessively deep generated asset paths', () => fixture(({exe,dist,early}) => {
  let dir = dist;
  for (let i=0;i<17;i++) {
    dir = join(dir, 'd');
    mkdirSync(dir);
    utimesSync(dir, early, early);
  }
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_DEPTH_LIMIT/);
}));

test('bounds the number of empty directories as well as file count', () => fixture(({exe,dist}) => {
  for (let i=0; i<1025; i++) mkdirSync(join(dist, 'extra-' + i));
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_DIRECTORY_LIMIT/);
}));

test('checks sampled file and executable identity again before reporting success', () => {
  const source = readFileSync(new URL('../scripts/verify-native-bundle-freshness.mjs', import.meta.url), 'utf8');
  assert.match(source,/before\.ino === after\.ino/);
  assert.match(source,/before\.size === after\.size/);
  assert.match(source,/before\.mtimeMs === after\.mtimeMs/);
  assert.match(source,/before\.ctimeMs === after\.ctimeMs/);
  const scan = source.indexOf('inspect(root, 0);');
  const fileCheck = source.indexOf('for (const snapshot of snapshots)');
  const binaryCheck = source.indexOf('unchanged(executable, verifiedStat(executablePath');
  const success = source.indexOf("return Object.freeze({ files, status: 'plausibly_current' });");
  assert.ok(scan > 0 && fileCheck > scan && binaryCheck > fileCheck && success > binaryCheck);
  assert.match(source,/failure\('CHANGED_DURING_SCAN'\)/);
});


test('rechecks every visited directory after recursion and before a success report', () => {
  const source = readFileSync(new URL('../scripts/verify-native-bundle-freshness.mjs', import.meta.url), 'utf8');
  assert.match(source,/const directorySnapshots = \[\]/);
  assert.match(source,/directorySnapshots\.push\(\{ path: directory, stat: directoryBefore \}\)/);
  const walk = source.indexOf('inspect(root, 0);');
  const directoryRecheck = source.indexOf('for (const snapshot of directorySnapshots)', walk);
  const fileRecheck = source.indexOf('for (const snapshot of snapshots)', directoryRecheck);
  const executableRecheck = source.indexOf('unchanged(executable, verifiedStat(executablePath', fileRecheck);
  const success = source.indexOf("return Object.freeze({ files, status: 'plausibly_current' });", executableRecheck);
  assert.ok(walk > 0 && directoryRecheck > walk && fileRecheck > directoryRecheck &&
    executableRecheck > fileRecheck && success > executableRecheck);
  const fragment = source.slice(directoryRecheck, fileRecheck);
  assert.match(fragment,/unchanged\(snapshot\.stat, verifiedStat\(snapshot\.path, 'directory'\)\)/);
  assert.match(fragment,/failure\('CHANGED_DURING_SCAN'\)/);
});


test('streams directory entries and closes the directory handle on errors', () => {
  const source = readFileSync(new URL('../scripts/verify-native-bundle-freshness.mjs', import.meta.url), 'utf8');
  assert.match(source,/import \{ lstatSync, opendirSync \} from 'node:fs'/);
  assert.match(source,/handle = opendirSync\(directory\)/);
  assert.match(source,/entry = handle\.readSync\(\)/);
  assert.match(source,/if \(entry === null\) break/);
  assert.match(source,/finally \{[\s\S]*?handle\.closeSync\(\)/);
  assert.doesNotMatch(source,/readdirSync\(/);
});

test('rejects more than the file budget in one directory', () => fixture(({exe,dist}) => {
  for (let i = 0; i < 8193; i++) writeFileSync(join(dist, 'generated-' + i + '.dat'), 'x');
  assert.throws(() => verifyNativeBundleFreshness(exe, dist), /NATIVE_BUNDLE_FILE_LIMIT/);
}));


test('does not change file timestamps or create reports', () => fixture(({exe,dist,files}) => {
  const before = [...files,exe].map(file=>({file,mtime: lstatSync(file).mtimeMs}));
  verifyNativeBundleFreshness(exe, dist);
  assert.deepEqual([...files,exe].map(file=>({file,mtime: lstatSync(file).mtimeMs})), before);
}));
