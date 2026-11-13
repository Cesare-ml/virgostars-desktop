import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopStyles } from '../scripts/verify-bundled-css.mjs';

const css = 'vs-desktop-app{height:100%}*{box-sizing:border-box}';
function withBundle(text, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-bundle-url-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="styles-CHECK.css"></head>' +
      '<body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir, 'styles-CHECK.css'), text);
    mkdirSync(join(dir, 'media'));
    writeFileSync(join(dir, 'media', 'synthetic.woff2'), 'synthetic');
    callback(dir);
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
test('actual CSS artifact gate accepts complete stylesheet', () => {
  withBundle(css, dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1));
});
test('actual CSS artifact gate accepts packaged media files', () => {
  withBundle(css+'@font-face{src:url(media/synthetic.woff2)}',
    dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1));
});
test('actual CSS artifact gate refuses remote dependencies', () => {
  withBundle(css+'p{background:url(https://example.invalid/image.png)}',
    dir => assert.throws(() => inspectDesktopStyles(dir), /Nonlocal or unapproved CSS/));
});
test('actual CSS artifact gate refuses missing local dependencies', () => {
  withBundle(css+'@font-face{src:url(media/missing.woff2)}',
    dir => assert.throws(() => inspectDesktopStyles(dir), /Missing or unsafe CSS/));
});
