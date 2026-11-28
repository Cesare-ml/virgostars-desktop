import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoCssResourceFunctions} from '../scripts/verify-css-resource-functions.mjs';
import {inspectDesktopStyles} from '../scripts/verify-bundled-css.mjs';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const safe = ':root{color-scheme:light}*{box-sizing:border-box}vs-desktop-app{height:100%}';

test('accepts currently supported offline global CSS and gradients', () => {
  assert.equal(assertNoCssResourceFunctions(safe + 'body{background:linear-gradient(#111,#333)}'), true);
});
test('rejects local, network, and embedded CSS url fetches', () => {
  for (const value of ['url(./missing.png)', 'URL("https://example.invalid/pixel")',
    "url('/assets/img/fictional.png')", 'url(data:image/png;base64,abcd)',
    'url(blob:xyz)', 'url(file:///private/example)', 'url(#cursor)']) {
    assert.throws(() => assertNoCssResourceFunctions(safe + 'a{background:' + value + '}'), /resource-loading functions/, value);
  }
});
test('blocks image-set family even when resources are only quoted', () => {
  for (const value of ['image-set("https://example.invalid/x.png" 1x)',
    '-webkit-image-set("./x.png" 1x)', 'image("./x.png")']) {
    assert.throws(() => assertNoCssResourceFunctions('p{background:' + value + '}'), /resource-loading functions/);
  }
});
test('rejects escaped identifiers and CSS trivia before the function bracket', () => {
  for (const value of ['u\\72l("x")', '\\75\\72\\6c("x")',
    'u\\000072 l("x")', 'url /* comment */ ("x")', 'ImAgE-SeT ("x")']) {
    assert.throws(() => assertNoCssResourceFunctions('p{background:' + value + '}'), /resource-loading functions/, value);
  }
});
test('does not mistake CSS comments or quoted strings for active loads', () => {
  const text = '/* url(https://not-loaded.invalid) */ p::after{content:"url(https://also-not-loaded.invalid)"}';
  assert.equal(assertNoCssResourceFunctions(text + safe), true);
  assert.equal(assertNoCssResourceFunctions("p::after{content:'image-set(\\'not-a-request\\')'}"), true);
});
test('accepts similarly named identifiers and CSS variables', () => {
  assert.equal(assertNoCssResourceFunctions('p{--my-url:42;content:myurl(foo);color:var(--url)}'), true);
});
test('fails closed on malformed comments, strings, and identifier escapes', () => {
  for (const value of ['/* url(fake)', 'p{content:"unterminated}', 'p{content:"bad\\',
    'p{background:ur\\\nl(x)}', 'p{background:u\\']) {
    assert.throws(() => assertNoCssResourceFunctions(value), /DESKTOP CSS RESOURCES:/);
  }
  assert.throws(() => assertNoCssResourceFunctions(null), /Invalid CSS stylesheet/);
});


function withSyntheticStylesheet(css, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-resources-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="styles-LOCAL123.css"></head>' +
      '<body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir, 'styles-LOCAL123.css'), css);
    callback(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}
test('actual bundled CSS verification accepts self-contained synthetic style', () => {
  withSyntheticStylesheet(safe, dir => assert.equal(inspectDesktopStyles(dir).stylesheets, 1));
});
test('actual bundled CSS verification rejects active external and local resource references', () => {
  for (const value of ['url(https://example.invalid/tracker.png)', 'url(./missing.woff2)',
    'image-set("https://example.invalid/2x.png" 2x)']) {
    withSyntheticStylesheet(safe + 'p{background:' + value + '}', dir =>
      assert.throws(() => inspectDesktopStyles(dir), /DESKTOP CSS RESOURCES:/));
  }
});
test('actual bundled CSS verification still rejects un-inlined CSS imports', () => {
  withSyntheticStylesheet('@import "./missing.css";' + safe, dir =>
    assert.throws(() => inspectDesktopStyles(dir), /CSS @import must be inlined/));
});


test('rejects raw form feed in CSS strings and escaped identifiers', () => {
  for (const css of [
    'p{content:"prefix\furl(https://example.invalid/x.png)"}',
    'p{background:u\\\frl("./local.png")}',
  ]) {
    assert.throws(() => assertNoCssResourceFunctions(css), /DESKTOP CSS RESOURCES:/);
  }
});

test('keeps standard form feed whitespace and escaped CSS string continuation', () => {
  assert.equal(assertNoCssResourceFunctions('p{\f color:red}'), true);
  assert.equal(assertNoCssResourceFunctions('p{content:"prefix\\\fsuffix"}'), true);
  assert.equal(assertNoCssResourceFunctions('p{content:"prefix\\\r\nsuffix"}'), true);
});
