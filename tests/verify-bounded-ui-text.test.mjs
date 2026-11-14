import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  MAX_BUNDLED_CSS_BYTES, MAX_BUNDLED_HTML_BYTES, hasStableReadMetadata, readBoundedUiText,
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

test('same-size rewrite with restored mtime fails when ctime changed', () => {
  const before = {dev: 1, ino: 5, size: 128, mtimeMs: 1234, ctimeMs: 1250};
  assert.equal(hasStableReadMetadata(before, {...before}, 128), true);
  assert.equal(hasStableReadMetadata(before, {...before, ctimeMs: 1300}, 128), false);
});

test('changed descriptor identity, size, mtime and short reads all fail closed', () => {
  const before = {dev: 1, ino: 5, size: 128, mtimeMs: 1234, ctimeMs: 1250};
  for (const after of [
    {...before, dev: 2},
    {...before, ino: 6},
    {...before, size: 129},
    {...before, mtimeMs: 1235},
    {...before, ctimeMs: NaN},
  ]) {
    assert.equal(hasStableReadMetadata(before, after, 128), false);
  }
  assert.equal(hasStableReadMetadata(before, {...before}, 127), false);
  assert.equal(hasStableReadMetadata(before, {...before}, -1), false);
  assert.equal(hasStableReadMetadata(before, null, 128), false);
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

test('rejects embedded NUL bytes in otherwise valid Angular HTML', () => fixture(({dir, html}) => {
  writeFileSync(html, '<!doctype html><head>' + LINK + '</head>\0<vs-desktop-app></vs-desktop-app>');
  assert.throws(() => inspectDesktopStyles(dir), /HTML contains NUL byte/);
}));

test('rejects embedded NUL bytes in otherwise valid Angular CSS', () => fixture(({dir, css}) => {
  writeFileSync(css, CSS + '\0');
  assert.throws(() => inspectDesktopStyles(dir), /CSS contains NUL byte/);
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

test('accepts exactly the HTML byte limit without reading beyond EOF', () => fixture(({html}) => {
  writeFileSync(html, Buffer.alloc(MAX_BUNDLED_HTML_BYTES, 0x61));
  const contents = readBoundedUiText(html, 'HTML');
  assert.equal(contents.length, MAX_BUNDLED_HTML_BYTES);
  assert.equal(contents.slice(0, 4), 'aaaa');
}));

test('rejects a NUL byte immediately after the 64 KiB read boundary', () => fixture(({html}) => {
  writeFileSync(html, Buffer.concat([Buffer.alloc(64 * 1024, 0x61), Buffer.from([0])]));
  assert.throws(() => readBoundedUiText(html, 'HTML'), /HTML contains NUL byte/);
}));

test('preserves UTF-8 code points split between read chunks', () => fixture(({html}) => {
  writeFileSync(html, Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x61), Buffer.from('☼')]));
  const contents = readBoundedUiText(html, 'HTML');
  assert.equal(contents.length, 64 * 1024);
  assert.equal(contents.slice(-2), 'a☼');
}));

test('rejects invalid UTF-8 split between read chunks', () => fixture(({html}) => {
  writeFileSync(html, Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x61), Buffer.from([0xc3, 0x28])]));
  assert.throws(() => readBoundedUiText(html, 'HTML'), /HTML invalid UTF-8/);
}));


test('HTML and CSS standard ASCII whitespace remain accepted', () => fixture(({dir, html, css}) => {
  writeFileSync(html, '<head>\t\r\n\f' + LINK + '</head><vs-desktop-app></vs-desktop-app>');
  writeFileSync(css, CSS + '\t\r\n\f');
  assert.equal(inspectDesktopStyles(dir).stylesheets, 1);
}));

test('rejects embedded escape control in otherwise valid Angular HTML', () => fixture(({dir, html}) => {
  writeFileSync(html, '<head>' + LINK + '</head>\x1b<vs-desktop-app></vs-desktop-app>');
  assert.throws(() => inspectDesktopStyles(dir), /HTML contains forbidden control byte/);
}));

test('rejects DEL and vertical tab in linked Angular CSS', () => fixture(({dir, css}) => {
  for (const invalid of ['\x7f', '\x0b']) {
    writeFileSync(css, CSS + invalid);
    assert.throws(() => inspectDesktopStyles(dir), /CSS contains forbidden control byte/);
  }
}));

test('rejects non-NUL control byte at the start of the second read chunk', () => fixture(({html}) => {
  writeFileSync(html, Buffer.concat([Buffer.alloc(64 * 1024, 0x61), Buffer.from([0x1b])]));
  assert.throws(() => readBoundedUiText(html, 'HTML'), /HTML contains forbidden control byte/);
}));
