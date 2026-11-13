import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopScripts } from '../scripts/verify-bundled-scripts.mjs';

const MAIN = '<script src="main-ABC123.js" type="module"></script>';
function withHtml(html, verify) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-script-structure-'));
  try {
    writeFileSync(join(dir, 'main-ABC123.js'), '/* synthetic module */');
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body>' + html + '</body></html>');
    verify(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a commented script cannot substitute for the real Angular main module', () => {
  withHtml('<!-- ' + MAIN + ' -->', dir => assert.throws(() => inspectDesktopScripts(dir), /Missing or unclosed/));
});

test('commented script is ignored when exactly one real main module exists', () => {
  withHtml('<!-- ' + MAIN + ' -->' + MAIN, dir => assert.deepEqual(inspectDesktopScripts(dir), { scripts: 1, files: ['main-ABC123.js'] }));
});

test('unterminated HTML comment containing script does not count as a main module', () => {
  withHtml('<!-- ' + MAIN, dir => assert.throws(() => inspectDesktopScripts(dir), /Unterminated HTML comment/));
});

test('scripts inside inert template and noscript containers are rejected', () => {
  for (const container of ['template', 'noscript']) {
    withHtml('<' + container + '>' + MAIN + '</' + container + '>', dir =>
      assert.throws(() => inspectDesktopScripts(dir), /Unexpected inert HTML container/, container));
  }
});

test('a greater-than sign in a quoted script attribute is valid HTML', () => {
  withHtml('<script title="a > b" src="main-ABC123.js" type="module"></script>', dir =>
    assert.equal(inspectDesktopScripts(dir).scripts, 1));
});

test('inert onload and src text in a quoted title does not create attributes', () => {
  withHtml('<script title="documentation onload=example src=vendor.js" src="main-ABC123.js" type="module"></script>', dir =>
    assert.equal(inspectDesktopScripts(dir).scripts, 1));
});

test('fake src inside a quoted title cannot satisfy required script src', () => {
  withHtml('<script title="src=main-ABC123.js" type="module"></script>', dir =>
    assert.throws(() => inspectDesktopScripts(dir), /exactly one src/));
});

test('actual inline handlers still fail even if quoted metadata contains fake handlers', () => {
  withHtml('<script title="onload=example" onerror="alert(1)" src="main-ABC123.js" type="module"></script>', dir =>
    assert.throws(() => inspectDesktopScripts(dir), /event handler/));
});

test('duplicate src and type attributes remain blocked with existing error contracts', () => {
  withHtml('<script src="main-ABC123.js" src="other.js" type="module"></script>', dir =>
    assert.throws(() => inspectDesktopScripts(dir), /exactly one src/));
  withHtml('<script src="main-ABC123.js" type="module" type="text/javascript"></script>', dir =>
    assert.throws(() => inspectDesktopScripts(dir), /type="module"/));
});

test('unclosed quoted script attribute is rejected before reading script references', () => {
  withHtml('<script src="main-ABC123.js type="module"></script>', dir =>
    assert.throws(() => inspectDesktopScripts(dir), /Malformed|Unterminated|exactly one src|type="module"/));
});

test('script-looking text in title and style raw-text nodes is inert', () => {
  withHtml('<title>' + MAIN + '</title><style>/* ' + MAIN + ' */</style>' + MAIN, dir =>
    assert.equal(inspectDesktopScripts(dir).scripts, 1));
});

test('unquoted valid src and type attributes remain accepted', () => {
  withHtml('<script src=main-ABC123.js type=module></script>', dir =>
    assert.equal(inspectDesktopScripts(dir).scripts, 1));
});
