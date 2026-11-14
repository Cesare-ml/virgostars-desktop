/** Regression coverage of the combined bounded-file and offline-resource gates. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectDesktopStyles} from '../scripts/verify-bundled-css.mjs';

const BASE = ':root{color-scheme:light}*{box-sizing:border-box}vs-desktop-app{display:block}';
function fixture(css, inspect) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-combined-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="styles-TEST.css"></head>' +
      '<body><vs-desktop-app></vs-desktop-app></body></html>');
    writeFileSync(join(dir, 'styles-TEST.css'), css);
    inspect(dir);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

test('combined verifier accepts inert URL mentions and CSS gradients', () => {
  fixture(BASE + '/* url(https://example.invalid/not-loaded) */' +
    'p::after{content:"image-set(https://not-loaded.invalid/x.png)"}' +
    'p{background:linear-gradient(red,blue)}', dir => {
      assert.deepEqual(inspectDesktopStyles(dir), {stylesheets: 1, files: ['styles-TEST.css']});
    });
});

test('combined verifier blocks escaped url and image-set function identifiers', () => {
  for (const css of [
    String.raw`p{background:u\72l("https://example.invalid/x.png")}`,
    String.raw`p{background:\75\72\6c("./missing.png")}`,
    'p{background:image-set /* comment */ ("https://example.invalid/x.png" 1x)}',
  ]) {
    fixture(BASE + css, dir => {
      assert.throws(() => inspectDesktopStyles(dir), /DESKTOP CSS RESOURCES:/);
    });
  }
});

test('combined verifier rejects imports ahead of resource functions', () => {
  fixture('@import "https://example.invalid/style.css";' +
    BASE + 'p{background:url(https://example.invalid/a.png)}', dir => {
    assert.throws(() => inspectDesktopStyles(dir), /CSS @import must be inlined/);
  });
});

test('combined verifier rejects malformed UTF-8 before scanning resource references', () => {
  fixture(Buffer.concat([Buffer.from(BASE + 'p{background:url('), Buffer.from([0xc3, 0x28])]), dir => {
    assert.throws(() => inspectDesktopStyles(dir), /CSS invalid UTF-8/);
  });
});

test('combined verifier rejects binary control bytes ahead of resource functions', () => {
  fixture(BASE + '\x1b' + 'p{background:url(https://example.invalid/x.png)}', dir => {
    assert.throws(() => inspectDesktopStyles(dir), /CSS contains forbidden control byte/);
  });
});

test('combined verifier blocks active CSS resource function across 64 KiB chunk boundary', () => {
  const paddingLength = 64 * 1024 - Buffer.byteLength(BASE) - 4;
  assert.ok(paddingLength > 0);
  fixture(BASE + '/*' + ' '.repeat(paddingLength) + '*/' +
    'p{background:url(https://example.invalid/x.png)}', dir => {
    assert.throws(() => inspectDesktopStyles(dir), /DESKTOP CSS RESOURCES:/);
  });
});


test('combined verifier redacts linked CSS file path when file is missing', () => {
  fixture(BASE, dir => {
    rmSync(join(dir, 'styles-TEST.css'));
    assert.throws(() => inspectDesktopStyles(dir), error => {
      assert.match(error.message, /Local global stylesheet missing or not a regular file/);
      assert.equal(error.message.includes(dir), false);
      return true;
    });
  });
});

test('combined verifier refuses symlinked linked CSS without revealing paths', t => {
  fixture(BASE, dir => {
    const css = join(dir, 'styles-TEST.css');
    const target = join(dir, 'synthetic.css');
    writeFileSync(target, BASE);
    rmSync(css);
    try { symlinkSync(target, css); }
    catch (error) {
      if (['EPERM', 'EACCES', 'ENOSYS'].includes(error?.code)) {
        t.skip('unprivileged symlinks unavailable');
        return;
      }
      throw error;
    }
    assert.throws(() => inspectDesktopStyles(dir), error => {
      assert.match(error.message, /Local global stylesheet missing or not a regular file/);
      assert.equal(error.message.includes(dir), false);
      return true;
    });
  });
});
