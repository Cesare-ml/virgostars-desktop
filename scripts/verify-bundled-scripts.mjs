/**
 * Check the Angular desktop entrypoint's executable scripts before native packaging.
 * Static artifact check only: it does not prove WebView2 runtime or all network isolation.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fail = message => { throw new Error('DESKTOP JS BUNDLE: ' + message); };

function htmlAttr(tag, name) {
  const re = new RegExp('(?:\\s|^)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

export function inspectDesktopScripts(bundleDir) {
  const dir = resolve(bundleDir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const openTags = html.match(/<script\b[^>]*>/gi) ?? [];
  const elements = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  if (!openTags.length || elements.length !== openTags.length) {
    fail('Missing or unclosed Angular script element');
  }

  const names = [];
  let mainCount = 0;
  for (const element of elements) {
    const tag = openTags[names.length];
    if (element[1].trim()) fail('Inline executable scripts are forbidden by desktop CSP');
    if (/\son[a-z]+\s*=/i.test(tag)) fail('Inline script event handler is forbidden by desktop CSP');
    if ((tag.match(/\ssrc\s*=/gi) ?? []).length !== 1) fail('Script must have exactly one src attribute');
    if ((tag.match(/\stype\s*=/gi) ?? []).length !== 1 || htmlAttr(tag, 'type') !== 'module') {
      fail('Desktop script must declare type="module" exactly once');
    }
    const src = htmlAttr(tag, 'src');
    if (!src || !/^(?:\.\/)?(?:main|polyfills)(?:-[A-Za-z0-9_-]+)?\.js$/.test(src)) {
      fail('Unexpected or nonlocal desktop script reference');
    }
    const filename = src.replace(/^\.\//, '');
    if (names.includes(filename)) fail('Duplicate desktop script reference');
    if (/^main(?:-|\.)/.test(filename)) mainCount++;
    const stat = lstatSync(join(dir, filename), { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      fail('Local desktop script missing or not a regular file');
    }
    names.push(filename);
  }
  if (mainCount !== 1) fail('Exactly one Angular main module is required');
  if (names.length > 2) fail('Unexpected number of desktop entry scripts');
  return { scripts: names.length, files: names };
}
