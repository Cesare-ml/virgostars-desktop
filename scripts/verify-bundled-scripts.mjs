/**
 * Check the Angular desktop entrypoint's executable scripts before native packaging.
 * Static artifact check only: it does not prove WebView2 runtime or all network isolation.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fail = message => { throw new Error('DESKTOP JS BUNDLE: ' + message); };

// Read actual HTML element boundaries: a <script> in a comment, quoted
// attribute, or inert template is not an executable module in WebView2.
function scriptTags(html) {
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
    const opening = /^<(\/?)([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(start));
    if (!opening) { cursor = start + 1; continue; }
    const name = opening[2].toLowerCase();
    let quote = null;
    let end = start + opening[0].length;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      } else if (ch === '<') {
        fail('Malformed HTML tag');
      }
    }
    if (end >= html.length || quote !== null) fail('Unterminated HTML tag');
    const tag = html.slice(start, end + 1);
    cursor = end + 1;
    if (opening[1]) continue;
    if (name === 'script') {
      const close = /<\/script\s*>/gi;
      close.lastIndex = cursor;
      const match = close.exec(html);
      if (!match) fail('Missing or unclosed Angular script element');
      scripts.push({tag, body:html.slice(cursor,match.index)});
      cursor = close.lastIndex;
      continue;
    }
    if (['style','title','textarea','template','noscript'].includes(name)) {
      const close = new RegExp('</' + name + '\\s*>', 'gi');
      close.lastIndex = cursor;
      const match = close.exec(html);
      if (!match) fail('Unterminated HTML ' + name + ' element');
      cursor = close.lastIndex;
    }
  }
  if (!scripts.length) fail('Missing or unclosed Angular script element');
  return scripts;
}

function scriptAttributes(tag) {
  const attrs = new Map();
  let pos = /^<script/i.exec(tag)[0].length;
  const end = tag.length - 1;
  while (pos < end) {
    while (pos < end && /\s/.test(tag[pos])) pos++;
    if (pos >= end) break;
    if (tag[pos] === '/' && pos === end - 1) break;
    const match = /^[^\s"'<>/=`]+/.exec(tag.slice(pos, end));
    if (!match) fail('Malformed script attribute');
    const name = match[0].toLowerCase();
    if (attrs.has(name)) {
      if (name === 'src') fail('Script must have exactly one src attribute');
      if (name === 'type') fail('Desktop script must declare type="module" exactly once');
      fail('Duplicate script attribute');
    }
    pos += match[0].length;
    while (pos < end && /\s/.test(tag[pos])) pos++;
    let value = '';
    if (tag[pos] === '=') {
      pos++;
      while (pos < end && /\s/.test(tag[pos])) pos++;
      if (pos >= end) fail('Missing script attribute value');
      const quote = tag[pos] === '"' || tag[pos] === "'" ? tag[pos++] : null;
      if (quote !== null) {
        const closing = tag.indexOf(quote, pos);
        if (closing < 0 || closing >= end) fail('Unterminated script attribute');
        value = tag.slice(pos,closing);
        pos = closing + 1;
      } else {
        const raw = /^[^\s"'<>`=]+/.exec(tag.slice(pos,end));
        if (!raw) fail('Malformed unquoted script attribute');
        value = raw[0];
        pos += raw[0].length;
      }
    }
    attrs.set(name, value);
  }
  return attrs;
}

export function inspectDesktopScripts(bundleDir) {
  const dir = resolve(bundleDir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const elements = scriptTags(html);
  const names = [];
  let mainCount = 0;
  for (const element of elements) {
    if (element.body.trim()) fail('Inline executable scripts are forbidden by desktop CSP');
    const attrs = scriptAttributes(element.tag);
    if ([...attrs.keys()].some(name => /^on[a-z]+$/.test(name))) {
      fail('Inline script event handler is forbidden by desktop CSP');
    }
    // The reviewed Angular builder emits src/type; title is a harmless
    // description already accepted by the contract tests. Unreviewed flags
    // such as async can reorder module execution, while crossorigin, nonce,
    // integrity or nomodule can change how WebView2 loads a bundled script.
    // Require an explicit build-gate review rather than trusting new attrs.
    if ([...attrs.keys()].some(name => !['src', 'type', 'title'].includes(name))) {
      fail('Unreviewed Angular script attribute');
    }
    if (!attrs.has('src')) fail('Script must have exactly one src attribute');
    if (attrs.get('type') !== 'module') fail('Desktop script must declare type="module" exactly once');
    const src = attrs.get('src');
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
