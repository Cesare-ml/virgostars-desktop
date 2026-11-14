import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDesktopBaseHref } from '../scripts/verify-document-base.mjs';
import { readFileSync } from 'node:fs';

const html = base => '<!doctype html><html lang="it"><head><meta charset="utf-8">' + base +
  '<link rel="stylesheet" href="styles-TEST.css"></head><body><vs-desktop-app></vs-desktop-app><script src="main-TEST.js"></script></body></html>';

for (const base of ['<base href="/">', "<BASE HREF='/'>", '<base  href = "/" />']) {
  test('accepts exactly one canonical embedded-root base: ' + base, () => {
    assert.equal(verifyDesktopBaseHref(html(base)), true);
  });
}

test('rejects missing base', () => {
  assert.throws(() => verifyDesktopBaseHref(html('')), /DESKTOP BASE HREF/);
});

test('rejects duplicate base tags even when the first is correct', () => {
  assert.throws(() => verifyDesktopBaseHref(html('<base href="/"><base href="https://example.invalid/">')), /DESKTOP BASE HREF/);
});

test('rejects remote, protocol-relative, different-root and relative bases', () => {
  for (const value of ['https://example.invalid/', '//example.invalid/', '/assets/', './', '../', 'file:///tmp/']) {
    assert.throws(() => verifyDesktopBaseHref(html('<base href="' + value + '">')), /DESKTOP BASE HREF/, value);
  }
});

test('rejects base href with unapproved attributes or handlers', () => {
  for (const tag of ['<base href="/" target="_blank">', '<base href="/" onload="alert(1)">', '<base href=/>']) {
    assert.throws(() => verifyDesktopBaseHref(html(tag)), /DESKTOP BASE HREF/, tag);
  }
});

test('rejects base placed after a resource link', () => {
  const misplaced = html('<link rel="stylesheet" href="styles-TEST.css"><base href="/">');
  assert.throws(() => verifyDesktopBaseHref(misplaced), /DESKTOP BASE HREF/);
});

test('rejects base outside head or malformed head', () => {
  assert.throws(() => verifyDesktopBaseHref('<base href="/"><head></head><body></body>'), /DESKTOP BASE HREF/);
  assert.throws(() => verifyDesktopBaseHref('<head></head><body><base href="/"></body>'), /DESKTOP BASE HREF/);
});

test('does not expose input in errors', () => {
  const secret = 'https://secrets.example.invalid/path';
  assert.throws(() => verifyDesktopBaseHref(html('<base href="' + secret + '">')),
    error => !error.message.includes(secret) && /DESKTOP BASE HREF/.test(error.message));
});

test('ignores inert base in a closed HTML comment rather than treating it as active', () => {
  assert.throws(() => verifyDesktopBaseHref(html('<!-- <base href="/"> -->')), /DESKTOP BASE HREF/);
});

test('ignores a commented-out base when a genuine root base follows', () => {
  assert.equal(verifyDesktopBaseHref(html('<!-- <base href="/bad/"> --><base href="/">')), true);
});

test('rejects an unfinished HTML comment containing a fake base', () => {
  assert.throws(() => verifyDesktopBaseHref(html('<!-- <base href="/">')), /DESKTOP BASE HREF/);
});

test('rejects a base nested in template or noscript rather than treating it as document base', () => {
  for (const wrapper of ['template', 'noscript']) {
    assert.throws(() => verifyDesktopBaseHref(html('<' + wrapper + '>' + '<base href="/">' + '</' + wrapper + '>')), /DESKTOP BASE HREF/, wrapper);
  }
});

test('accepts the actual Angular metadata-first source ordering', () => {
  assert.equal(verifyDesktopBaseHref('<!doctype html><html lang="it"><head><meta charset="utf-8"><title>VirgoStars Desktop</title><base href="/"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><vs-desktop-app></vs-desktop-app></body></html>'), true);
});

test('rejects unexpected head elements before base even without CSS links', () => {
  for (const before of ['<style></style>', '<div></div>', '<script type="module"></script>']) {
    assert.throws(() => verifyDesktopBaseHref(html(before + '<base href="/">')), /DESKTOP BASE HREF/, before);
  }
});

test('committed Angular source and Tauri frontend distribution agree on the root base', () => {
  const index = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const angular = JSON.parse(readFileSync(new URL('../angular.json', import.meta.url), 'utf8'));
  const tauri = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const build = angular.projects.desktop.architect.build;
  assert.equal(verifyDesktopBaseHref(index), true);
  assert.equal(build.options.index, 'src/index.html');
  assert.equal(build.options.outputPath, 'dist/desktop');
  assert.equal(tauri.build.frontendDist, '../' + build.options.outputPath + '/browser');
  assert.match(tauri.app.security.csp, /(?:^|;\s*)base-uri 'self'(?:;|$)/);
});

test('Angular build keeps active bundled CSS compatible with strict script CSP', () => {
  const angular = JSON.parse(readFileSync(new URL('../angular.json', import.meta.url), 'utf8'));
  const opts = angular.projects.desktop.architect.build.options;
  assert.deepEqual(opts.styles, ['src/styles.css']);
  assert.equal(opts.optimization.styles.inlineCritical, false);
  assert.equal(opts.optimization.fonts, false);
});

test('rejects http-equiv refresh before or after the canonical base', () => {
  for (const candidate of [
    '<meta http-equiv="refresh" content="0;url=https://example.invalid/"><base href="/">',
    '<base href="/"><meta http-equiv="refresh" content="0;url=https://example.invalid/">',
    '<base href="/"><META HTTP-EQUIV=REFRESH content="0;url=https://example.invalid/">',
    '<base href="/"><meta content="0; quoted > value" http-equiv = \'refresh\'>',
  ]) {
    assert.throws(() => verifyDesktopBaseHref(html(candidate)), /DESKTOP BASE HREF/, candidate);
  }
});

test('rejects unreviewed http-equiv directives instead of allowing policy overrides', () => {
  const directive = '<meta http-equiv="Content-Security-Policy" content="default-src *">';
  assert.throws(() => verifyDesktopBaseHref(html('<base href="/">' + directive)), /DESKTOP BASE HREF/);
});

test('ignores commented-out refresh but keeps normal Angular metadata valid', () => {
  const canonical = '<!-- <meta http-equiv="refresh" content="0;url=evil"> -->' +
    '<base href="/"><meta name="viewport" content="width=device-width, initial-scale=1">';
  assert.equal(verifyDesktopBaseHref(html(canonical)), true);
});
