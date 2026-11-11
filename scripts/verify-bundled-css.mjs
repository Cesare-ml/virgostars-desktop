/**
 * Verify the Angular-generated entrypoint references a real local global stylesheet.
 * This is a build-artifact guard, NOT a WebView2 network or CSP runtime test.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = (message) => { throw new Error('DESKTOP CSS BUNDLE: ' + message); };

function htmlAttr(tag, name) {
  const re = new RegExp('(?:\\s|^)' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i');
  const match = re.exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : null;
}

export function inspectDesktopStyles(bundleDir) {
  const dir = resolve(bundleDir);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const stylesheetLinks = (html.match(/<link\b[^>]*>/gi) ?? []).filter(tag =>
    (htmlAttr(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes('stylesheet'));
  if (!stylesheetLinks.length) fail('Angular index.html has no linked stylesheet');
  const names = [];
  for (const tag of stylesheetLinks) {
    const href = htmlAttr(tag, 'href');
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
