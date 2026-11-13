/**
 * Check Angular's executable entrypoints before packaging the desktop browser bundle.
 * This static check does NOT prove WebView2 execution or all network isolation.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fail = message => { throw new Error('DESKTOP JS BUNDLE: ' + message); };

// Inspect real HTML tags, not strings in comments, attributes or raw-text nodes.
// This deliberately narrow parser validates the generated Angular entrypoint;
// it is not intended to parse arbitrary web pages.
function scriptElements(html) {
  const scripts = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) break;
    if (html.startsWith('<!--', start)) {
      const close = html.indexOf('-->', start + 4);
      if (close < 0) fail('Unterminated HTML comment');
      cursor = close + 3;
      continue;
    }
    const opening = /^<(\/?)(([A-Za-z][A-Za-z0-9:-]*))(?=[\s/>])/i.exec(html.slice(start));
    if (!opening) { cursor = start + 1; continue; }
    const name = opening[2].toLowerCase();
    let quote = null;
    let end = start + opening[0].length;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      else if (ch === '<') fail('Malformed HTML tag');
    }
    if (end === html.length || quote !== null) fail('Unterminated HTML tag');
    const tag = html.slice(start, end + 1);
    cursor = end + 1;
    if (opening[1]) continue;

    // Angular's generated index does not require these inert containers.
    // Reject them instead of accidentally crediting a hidden script as main.
    if (name === 'template' || name === 'noscript') {
      fail('Unexpected inert HTML container in desktop entrypoint');
    }
    if (name === 'script') {
      const closing = /<\/script\s*>/gi;
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) fail('Missing or unclosed Angular script element');
      scripts.push({ tag, body: html.slice(cursor, match.index) });
      cursor = closing.lastIndex;
    } else if (['title', 'style', 'textarea'].includes(name)) {
      // HTML raw-text elements can contain script-looking strings.
      const closing = new RegExp('</' + name + '\\s*>', 'gi');
      closing.lastIndex = cursor;
      const match = closing.exec(html);
      if (!match) fail('Unterminated HTML ' + name + ' element');
      cursor = closing.lastIndex;
    }
  }
  if (!scripts.length) fail('Missing or unclosed Angular script element');
  return scripts;
}

// Read actual attributes, not fake src or onload text inside quoted values.
function scriptAttributes(tag) {
  const attrs = new Map();
  let cursor = /^<script\b/i.exec(tag)[0].length;
  const end = tag.length - 1;
  while (cursor < end) {
    while (cursor < end && /\s/.test(tag[cursor])) cursor++;
    if (cursor >= end) break;
    if (tag[cursor] === '/' && cursor === end - 1) break;
    const found = /^[^\s"'<>/=`]+/.exec(tag.slice(cursor, end));
    if (!found) fail('Malformed script attribute');
    const name = found[0].toLowerCase();
    if (attrs.has(name)) {
      if (name === 'src') fail('Script must have exactly one src attribute');
      if (name === 'type') fail('Desktop script must declare type="module" exactly once');
      fail('Duplicate script attribute: ' + name);
    }
    cursor += found[0].length;
    while (cursor < end && /\s/.test(tag[cursor])) cursor++;
    let value = '';
    if (tag[cursor] === '=') {
      cursor++;
      while (cursor < end && /\s/.test(tag[cursor])) cursor++;
      if (cursor >= end) fail('Missing script attribute value');
      const quote = tag[cursor] === '"' || tag[cursor] === "'" ? tag[cursor++] : null;
      if (quote !== null) {
        const close = tag.indexOf(quote, cursor);
        if (close < 0 || close >= end) fail('Unterminated script attribute value');
        value = tag.slice(cursor, close);
        cursor = close + 1;
      } else {
        const unquoted = /^[^\s"'<>`=]+/.exec(tag.slice(cursor, end));
        if (!unquoted) fail('Malformed unquoted script attribute value');
        value = unquoted[0];
        cursor += unquoted[0].length;
      }
    }
    attrs.set(name, value);
  }
  return attrs;
}

export function inspectDesktopScripts(bundleDir) {
  const dir = resolve(bundleDir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const elements = scriptElements(html);
  const names = [];
  let mainCount = 0;
  for (const {tag, body} of elements) {
    if (body.trim()) fail('Inline executable scripts are forbidden by desktop CSP');
    const attrs = scriptAttributes(tag);
    if ([...attrs.keys()].some(name => /^on[a-z]+$/.test(name))) {
      fail('Inline script event handler is forbidden by desktop CSP');
    }
    if (!attrs.has('src')) fail('Script must have exactly one src attribute');
    if (attrs.get('type') !== 'module') fail('Desktop script must declare type="module" exactly once');
    const src = attrs.get('src');
    if (!/^(?:\.\/)?(?:main|polyfills)(?:-[A-Za-z0-9_-]+)?\.js$/.test(src)) {
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
