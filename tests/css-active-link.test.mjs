import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopStyles } from '../scripts/verify-bundled-css.mjs';

const STYLE = 'vs-desktop-app{height:100%}*{box-sizing:border-box}';

function withBundle(link, check) {
  const dir = mkdtempSync(join(tmpdir(), 'virgostars-active-css-'));
  try {
    writeFileSync(join(dir, 'styles-AB12.css'), STYLE);
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html><head>' + link + '</head><body><vs-desktop-app></vs-desktop-app></body></html>');
    check(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const link = attributes => '<link rel="stylesheet" href="styles-AB12.css" ' + attributes + '>';

test('ordinary active local desktop stylesheet remains accepted', () => {
  withBundle(link(''), dir => {
    assert.deepEqual(inspectDesktopStyles(dir), { stylesheets: 1, files: ['styles-AB12.css'] });
  });
});

test('boolean disabled stylesheet is rejected even though its CSS file exists', () => {
  for (const attributes of ['disabled', 'disabled="disabled"', 'DISABLED', 'disabled=disabled']) {
    withBundle(link(attributes), dir => {
      assert.throws(() => inspectDesktopStyles(dir), /Disabled stylesheet/);
    });
  }
});

test('alternate stylesheets do not satisfy the required active desktop CSS', () => {
  for (const rel of ['alternate stylesheet', 'stylesheet alternate', 'ALTERNATE STYLESHEET']) {
    withBundle('<link rel="' + rel + '" href="styles-AB12.css">', dir => {
      assert.throws(() => inspectDesktopStyles(dir), /Alternate stylesheet/);
    });
  }
});

test('non-CSS MIME type is rejected rather than treated as rendered stylesheet', () => {
  for (const type of ['text/plain', 'application/javascript', '']) {
    withBundle(link('type="' + type + '"'), dir => {
      assert.throws(() => inspectDesktopStyles(dir), /Non-CSS stylesheet MIME type/);
    });
  }
});

test('valid explicit CSS MIME type and media screen remain accepted', () => {
  withBundle(link('type="text/css" media="screen"'), dir => {
    assert.equal(inspectDesktopStyles(dir).stylesheets, 1);
  });
});

test('existing CSP guard still rejects deferred print/onload CSS', () => {
  withBundle(link('media="print" onload="this.media=\'all\'"'), dir => {
    assert.throws(() => inspectDesktopStyles(dir), /Inline stylesheet event handler/);
  });
});
