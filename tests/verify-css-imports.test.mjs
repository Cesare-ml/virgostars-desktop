import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoCssImports } from '../scripts/verify-css-imports.mjs';

const styles = ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}';

test('accepts ordinary self-contained global CSS', () => {
  assert.equal(assertNoCssImports(styles), true);
});
test('rejects local CSS @import even when target is relative', () => {
  assert.throws(() => assertNoCssImports('@import "./extra.css";' + styles), /CSS @import must be inlined/);
});
test('rejects external HTTPS CSS import', () => {
  assert.throws(() => assertNoCssImports('@import url(https://example.invalid/styles.css);' + styles), /CSS @import must be inlined/);
});
test('rejects mixed case and whitespace after import', () => {
  assert.throws(() => assertNoCssImports('@ImPoRt\nurl("./extra.css");' + styles), /CSS @import must be inlined/);
});
test('rejects escaped CSS import identifier', () => {
  for (const x of ['@\\69mport "./extra.css";', '@im\\70 ort "./extra.css";', '@\\000069mport "./extra.css";']) {
    assert.throws(() => assertNoCssImports(x + styles), /CSS @import must be inlined/, x);
  }
});
test('ignores @import-looking content inside a block comment', () => {
  assert.equal(assertNoCssImports('/* @import url(https://example.invalid/a.css); */' + styles), true);
});
test('ignores quoted metadata and content strings mentioning @import', () => {
  assert.equal(assertNoCssImports('p::before{content:"example @import url(foo.css)"}' + styles), true);
  assert.equal(assertNoCssImports("a{content:'@import' }" + styles), true);
});
test('ignores an inert @import string inside a data URL', () => {
  assert.equal(assertNoCssImports('p{background:url(data:image/svg+xml,@import)}' + styles), true);
});
test('does not confuse @important or other at-rules with @import', () => {
  assert.equal(assertNoCssImports('@important foo;@media screen {body{height:100%}}' + styles), true);
});
test('rejects a real import after inert comment and quoted fake', () => {
  assert.throws(() => assertNoCssImports('/* @import "fake" */ a{content:"@import"}@import "real.css";' + styles), /CSS @import must be inlined/);
});
test('fails closed for unterminated comments and quoted strings', () => {
  assert.throws(() => assertNoCssImports(styles + '/* @import "fake"'), /Unterminated CSS comment/);
  assert.throws(() => assertNoCssImports(styles + 'p{content:"broken}'), /Unterminated CSS string/);
});
test('fails closed for invalid CSS input and a broken CSS URL', () => {
  assert.throws(() => assertNoCssImports(null), /Invalid CSS stylesheet/);
  assert.throws(() => assertNoCssImports(styles + 'a{background:url(foo'), /Unterminated CSS url/);
});

test('rejects raw LF, CR and form feed inside CSS quoted strings', () => {
  for (const newline of ['\n', '\r', '\f']) {
    assert.throws(
      () => assertNoCssImports('p{content:"prefix' + newline + '@import \'./missing.css\'"}' + styles),
      /Unterminated CSS string/,
    );
  }
});

test('rejects escaped CSS identifier form feed rather than ignoring it', () => {
  assert.throws(() => assertNoCssImports('p{content:x} @im\\\fport "./missing.css";'), /Invalid CSS escape/);
});

test('preserves escaped CRLF and form feed CSS string continuations', () => {
  assert.equal(assertNoCssImports('p{content:"prefix\\\r\nsuffix"}' + styles), true);
  assert.equal(assertNoCssImports('p{content:"prefix\\\fsuffix"}' + styles), true);
  assert.equal(assertNoCssImports('p{\f color:blue}' + styles), true);
});
