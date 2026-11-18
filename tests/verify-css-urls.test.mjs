import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertOfflineCssUrls } from '../scripts/verify-css-urls.mjs';

function inBundle(run) {
  const dir = mkdtempSync(join(tmpdir(), 'vs-css-url-'));
  try {
    mkdirSync(join(dir, 'media'));
    mkdirSync(join(dir, 'assets', 'img'), {recursive: true});
    writeFileSync(join(dir, 'media', 'font-123.woff2'), 'synthetic');
    writeFileSync(join(dir, 'assets', 'img', 'fictional.png'), 'synthetic');
    return run(dir);
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

test('normal offline stylesheet without URLs is accepted', () => inBundle(dir => {
  assert.equal(assertOfflineCssUrls('vs-desktop-app{box-sizing:border-box}', dir), 0);
}));
test('valid local media and image files are accepted', () => inBundle(dir => {
  const css = '@font-face{src:url("media/font-123.woff2")} p{background:url(./assets/img/fictional.png)}';
  assert.equal(assertOfflineCssUrls(css, dir), 2);
}));
test('remote, root-relative, protocol-relative, file and blob URLs fail closed', () => inBundle(dir => {
  for (const path of [
    'https://example.invalid/a.woff2', 'http://example.invalid/a.png', '//example.invalid/a.png',
    '/assets/img/fictional.png', 'file:///C:/secret.txt', 'blob:https://example.invalid/id',
    'javascript:alert(1)', '../media/font-123.woff2', 'media/%2e%2e/file',
  ]) assert.throws(() => assertOfflineCssUrls('p{background:url("' + path + '")}', dir), /DESKTOP CSS URLS/, path);
}));
test('CSS escaped url function and escaped remote URL cannot bypass the audit', () => inBundle(dir => {
  for (const css of ['p{background:u\\72l("https://example.invalid/x")}',
    'p{background:URL(https\\3a //example.invalid/x)}',
    'p{background:url(https://example.invalid/x)}',
    'p{background:url/**/(https://example.invalid/x)}']) {
    assert.throws(() => assertOfflineCssUrls(css, dir), /DESKTOP CSS URLS/);
  }
}));
test('inert comments and quoted strings are skipped', () => inBundle(dir => {
  const css = '/* url(https://example.invalid/external) */ p:before{content:"url(https://example.invalid/a)"}';
  assert.equal(assertOfflineCssUrls(css, dir), 0);
}));
test('missing resources, symlinks and directory targets are rejected', () => inBundle(dir => {
  assert.throws(() => assertOfflineCssUrls('a{src:url(media/absent.woff2)}', dir), /Missing or unsafe/);
  assert.throws(() => assertOfflineCssUrls('a{src:url(assets/img)}', dir), /Nonlocal or unapproved|Missing or unsafe/);
  symlinkSync(join(dir, 'media', 'font-123.woff2'), join(dir, 'media', 'linked.woff2'));
  assert.throws(() => assertOfflineCssUrls('a{src:url(media/linked.woff2)}', dir), /Missing or unsafe/);
}));
test('bounded inline raster data accepted, remote and SVG data disallowed', () => inBundle(dir => {
  assert.equal(assertOfflineCssUrls('p{background:url(data:image/png;base64,AA==)}', dir), 1);
  for (const data of ['data:text/html;base64,AA==', 'data:image/svg+xml;base64,AA==',
    'data:image/png;base64,AB==', 'data:image/png;base64,', 'data:image/png;base64,' + 'A'.repeat(33000)]) {
    assert.throws(() => assertOfflineCssUrls('p{background:url(' + data + ')}', dir), /DESKTOP CSS URLS/);
  }
}));
test('malformed CSS comments, escapes, strings, URLs fail closed', () => inBundle(dir => {
  for (const css of ['/* unterminated', 'p{content:"unfinished}', 'p{background:url(media/a',
    'p{background:url("media/abc"', 'p{background:url(https://some\npath)}',
    'p{background:url(media/abc\\', 'p{background:u\\000000rl(foo)}']) {
    assert.throws(() => assertOfflineCssUrls(css, dir), /DESKTOP CSS URLS/);
  }
}));
