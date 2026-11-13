import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyDesktopAppRoot } from '../scripts/verify-desktop-app-root.mjs';

const app = '<vs-desktop-app></vs-desktop-app>';
const html = child => '<!doctype html><html lang="it"><head><base href="/"></head><body>' + child + '<script src="main-TEST.js" type="module"></script></body></html>';

test('accepts Angular-generated canonical empty app as first body element', () => {
  assert.equal(verifyDesktopAppRoot(html(app)), true);
});
test('accepts harmless whitespace and closed comments before app', () => {
  assert.equal(verifyDesktopAppRoot(html(' \n<!-- demo -->' + app)), true);
});
test('accepts uppercase markup and whitespace in closing tags', () => {
  assert.equal(verifyDesktopAppRoot(html('<VS-DESKTOP-APP ></VS-DESKTOP-APP >')), true);
});
test('rejects root only in an HTML comment', () => {
  assert.throws(() => verifyDesktopAppRoot(html('<!-- ' + app + ' -->')), /not the desktop-owned app/);
});
test('rejects root only inside inert template or noscript', () => {
  for (const tag of ['template', 'noscript']) {
    assert.throws(() => verifyDesktopAppRoot(html('<' + tag + '>' + app + '</' + tag + '>')), /not the desktop-owned app/);
  }
});
test('rejects root buried inside a script string', () => {
  assert.throws(() => verifyDesktopAppRoot(html('<script>const app = ' + JSON.stringify(app) + ';</script>')), /not the desktop-owned app/);
});
test('rejects duplicate or nested root elements', () => {
  for (const child of [app + app, '<vs-desktop-app>' + app + '</vs-desktop-app>']) {
    assert.throws(() => verifyDesktopAppRoot(html(child)), /not the desktop-owned app/);
  }
});
test('rejects a body that starts with a script before the app', () => {
  assert.throws(() => verifyDesktopAppRoot(html('<script src="main-TEST.js" type="module"></script>' + app)), /not the desktop-owned app/);
});
test('rejects malformed, absent or unclosed body/root elements', () => {
  for (const bad of [html('<vs-desktop-app>'), html(app).replace('</body>', ''), '<html>' + app + '</html>', html(app).replace('</vs-desktop-app>', '')]) {
    assert.throws(() => verifyDesktopAppRoot(bad), /not the desktop-owned app/);
  }
});
test('rejects a truncated HTML comment or duplicate body tags', () => {
  assert.throws(() => verifyDesktopAppRoot(html('<!-- ' + app)), /not the desktop-owned app/);
  assert.throws(() => verifyDesktopAppRoot(html(app).replace('</body>', '</body><body></body>')), /not the desktop-owned app/);
});
test('rejects unreviewed root attributes rather than trusting a hidden host', () => {
  assert.throws(() => verifyDesktopAppRoot(html('<vs-desktop-app hidden></vs-desktop-app>')), /not the desktop-owned app/);
});
test('does not expose the submitted HTML or secret values in errors', () => {
  const secret = 'privatesyntheticinvalid';
  assert.throws(() => verifyDesktopAppRoot(html('<script>' + secret + '</script>')), error =>
    error.message.includes('not the desktop-owned app') && !error.message.includes(secret));
});

test('committed Angular src/index.html preserves the first-child empty desktop host', () => {
  const source = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.equal(verifyDesktopAppRoot(source), true);
});

test('rejects an extra closing root tag after the canonical host', () => {
  assert.throws(() => verifyDesktopAppRoot(html(app + '</vs-desktop-app>')), /not the desktop-owned app/);
});

test('rejects an extra closing root tag outside body', () => {
  assert.throws(() => verifyDesktopAppRoot(html(app) + '</vs-desktop-app>'), /not the desktop-owned app/);
});

test('commented-out extra closing root tag does not invalidate a genuine host', () => {
  assert.equal(verifyDesktopAppRoot(html('<!-- </vs-desktop-app> -->' + app)), true);
});


test('rejects hidden, inert and inline-hidden body attributes that would blank WebView2', () => {
  for (const opening of [
    '<body hidden>', '<body inert>', '<body style="display:none">',
    '<body aria-hidden="true">', '<body hidden="hidden">'
  ]) {
    const bad = html(app).replace('<body>', opening);
    assert.throws(() => verifyDesktopAppRoot(bad), /not the desktop-owned app/, opening);
  }
});

test('accepts harmless whitespace and HTML comments around an otherwise plain body', () => {
  const doc = html(app).replace('<body>', '<!-- <body hidden> --> <BODY >');
  assert.equal(verifyDesktopAppRoot(doc), true);
});

test('requires the current reviewed plain body instead of silently allowing future attributes', () => {
  assert.throws(() => verifyDesktopAppRoot(html(app).replace('<body>', '<body class="future-layout">')),
    /not the desktop-owned app/);
});
