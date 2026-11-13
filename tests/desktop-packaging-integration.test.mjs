import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyOfflineBundle } from '../scripts/verify-offline-bundle.mjs';
import { auditBuildPrivacy } from '../scripts/verify-build-privacy.mjs';

function withBundle(callback) {
  const root = mkdtempSync(join(tmpdir(), 'virgostars-packaging-combined-'));
  const bundle = join(root, 'dist/desktop/browser');
  const staging = join(root, '.local/frontend');
  const image = join(bundle, 'assets/img/fixture.png');
  const bytes = Buffer.from('synthetic test image, not real artwork');
  mkdirSync(dirname(image), { recursive: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(image, bytes);
  writeFileSync(join(bundle, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><title>VirgoStars</title>' +
    '<base href="/"><link rel="stylesheet" href="styles-LOCAL123.css"></head>' +
    '<body><vs-desktop-app></vs-desktop-app>' +
    '<script src="main-LOCAL123.js" type="module"></script></body></html>');
  writeFileSync(join(bundle, 'styles-LOCAL123.css'),
    ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{display:block}');
  writeFileSync(join(bundle, 'main-LOCAL123.js'), '/* synthetic local Angular module */');
  writeFileSync(join(staging, 'synthetic-assets-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    source: { repository: 'synthetic-local-fixtures', commit: 'none' },
    files: [{ path: 'img/fixture.png', bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') }]
  }));
  try {
    callback({ bundle, staging, image });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('combined offline bundle and privacy gates accept synthetic Angular package', () => withBundle(f => {
  const bundle = verifyOfflineBundle(f.bundle, f.staging);
  assert.equal(bundle.count, 1);
  assert.equal(bundle.stylesheets, 1);
  assert.equal(bundle.scripts, 1);
  assert.equal(auditBuildPrivacy(f.bundle).files, 4);
}));

test('valid assets and links cannot hide extra JSON in the packaged browser output', () => withBundle(f => {
  assert.equal(verifyOfflineBundle(f.bundle, f.staging).count, 1);
  writeFileSync(join(f.bundle, 'secret-config.json'), '{"synthetic":"not authorized"}');
  assert.throws(() => auditBuildPrivacy(f.bundle), /DESKTOP BUILD PRIVACY/);
}));

test('privacy gate rejects JavaScript sourcemaps even if the main entrypoint passes', () => withBundle(f => {
  writeFileSync(join(f.bundle, 'main-LOCAL123.js'), '/*# sourceMappingURL=main-LOCAL123.js.map */');
  assert.equal(verifyOfflineBundle(f.bundle, f.staging).scripts, 1);
  assert.throws(() => auditBuildPrivacy(f.bundle), /source map directive/);
}));

test('base, CSS and JS gate failures cannot be bypassed by an otherwise clean privacy scan', () => {
  for (const corrupt of [
    f => writeFileSync(join(f.bundle, 'index.html'), readFileSync(join(f.bundle, 'index.html'), 'utf8').replace('<base href="/">', '<base href="https://example.invalid/">')),
    f => writeFileSync(join(f.bundle, 'index.html'), readFileSync(join(f.bundle, 'index.html'), 'utf8').replace('href="styles-LOCAL123.css"', 'href="styles-LOCAL123.css" disabled')),
    f => rmSync(join(f.bundle, 'main-LOCAL123.js'))
  ]) {
    withBundle(f => {
      corrupt(f);
      assert.throws(() => verifyOfflineBundle(f.bundle, f.staging),
        /DESKTOP BASE HREF|Disabled stylesheet|Local desktop script missing/);
    });
  }
});
