import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {APPROVED_PLACES_OVERRIDE, verifyPlacesTauriOverride} from '../scripts/verify-places-tauri-override.mjs';

function withSyntheticOverride(run) {
  const root = mkdtempSync(join(tmpdir(), 'vs-places-override-'));
  const local = join(root, '.local');
  const places = join(local, 'places');
  const file = join(places, 'tauri-places.conf.json');
  const canonical = JSON.stringify(APPROVED_PLACES_OVERRIDE, null, 2) + '\n';
  mkdirSync(places, {recursive: true});
  writeFileSync(file, canonical);
  try { run({root, local, places, file, canonical}); }
  finally { rmSync(root, {recursive: true, force: true}); }
}

function linkOrSkip(t, target, link, type) {
  try { symlinkSync(target, link, type); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) {
      t.skip('Creating directory links is unavailable on this host');
      return false;
    }
    throw error;
  }
  return true;
}

test('accepts only the canonical resource-only override in a regular local pack', () => {
  withSyntheticOverride(({file, canonical}) => {
    assert.deepEqual(verifyPlacesTauriOverride(file), {approvedResources: 2});
    writeFileSync(file, canonical.replace(/\n/g, '\r\n'));
    assert.deepEqual(verifyPlacesTauriOverride(file), {approvedResources: 2});
  });
});

test('rejects altered, additional, duplicate-key or malformed resource configuration', () => {
  withSyntheticOverride(({file, canonical}) => {
    for (const changed of [
      canonical.replace('"active": true', '"active": false'),
      canonical.replace('"resources": {', '"resources": {"external": "secret",'),
      canonical.replace('"active": true', '"active": true, "active": true'),
      '{broken',
    ]) {
      writeFileSync(file, changed);
      assert.throws(() => verifyPlacesTauriOverride(file),
        /Tauri city override differs from generated resource-only template/);
    }
  });
});

test('rejects a matching JSON file placed outside the expected .local/places layout', () => {
  withSyntheticOverride(({root, canonical}) => {
    const folder = join(root, 'other');
    mkdirSync(folder);
    const wrong = join(folder, 'tauri-places.conf.json');
    writeFileSync(wrong, canonical);
    assert.throws(() => verifyPlacesTauriOverride(wrong), /override location/);
  });
});

test('rejects a symlinked city override itself', t => {
  withSyntheticOverride(({root, file, canonical}) => {
    rmSync(file);
    const target = join(root, 'valid.json');
    writeFileSync(target, canonical);
    if (!linkOrSkip(t, target, file, 'file')) return;
    assert.throws(() => verifyPlacesTauriOverride(file), /Unapproved Tauri city override file/);
  });
});

test('rejects a symlinked places directory even when JSON bytes match', t => {
  withSyntheticOverride(({root, places, file, canonical}) => {
    const outside = join(root, 'external-places');
    mkdirSync(outside);
    writeFileSync(join(outside, 'tauri-places.conf.json'), canonical);
    rmSync(places, {recursive: true, force: true});
    if (!linkOrSkip(t, outside, places, 'dir')) return;
    assert.throws(() => verifyPlacesTauriOverride(file), /override directory/);
  });
});

test('rejects a symlinked .local directory even when target layout looks valid', t => {
  withSyntheticOverride(({root, local, file, canonical}) => {
    const outside = join(root, 'outside');
    mkdirSync(join(outside, 'places'), {recursive: true});
    writeFileSync(join(outside, 'places', 'tauri-places.conf.json'), canonical);
    rmSync(local, {recursive: true, force: true});
    if (!linkOrSkip(t, outside, local, 'dir')) return;
    assert.throws(() => verifyPlacesTauriOverride(file), /override directory/);
  });
});

test('missing local pack directory fails without exposing absolute paths or contents', () => {
  withSyntheticOverride(({places, file, root}) => {
    rmSync(places, {recursive: true, force: true});
    assert.throws(() => verifyPlacesTauriOverride(file), error => {
      assert.doesNotMatch(error.message, /vs-places-override-|tauri-places.conf.json|world-cities.sqlite/);
      assert.ok(!error.message.includes(root));
      return true;
    });
  });
});

test('Windows city build scripts already invoke the same pre-packaging override check', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['verify:places-override'],
    'node scripts/verify-places-tauri-override.mjs');
  for (const key of ['tauri:build:places:windows', 'tauri:build:places:private:windows']) {
    assert.match(pkg.scripts[key], /npm run verify:places-override && npm run build:ui/);
  }
});
