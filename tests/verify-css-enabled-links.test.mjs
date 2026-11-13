import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopStyles } from '../scripts/verify-bundled-css.mjs';

// No network, chart data or production assets: only a synthetic build directory.
const CSS = ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}';
function withSyntheticBundle(linkTag, verify) {
  const dir = mkdtempSync(join(tmpdir(), 'virgostars-active-css-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head>' + linkTag + '</head><body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir, 'styles-LOCAL123.css'), CSS);
    return verify(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
const link = (attrs = '') => '<link rel="stylesheet" href="styles-LOCAL123.css" ' + attrs + '>';

test('ordinary local CSS remains accepted', () => withSyntheticBundle(link(), dir => {
  assert.deepEqual(inspectDesktopStyles(dir), {stylesheets: 1, files: ['styles-LOCAL123.css']});
}));
test('valid explicit text/css type and screen media remain accepted', () => withSyntheticBundle(
  link('type="text/css" media="screen"'), dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('HTML boolean disabled stylesheet is rejected even with a real CSS file', () => withSyntheticBundle(
  link('disabled'), dir => assert.throws(() => inspectDesktopStyles(dir), /Disabled stylesheet/)
));
test('HTML disabled attribute with a value is rejected', () => withSyntheticBundle(
  link('disabled="disabled"'), dir => assert.throws(() => inspectDesktopStyles(dir), /Disabled stylesheet/)
));
test('HTML alternate stylesheet is rejected because it is not active by default', () => withSyntheticBundle(
  '<link rel="alternate stylesheet" href="styles-LOCAL123.css">',
  dir => assert.throws(() => inspectDesktopStyles(dir), /Alternate stylesheet/)
));
test('alternate token order must not affect rejection', () => withSyntheticBundle(
  '<link rel="stylesheet alternate" href="styles-LOCAL123.css">',
  dir => assert.throws(() => inspectDesktopStyles(dir), /Alternate stylesheet/)
));
test('incorrect CSS MIME type cannot pass as an active linked style', () => withSyntheticBundle(
  link('type="text/plain"'), dir => assert.throws(() => inspectDesktopStyles(dir), /Non-CSS stylesheet MIME/)
));
test('an unrelated data-disabled attribute is not the HTML disabled attribute', () => withSyntheticBundle(
  link('data-disabled="true"'), dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('inert quoted text containing the word disabled is not an HTML disabled attribute', () => withSyntheticBundle(
  link('title="temporarily disabled"'), dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('existing rejection of print-only stylesheet remains intact', () => withSyntheticBundle(
  link('media="print"'), dir => assert.throws(() => inspectDesktopStyles(dir), /Deferred or print-only stylesheet/)
));
test('quoted inert text containing disabled= does not disable a stylesheet', () => withSyntheticBundle(
  link('title="documentation disabled=maybe"'), dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('quoted inert text containing onload= is not an inline event handler', () => withSyntheticBundle(
  link('title="documentation onload=example"'), dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('a fake rel attribute inside a quoted title does not supply an active CSS link', () => withSyntheticBundle(
  '<link title="sample rel=stylesheet" href="styles-LOCAL123.css">',
  dir => assert.throws(() => inspectDesktopStyles(dir), /no linked stylesheet/)
));
test('a fake href inside a quoted title cannot substitute for a missing file reference', () => withSyntheticBundle(
  '<link rel="stylesheet" title="sample href=styles-LOCAL123.css">',
  dir => assert.throws(() => inspectDesktopStyles(dir), /Unexpected or nonlocal stylesheet reference/)
));
test('explicit event handlers still fail, even with inert quoted examples', () => withSyntheticBundle(
  link('title="docs onload=example" onload="alert(1)"'),
  dir => assert.throws(() => inspectDesktopStyles(dir), /Inline stylesheet event handler/)
));
test('HTML quoted greater-than signs remain ordinary attribute text', () => withSyntheticBundle(
  '<link title="a > b" rel="stylesheet" href="styles-LOCAL123.css">',
  dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1)
));
test('duplicate active-link attributes fail closed', () => withSyntheticBundle(
  '<link rel="stylesheet" href="styles-LOCAL123.css" href="remote.css">',
  dir => assert.throws(() => inspectDesktopStyles(dir), /Duplicate stylesheet link attribute/)
));
