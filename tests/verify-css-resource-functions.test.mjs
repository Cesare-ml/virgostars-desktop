import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNoCssResourceFunctions} from '../scripts/verify-css-resource-functions.mjs';

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
