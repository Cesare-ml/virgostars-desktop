import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { auditBuildPrivacy } from '../scripts/verify-build-privacy.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'vs-portable-artifacts-'));
  const bundle = join(root, 'browser');
  const add = (path, content = 'fictional') => {
    const fullPath = join(bundle, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  };
  const directory = path => mkdirSync(join(bundle, path), { recursive: true });
  add('index.html', '<vs-desktop-app></vs-desktop-app>');
  add('main-LOCAL.js', 'console.log("test-only");');
  add('styles-LOCAL.css', ':root{box-sizing:border-box}');
  add('assets/img/fixture.png', 'fictional-image');
  try { fn({ bundle, add, directory }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('supports legitimate nested synthetic images on Windows-safe paths', () => fixture(({ bundle, add }) => {
  add('assets/img/Europe/Other Place/chart-1.webp');
  assert.deepEqual(auditBuildPrivacy(bundle), { files: 5, sourceFiles: 2 });
}));

for (const dir of ['unknown', 'assets/raw', 'assets/fonts', 'assets/img/allowed/../../misc']) {
  test('rejects unexpected directory, including when empty: ' + dir, () => fixture(({ bundle, directory }) => {
    directory(dir);
    assert.throws(() => auditBuildPrivacy(bundle), /unapproved browser bundle directory/);
  }));
}

for (const name of ['CON.png', 'aux.jpeg', 'NuL.webp', 'COM1.png', 'LPT9.jpg']) {
  test('rejects Windows reserved image filename: ' + name, { skip: process.platform === 'win32' }, () => fixture(({ bundle, add }) => {
    add('assets/img/' + name);
    assert.throws(() => auditBuildPrivacy(bundle), /nonportable Windows bundle filename/);
  }));
}

for (const name of ['PRN', 'com9', 'lPt1'] ) {
  test('rejects Windows reserved image directory: ' + name, { skip: process.platform === 'win32' }, () => fixture(({ bundle, directory }) => {
    directory('assets/img/' + name);
    assert.throws(() => auditBuildPrivacy(bundle), /nonportable Windows bundle filename/);
  }));
}

for (const name of ['notes. ', 'trailing.', 'broken:dir']) {
  test('rejects nonportable image directories: ' + name, { skip: process.platform === 'win32' }, () => fixture(({ bundle, directory }) => {
    directory('assets/img/' + name);
    assert.throws(() => auditBuildPrivacy(bundle), /nonportable Windows bundle filename/);
  }));
}

test('does not print rejected directory names or absolute paths', () => fixture(({ bundle, directory }) => {
  directory('PRIVATE-PERSON-FICTIONAL');
  assert.throws(() => auditBuildPrivacy(bundle), error => {
    assert.match(error.message, /DESKTOP BUILD PRIVACY: unapproved browser bundle directory/);
    assert.doesNotMatch(error.message, /PRIVATE-PERSON|vs-portable-artifacts/);
    return true;
  });
}));
