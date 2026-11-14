import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  MAX_BUNDLED_CSS_BYTES, MAX_BUNDLED_HTML_BYTES, readBoundedUiText,
} from '../scripts/read-bounded-ui-text.mjs';
import {inspectDesktopStyles} from '../scripts/verify-bundled-css.mjs';

const CSS = ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}';
const LINK = '<link rel="stylesheet" href="styles-TEST.css">';
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-bounded-'));
  try {
    const html = join(dir, 'index.html');
    const css = join(dir, 'styles-TEST.css');
    writeFileSync(html, '<!doctype html><head>' + LINK + '</head><vs-desktop-app></vs-desktop-app>');
    writeFileSync(css, CSS);
    run({dir, html, css});
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
}

test('fixed HTML/CSS limits remain bounded and CSS larger than HTML is permitted', () => {
  assert.equal(MAX_BUNDLED_HTML_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_BUNDLED_CSS_BYTES, 32 * 1024 * 1024);
  assert.ok(MAX_BUNDLED_CSS_BYTES > MAX_BUNDLED_HTML_BYTES);
});

test('valid UTF-8 HTML/CSS works through the actual offline stylesheet gate', () => fixture(({dir}) => {
  assert.deepEqual(inspectDesktopStyles(dir), {stylesheets:1, files:['styles-TEST.css']});
}));

test('UTF-8 multibyte characters are preserved without text truncation', () => fixture(({html}) => {
  writeFileSync(html, '<title>città ☼</title>');
  assert.equal(readBoundedUiText(html, 'HTML'), '<title>città ☼</title>');
}));

test('oversized sparse HTML is refused before it is read', () => fixture(({dir, html}) => {
  truncateSync(html, MAX_BUNDLED_HTML_BYTES + 1);
  assert.throws(() => inspectDesktopStyles(dir), /HTML exceeds byte limit/);
}));

test('oversized sparse linked CSS is refused before it is read', () => fixture(({dir, css}) => {
  truncateSync(css, MAX_BUNDLED_CSS_BYTES + 1);
  assert.throws(() => inspectDesktopStyles(dir), /CSS exceeds byte limit/);
}));

test('symlinked HTML or CSS entrypoints fail closed where symlinks are supported', t => fixture(({dir, html, css}) => {
  const target = join(dir, 'target.txt');
  writeFileSync(target, 'synthetic');
  let linked;
  try {
    linked = join(dir, 'link.txt');
    symlinkSync(target, linked);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
      t.skip('filesystem does not permit unprivileged symlinks');
      return;
    }
    throw error;
  }
  assert.throws(() => readBoundedUiText(linked, 'HTML'), /HTML not a regular file/);
  assert.throws(() => readBoundedUiText(linked, 'CSS'), /CSS not a regular file/);
  // Existing CSS gate still refuses a missing/nonregular linked stylesheet.
  assert.throws(() => readBoundedUiText(join(dir,'missing.html'), 'HTML'), /HTML missing or inaccessible/);
}));

test('malformed UTF-8 is refused for both HTML and CSS', () => fixture(({dir, html, css}) => {
  writeFileSync(html, Buffer.from([0xc3, 0x28]));
  assert.throws(() => readBoundedUiText(html, 'HTML'), /HTML invalid UTF-8/);
  writeFileSync(html, '<head>' + LINK + '</head>');
  writeFileSync(css, Buffer.from([0xc3, 0x28]));
  assert.throws(() => inspectDesktopStyles(dir), /CSS invalid UTF-8/);
}));

test('invalid type and missing file fail without leaking filesystem paths', () => fixture(({dir}) => {
  assert.throws(() => readBoundedUiText(join(dir, 'none.css'), 'CSV'), error => {
    assert.equal(error.message, 'DESKTOP CSS BUNDLE: input unsupported text kind');
    return true;
  });
  assert.throws(() => readBoundedUiText(join(dir, 'none.css'), 'CSS'), error => {
    assert.equal(error.message, 'DESKTOP CSS BUNDLE: CSS missing or inaccessible');
    assert.equal(error.message.includes(dir), false);
    return true;
  });
}));
