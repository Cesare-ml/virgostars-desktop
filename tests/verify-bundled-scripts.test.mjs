import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDesktopScripts } from '../scripts/verify-bundled-scripts.mjs';

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-js-gate-'));
  const htmlFile = join(dir, 'index.html');
  const setHtml = scripts => writeFileSync(htmlFile, '<html><body><vs-desktop-app></vs-desktop-app>' + scripts + '</body></html>');
  const main = '<script src="main-ABC123.js" type="module"></script>';
  try {
    writeFileSync(join(dir, 'main-ABC123.js'), '/* fictional Angular module */');
    setHtml(main);
    run({dir, setHtml, main});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('accepts one local Angular main module', () => fixture(f => {
  assert.deepEqual(inspectDesktopScripts(f.dir), {scripts: 1, files: ['main-ABC123.js']});
}));
test('accepts one local polyfills module alongside main', () => fixture(f => {
  writeFileSync(join(f.dir, 'polyfills-A9.js'), '/* fixture */');
  f.setHtml('<script src="./polyfills-A9.js" type="module"></script>' + f.main);
  assert.equal(inspectDesktopScripts(f.dir).scripts, 2);
}));
test('fails closed when the main script is missing on disk', () => fixture(f => {
  rmSync(join(f.dir, 'main-ABC123.js'));
  assert.throws(() => inspectDesktopScripts(f.dir), /script missing/);
}));
test('fails closed when a script is a symlink', () => fixture(f => {
  writeFileSync(join(f.dir, 'other.js'), '/* fixture */');
  rmSync(join(f.dir, 'main-ABC123.js'));
  symlinkSync(join(f.dir, 'other.js'), join(f.dir, 'main-ABC123.js'));
  assert.throws(() => inspectDesktopScripts(f.dir), /script missing or not a regular file/);
}));
test('rejects external URLs, data URLs and path traversal', () => fixture(f => {
  for (const src of ['https://example.invalid/a.js', '//example.invalid/a.js', 'data:text/javascript,alert(1)', '../main-ABC123.js', '/main-ABC123.js']) {
    f.setHtml('<script src="' + src + '" type="module"></script>');
    assert.throws(() => inspectDesktopScripts(f.dir), /nonlocal desktop script/, src);
  }
}));
test('rejects inline executable scripts, including an extra script', () => fixture(f => {
  f.setHtml(f.main + '<script>alert(1)</script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Inline executable scripts/);
}));
test('rejects inline handlers on local external scripts', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js" type="module" onerror="alert(1)"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /event handler/);
}));
test('rejects duplicate src attributes to avoid ambiguous HTML parsing', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js" src="https://example.invalid/a.js" type="module"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /exactly one src/);
}));
test('rejects missing module type and duplicate type attributes', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /type="module"/);
  f.setHtml('<script src="main-ABC123.js" type="module" type="text/javascript"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /type="module"/);
}));
test('rejects an unclosed script element', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js" type="module">');
  assert.throws(() => inspectDesktopScripts(f.dir), /Missing or unclosed/);
}));
test('rejects a bundle with only polyfills and no main', () => fixture(f => {
  writeFileSync(join(f.dir, 'polyfills-A9.js'), '/* fixture */');
  f.setHtml('<script src="polyfills-A9.js" type="module"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Exactly one Angular main/);
}));
test('rejects duplicate main entrypoints, even when both files exist', () => fixture(f => {
  writeFileSync(join(f.dir, 'main-OTHER.js'), '/* fixture */');
  f.setHtml(f.main + '<script src="main-OTHER.js" type="module"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Exactly one Angular main/);
}));
test('rejects duplicate script tags with the same source', () => fixture(f => {
  f.setHtml(f.main + f.main);
  assert.throws(() => inspectDesktopScripts(f.dir), /Duplicate desktop script/);
}));
test('rejects extra unapproved scripts even if local', () => fixture(f => {
  f.setHtml(f.main + '<script src="vendor-ABC123.js" type="module"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /nonlocal desktop script/);
}));

test('ignores a fake Angular main module contained only in an HTML comment', () => fixture(f => {
  f.setHtml('<!-- ' + f.main + ' -->');
  assert.throws(() => inspectDesktopScripts(f.dir), /Missing or unclosed/);
}));
test('commented-out script does not count as a duplicate of a real one', () => fixture(f => {
  f.setHtml('<!-- ' + f.main + ' -->' + f.main);
  assert.equal(inspectDesktopScripts(f.dir).scripts, 1);
}));
test('rejects a main script present only in an inert template', () => fixture(f => {
  f.setHtml('<template>' + f.main + '</template>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Missing or unclosed/);
}));
test('rejects a main script present only in a textarea', () => fixture(f => {
  f.setHtml('<textarea>' + f.main + '</textarea>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Missing or unclosed/);
}));
test('ignores script-shaped text in another HTML element quoted attribute', () => fixture(f => {
  f.setHtml('<div title=\'' + f.main + '\'></div>');
  assert.throws(() => inspectDesktopScripts(f.dir), /Missing or unclosed/);
}));
test('harmless quoted metadata containing onload does not count as an event handler', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js" type="module" title="docs onload=example"></script>');
  assert.equal(inspectDesktopScripts(f.dir).scripts, 1);
}));
test('actual event handlers still cannot execute under the desktop CSP', () => fixture(f => {
  f.setHtml('<script src="main-ABC123.js" type="module" onload="alert(1)"></script>');
  assert.throws(() => inspectDesktopScripts(f.dir), /event handler/);
}));
test('fails closed on unfinished HTML comments', () => fixture(f => {
  f.setHtml('<!-- ' + f.main);
  assert.throws(() => inspectDesktopScripts(f.dir), /Unterminated HTML comment/);
}));
test('quoted greater-than characters in unrelated elements do not hide real scripts', () => fixture(f => {
  f.setHtml('<div title="1 > 0">test</div>' + f.main);
  assert.equal(inspectDesktopScripts(f.dir).scripts, 1);
}));
