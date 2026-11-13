import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopStyles } from '../scripts/verify-bundled-css.mjs';

const CSS = ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}';

function withBundle(css, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-import-bundle-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="styles-LOCAL123.css"></head>' +
      '<body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir, 'styles-LOCAL123.css'), css);
    callback(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('real linked CSS with no import passes the existing desktop style gate', () => {
  withBundle(CSS, dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1));
});

test('real linked CSS with an external @import fails before packaging', () => {
  withBundle('@import url("https://example.invalid/theme.css");' + CSS,
    dir => assert.throws(() => inspectDesktopStyles(dir), /CSS @import must be inlined/));
});

test('local CSS @import is also rejected because it is not in the output manifest', () => {
  withBundle('@import "./missing.css";' + CSS,
    dir => assert.throws(() => inspectDesktopStyles(dir), /CSS @import must be inlined/));
});

test('fake @import inside a comment does not break valid offline CSS', () => {
  withBundle('/* @import "./example.css"; */' + CSS,
    dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1));
});
