import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditBuildPrivacy } from '../scripts/verify-build-privacy.mjs';

function withBundle(callback) {
  const root = mkdtempSync(join(tmpdir(), 'vs-privacy-allowlist-'));
  const bundle = join(root, 'browser');
  mkdirSync(bundle);
  function add(path, data = 'fictional content') {
    const full = join(bundle, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  add('index.html', '<vs-desktop-app></vs-desktop-app>');
  add('main-LOCAL123.js', 'console.log("synthetic")');
  add('styles-LOCAL123.css', ':root{box-sizing:border-box}');
  add('assets/img/approved-test.png', Buffer.from('synthetic'));
  try { callback({ bundle, add }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('allows Angular entrypoint, hashed JS/CSS, notices and approved asset path', () => withBundle(({bundle, add}) => {
  add('3rdpartylicenses.txt', 'fictional license');
  add('LICENSE.txt', 'fictional license');
  add('NOTICE.txt', 'fictional notice');
  assert.deepEqual(auditBuildPrivacy(bundle), {files: 7, sourceFiles: 2});
}));

for (const file of [
  'assets/subject-history.json', 'assets/profile.csv', 'assets/backups.tar.gz',
  'assets/img/subject-notes.json', 'assets/img/approved-test.png.zip',
  'config.json', 'auth.json', 'user-data.json', 'src/index.html',
  'nested/main.js', 'assets/scripts/extra.js', 'media/thirdparty.woff2',
  'unreviewed.txt', 'assets/img/nested/extra.secret', 'favicon.ico',
]) {
  test('blocks unexpected output path: ' + file, () => withBundle(({bundle, add}) => {
    add(file);
    assert.throws(() => auditBuildPrivacy(bundle), /unapproved browser bundle file/);
  }));
}

test('blocks size above 64 MiB even for approved-looking assets', () => withBundle(({bundle, add}) => {
  add('assets/img/large.png', Buffer.alloc(64 * 1024 * 1024 + 1));
  assert.throws(() => auditBuildPrivacy(bundle), /oversized browser bundle file/);
}));

test('blocks deep directory trees without exhausting recursion', () => withBundle(({bundle, add}) => {
  add('assets/img/' + Array.from({length:34}, (_, i) => 'dir' + i).join('/') + '/file.png');
  assert.throws(() => auditBuildPrivacy(bundle), /nesting limit exceeded/);
}));

test('never includes a private-looking filename or absolute path in rejection', () => withBundle(({bundle, add}) => {
  add('assets/PRIVATE_PERSON_BIRTH_DATA.json');
  assert.throws(() => auditBuildPrivacy(bundle), error => {
    assert.match(error.message, /DESKTOP BUILD PRIVACY:/);
    assert.doesNotMatch(error.message, /PRIVATE_PERSON_BIRTH_DATA|vs-privacy-allowlist/);
    return true;
  });
}));
