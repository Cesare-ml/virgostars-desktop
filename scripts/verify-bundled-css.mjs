/**
 * Verify the Angular-generated entrypoint references a real local global stylesheet.
 * This is a build-artifact guard, NOT a WebView2 network or CSP runtime test.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message) => { throw new Error('DESKTOP CSS BUNDLE: ' + message); };

// Read HTML link tags without treating a quoted ">" as the end of the tag.
// This is intentionally a narrow build-artifact parser, not a general HTML parser.
function extractLinkTags(html) {
  const tags = [];
  const marker = /<link(?=[\s/>])/gi;
  let match;
  while ((match = marker.exec(html)) !== null) {
    let quote = null;
    let end = marker.lastIndex;
    for (; end < html.length; end++) {
      const ch = html[end];
      if (quote !== null) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      } else if (ch === '<') {
        fail('Malformed HTML link tag');
      }
    }
    if (end === html.length || quote !== null) fail('Unterminated HTML link tag');
    tags.push(html.slice(match.index, end + 1));
    marker.lastIndex = end + 1;
  }
  return tags;
}

// Parse actual attribute names rather than searching within quoted attribute
// values (e.g. title="example onload=..." is NOT an event handler).
function linkAttributes(tag) {
  const attrs = new Map();
  let offset = /^<link/i.exec(tag)[0].length;
  const end = tag.length - 1; // closing >
  while (offset < end) {
    while (offset < end && /\s/.test(tag[offset])) offset++;
    if (offset >= end) break;
    if (tag[offset] === '/' && offset === end - 1) break;
    const nameMatch = /^[^\s"'<>/=`]+/.exec(tag.slice(offset, end));
    if (!nameMatch) fail('Malformed stylesheet link attribute');
    const name = nameMatch[0].toLowerCase();
    if (attrs.has(name)) fail('Duplicate stylesheet link attribute: ' + name);
    offset += nameMatch[0].length;
    while (offset < end && /\s/.test(tag[offset])) offset++;
    let value = '';
    if (tag[offset] === '=') {
      offset++;
      while (offset < end && /\s/.test(tag[offset])) offset++;
      if (offset >= end) fail('Missing stylesheet link attribute value');
      const quote = tag[offset] === '"' || tag[offset] === "'" ? tag[offset++] : null;
      if (quote !== null) {
        const close = tag.indexOf(quote, offset);
        if (close < 0 || close >= end) fail('Unterminated stylesheet link attribute value');
        value = tag.slice(offset, close);
        offset = close + 1;
      } else {
        const raw = /^[^\s"'<>`=]+/.exec(tag.slice(offset, end));
        if (!raw) fail('Malformed unquoted stylesheet link attribute value');
        value = raw[0];
        offset += raw[0].length;
      }
    }
    attrs.set(name, value);
  }
  return attrs;
}

export function inspectDesktopStyles(bundleDir) {
  const dir = resolve(bundleDir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const stylesheetLinks = extractLinkTags(html)
    .map(tag => ({tag, attrs: linkAttributes(tag)}))
    .filter(({attrs}) => (attrs.get('rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet'));
  if (!stylesheetLinks.length) fail('Angular index.html has no linked stylesheet');
  const names = [];
  for (const {attrs} of stylesheetLinks) {
    // A stylesheet can exist on disk yet be inactive in WebView2. HTML
    // disables alternate stylesheets by default and ignores disabled links
    // or unsupported MIME types; presence alone is not an active-CSS proof.
    const relTokens = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (relTokens.includes('alternate')) {
      fail('Alternate stylesheet is not active by default');
    }
    if (attrs.has('disabled')) {
      fail('Disabled stylesheet cannot style the desktop app');
    }
    const type = attrs.get('type');
    if (type !== undefined && type.trim().toLowerCase() !== 'text/css') {
      fail('Non-CSS stylesheet MIME type will not style the desktop app');
    }
    // Angular's default critical-CSS optimization can emit:
    // <link rel="stylesheet" media="print" onload="this.media='all'">
    // Tauri's script-src blocks that inline event handler, leaving CSS inactive.
    // Reject such output rather than weakening Content Security Policy.
    if ([...attrs.keys()].some(name => /^on[a-z]+$/.test(name))) {
      fail('Inline stylesheet event handler is incompatible with Tauri CSP');
    }
    const media = attrs.get('media');
    if (media !== undefined && !['all','screen'].includes(media.trim().toLowerCase())) {
      fail('Deferred or print-only stylesheet is incompatible with the desktop CSP');
    }
    const href = attrs.get('href');
    // Angular application builder normally outputs a root-level hashed styles-*.css.
    // Only local, path-safe relative URLs are accepted for this synthetic offline test.
    if (!href || !/^(?:\.\/)?styles(?:-[A-Za-z0-9_-]+)?\.css$/.test(href)) {
      fail('Unexpected or nonlocal stylesheet reference');
    }
    const cssFile = join(dir, href.replace(/^\.\//, ''));
    const stat = lstatSync(cssFile, {throwIfNoEntry:false});
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      fail('Local global stylesheet missing or not a regular file');
    }
    const css = readFileSync(cssFile, 'utf8');
    // Both selectors are in the committed global src/styles.css and survive CSS minification.
    if (!css.includes('vs-desktop-app') || !css.includes('box-sizing')) {
      fail('Global stylesheet is incomplete or does not match VirgoStars Desktop');
    }
    names.push(href);
  }
  return { stylesheets: names.length, files: names };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    const report = inspectDesktopStyles(join(projectRoot, 'dist', 'desktop', 'browser'));
    console.log('Desktop Angular CSS: ' + report.stylesheets + ' local stylesheet(s) verified: ' + report.files.join(', '));
    console.log('This verifies build artifacts, NOT whether Windows WebView2 actually loaded CSS.');
  } catch (error) {
    console.error('DESKTOP CSS BUILD CHECK FAILED: ' + (error instanceof Error ? error.message : 'unknown error'));
    process.exitCode = 1;
  }
}
