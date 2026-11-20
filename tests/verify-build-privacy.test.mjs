import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditBuildPrivacy } from '../scripts/verify-build-privacy.mjs';

function withBundle(callback) {
  const root = mkdtempSync(join(tmpdir(), 'vs-build-privacy-'));
  const bundle = join(root, 'browser');
  mkdirSync(join(bundle, 'assets', 'img'), { recursive: true });
  writeFileSync(join(bundle, 'index.html'), '<vs-desktop-app></vs-desktop-app>');
  writeFileSync(join(bundle, 'main-LOCAL123.js'), 'console.log("fictional test");');
  writeFileSync(join(bundle, 'styles-LOCAL123.css'), 'vs-desktop-app{display:block}');
  writeFileSync(join(bundle, 'assets', 'img', 'fictional.png'), Buffer.from('fictional image'));
  const add = (name, content = 'fictional') => {
    const path = join(bundle, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };
  try { callback({ root, bundle, add }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('accepts a minimal local Angular browser bundle with synthetic images', () => withBundle(({ bundle, add }) => {
  add('3rdpartylicenses.txt', 'fictional notice');
  assert.deepEqual(auditBuildPrivacy(bundle), { files: 5, sourceFiles: 2 });
}));

for (const file of [
  'main-LOCAL123.js.map', 'assets/debug.ts', 'assets/src/app.tsx',
  'assets/data.sqlite', 'assets/data.db', 'assets/debug.log',
  'assets/cert.pem', 'assets/private.key', 'assets/key.p12',
  'assets/credentials.json', 'assets/secrets.json', 'assets/id_rsa',
  '.env.production', 'assets/.npmrc', 'assets/notes.bak',
]) {
  test('rejects forbidden packaged artifact: ' + file, () => withBundle(({ bundle, add }) => {
    add(file);
    assert.throws(() => auditBuildPrivacy(bundle), /DESKTOP BUILD PRIVACY:/);
  }));
}

test('rejects source map directive embedded in minified JavaScript', () => withBundle(({ bundle, add }) => {
  add('chunk-A.js', '(()=>{})();\n//# sourceMappingURL=data:application/json;base64,AAAA');
  assert.throws(() => auditBuildPrivacy(bundle), /source map directive/);
}));

test('rejects source map directive embedded in CSS', () => withBundle(({ bundle, add }) => {
  add('styles-LOCAL123.css', 'a{color:red}/*# sourceMappingURL=styles-LOCAL123.css.map */');
  assert.throws(() => auditBuildPrivacy(bundle), /source map directive/);
}));

test('rejects a symlink file pointing outside the output', t => withBundle(({ root, bundle }) => {
  const outside = join(root, 'outside.txt');
  writeFileSync(outside, 'not a bundle file');
  try { symlinkSync(outside, join(bundle, 'outside.txt')); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Symlink creation unavailable on this host'); return; }
    throw error;
  }
  assert.throws(() => auditBuildPrivacy(bundle), /symbolic link/);
}));

test('rejects a symlink directory pointing outside the output', t => withBundle(({ root, bundle }) => {
  mkdirSync(join(root, 'outside'));
  try { symlinkSync(join(root, 'outside'), join(bundle, 'assets', 'external'), 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Symlink creation unavailable on this host'); return; }
    throw error;
  }
  assert.throws(() => auditBuildPrivacy(bundle), /symbolic link/);
}));

test('rejects Windows case-insensitive output path collisions on a case-sensitive host', t => withBundle(({ bundle, add }) => {
  add('assets/img/probe-case.jpg', 'probe');
  if (existsSync(join(bundle, 'assets/img/PROBE-CASE.jpg'))) {
    t.skip('The runner filesystem is case-insensitive; distinct case-variant names cannot coexist');
    return;
  }
  add('assets/img/fictional.jpg');
  add('assets/img/FICTIONAL.jpg');
  assert.throws(() => auditBuildPrivacy(bundle), /case-insensitive duplicate/);
}));

test('rejects missing index.html', () => withBundle(({ bundle }) => {
  rmSync(join(bundle, 'index.html'));
  assert.throws(() => auditBuildPrivacy(bundle), /safe index.html is missing/);
}));

test('rejects a symlink used as the bundle root', t => withBundle(({ root, bundle }) => {
  const alias = join(root, 'alias');
  try { symlinkSync(bundle, alias, 'dir'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('Symlink creation unavailable on this host'); return; }
    throw error;
  }
  assert.throws(() => auditBuildPrivacy(alias), /bundle directory is missing or unsafe/);
}));

test('rejects case-variant names without printing sensitive paths in error messages', () => withBundle(({ bundle, add }) => {
  add('assets/SECRET-CLIENT-123.db');
  assert.throws(() => auditBuildPrivacy(bundle), error => {
    assert.match(error.message, /DESKTOP BUILD PRIVACY:/);
    assert.doesNotMatch(error.message, /SECRET-CLIENT-123|vs-build-privacy-/);
    return true;
  });
}));
