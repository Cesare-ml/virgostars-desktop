import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSyntheticFrontend } from '../scripts/prepare-synthetic-frontend.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'virgostars-desktop-spike-'));
  const charts = join(root, 'astrological-charts');
  const frontend = join(root, 'desktop-build');
  const built = join(charts, 'dist/demo/browser');
  const assets = join(charts, '.local/demo-pack/public/assets/img');
  const manifestDir = join(charts, '.local/demo-pack/manifests');
  mkdirSync(built, { recursive: true }); mkdirSync(assets, { recursive: true }); mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(built, 'index.html'), '<html><head><base href="/"></head><body>TEST</body></html>');
  writeFileSync(join(built, 'main.js'), 'export const version="test";');
  const data = Buffer.from('synthetic-fixture-not-real-artwork');
  writeFileSync(join(assets, 'sample.png'), data);
  const record = { path: 'img/sample.png', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), rightsHolder: 'Astrological Charts synthetic test fixture' };
  const manifest = { schemaVersion: 1, source: { repository: 'synthetic-local-fixtures', commit: 'none', assetRoot: 'public/assets' }, assets: [record] };
  const manifestPath = join(manifestDir, 'approved-assets.json');
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest));
  save();
  return { root, charts, frontend, assets, record, manifest, save, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('packs a real Angular build and approved synthetic assets entirely offline', () => {
  const f = fixture();
  try {
    const output = prepareSyntheticFrontend(f.charts, f.frontend);
    assert.equal(output.count, 1);
    assert.equal(readFileSync(join(f.frontend, 'assets/img/sample.png'), 'utf8'), 'synthetic-fixture-not-real-artwork');
    assert.match(readFileSync(join(f.frontend, 'index.html'), 'utf8'), /desktop-assets-bootstrap\.js/);
    assert.ok(readFileSync(join(f.frontend, 'desktop-assets-bootstrap.js'), 'utf8').includes("new URL('/assets/'"));
    assert.throws(() => prepareSyntheticFrontend(f.charts, f.frontend), /Destination exists/);
  } finally { f.cleanup(); }
});

test('rejects a non-synthetic manifest, even when hashes are valid', () => {
  const f = fixture();
  try { f.manifest.source.repository = 'private-virgostars-artwork'; f.save();
    assert.throws(() => prepareSyntheticFrontend(f.charts, f.frontend), /Only the generated synthetic pack/);
  } finally { f.cleanup(); }
});

test('rejects modified bytes and never creates the destination', () => {
  const f = fixture();
  try { writeFileSync(join(f.assets, 'sample.png'), 'replaced');
    assert.throws(() => prepareSyntheticFrontend(f.charts, f.frontend), /Tampered synthetic asset/);
    assert.throws(() => readFileSync(join(f.frontend, 'index.html')));
  } finally { f.cleanup(); }
});

test('supports space-containing synthetic renderer filenames', () => {
  const f = fixture();
  try {
    const oldFile = join(f.assets, 'sample.png'), newFile = join(f.assets, 'true node.png');
    const bytes = readFileSync(oldFile);
    writeFileSync(newFile, bytes);
    rmSync(oldFile);
    f.manifest.assets[0].path = 'img/true node.png'; f.save();
    prepareSyntheticFrontend(f.charts, f.frontend);
    assert.deepEqual(readFileSync(join(f.frontend, 'assets/img/true node.png')), bytes);
  } finally { f.cleanup(); }
});

test('rejects traversal paths', () => {
  const f = fixture();
  try { f.manifest.assets[0].path = 'img/../secret.png'; f.save();
    assert.throws(() => prepareSyntheticFrontend(f.charts, f.frontend), /Unsafe synthetic asset path/);
  } finally { f.cleanup(); }
});

test('rejects symlinked asset files', () => {
  const f = fixture();
  try {
    rmSync(join(f.assets, 'sample.png'));
    symlinkSync(join(f.charts, 'dist/demo/browser/main.js'), join(f.assets, 'sample.png'));
    assert.throws(() => prepareSyntheticFrontend(f.charts, f.frontend), /Symlink forbidden/);
  } finally { f.cleanup(); }
});
