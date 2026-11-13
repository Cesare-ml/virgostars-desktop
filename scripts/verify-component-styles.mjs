/**
 * Guard the compiled Angular Desktop component styles before embedding in Tauri.
 *
 * A healthy global styles*.css link does not prove Angular preserved the
 * component's layout rules. Angular 20 may emit component CSS inside an ESM
 * chunk rather than the global stylesheet: inspect both local output types.
 * Source/artifact heuristic only, not proof that WebView2 applied the styles.
 */
import {lstatSync, readdirSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const JS_NAME = /^(?:(?:main|polyfills)(?:-[A-Za-z0-9_-]+)?|chunk-[A-Za-z0-9_-]+)\.js$/;
const CSS_NAME = /^styles(?:-[A-Za-z0-9_-]+)?\.css$/;
const MAX_FILES = 514;
const MAX_BYTES_PER_FILE = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const fail = reason => { throw new Error('DESKTOP COMPONENT CSS: ' + reason); };

// Angular emulated encapsulation appends [_ngcontent-%COMP%] to selectors.
// Search bounded rule bodies for actual declarations, not a selector name
// appearing incidentally in a template or quoted UI string.
function componentRule(css, selector, declarations) {
  const head = new RegExp('\\.' + selector + '(?:\\[[^\\]{}]{1,160}\\])?\\s*\\{([^{}]{1,1200})\\}', 'g');
  for (const match of css.matchAll(head)) {
    if (declarations.every(declaration => declaration.test(match[1]))) return true;
  }
  return false;
}

/** Two independent grid/stage rules must exist in compiled component CSS. */
export function hasDesktopComponentLayout(css) {
  if (typeof css !== 'string') return false;
  return componentRule(css, 'workspace', [
    /(?:^|;)\s*display\s*:\s*grid\s*(?:;|$)/,
    /(?:^|;)\s*grid-template-columns\s*:/,
  ]) && componentRule(css, 'chart-stage', [
    /(?:^|;)\s*display\s*:\s*grid\s*(?:;|$)/,
    /(?:^|;)\s*flex\s*:\s*1(?:\s+[0-9.%a-z-]+)?\s*(?:;|$)/,
  ]);
}

/** Reads only approved local Angular JS/CSS regular files, with size caps. */
export function inspectDesktopComponentStyles(bundleDir) {
  if (typeof bundleDir !== 'string' || !bundleDir) fail('Invalid bundle directory');
  let entries;
  const root = resolve(bundleDir);
  try { entries = readdirSync(root, {withFileTypes: true}); }
  catch { fail('Cannot list Angular output'); }
  const names = entries.filter(entry => JS_NAME.test(entry.name) || CSS_NAME.test(entry.name));
  if (!names.length || names.length > MAX_FILES) fail('Unexpected number of compiled style candidates');
  let bytes = 0;
  for (const entry of names) {
    if (!entry.isFile() || entry.isSymbolicLink()) fail('Unsafe compiled style candidate');
    const path = join(root, entry.name);
    let stat;
    try { stat = lstatSync(path); } catch { fail('Cannot inspect compiled style candidate'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES_PER_FILE ||
        (bytes += stat.size) > MAX_TOTAL_BYTES) fail('Compiled style candidate exceeds limits');
    let css;
    try { css = readFileSync(path, 'utf8'); } catch { fail('Cannot read compiled style candidate'); }
    if (hasDesktopComponentLayout(css)) {
      return {checked: names.length, evidence: entry.name};
    }
  }
  fail('Missing Angular workspace and chart-stage component CSS rules');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(fileURLToPath(new URL('../dist/desktop/browser', import.meta.url)));
    const result = inspectDesktopComponentStyles(root);
    console.log('Verified compiled Desktop component layout in ' + result.evidence +
      ' (static artifact check; WebView2 visual QA pending).');
  } catch(error) {
    console.error(error instanceof Error ? error.message : 'DESKTOP COMPONENT CSS: unknown error');
    process.exitCode = 1;
  }
}
