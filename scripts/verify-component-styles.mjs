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

/**
 * Reject explicit later/conditional overrides that would turn the Desktop
 * app shell, workspace or stage into a non-grid/invisible surface. Keep selectors
 * anchored to those elements, not descendants hidden by responsive nav rules.
 * This is a conservative source heuristic, not a computed-style CSS parser.
 */
export function hasDesktopLayoutOverride(css) {
  if (typeof css !== 'string') return false;
  for (const rule of css.matchAll(/([^{}]{1,400})\{([^{}]{0,1200})\}/g)) {
    const selectors = rule[1].split(',');
    const targetsLayout = selectors.some(part => {
      const selector = part.trim();
      return /(?:^|[\s>+~"'(\[=])\.(?:desktop-app|workspace|chart-stage)(?:\[[^\]{}]{1,160}\]|\.[a-z-]+)*\s*$/i.test(selector) ||
        /:(?:is|where)\(\s*\.(?:desktop-app|workspace|chart-stage)\s*\)\s*$/i.test(selector);
    });
    if (!targetsLayout) continue;
    const declarations = rule[2];
    for (const display of declarations.matchAll(/(?:^|;)\s*display\s*:\s*([a-z-]+)\s*(?:!important)?\s*(?=;|$)/gi)) {
      if (!['grid', 'inline-grid'].includes(display[1].toLowerCase())) return true;
    }
    if (/(?:^|;)\s*visibility\s*:\s*hidden\s*(?:!important)?\s*(?=;|$)/i.test(declarations) ||
        /(?:^|;)\s*opacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*(?=;|$)/i.test(declarations)) return true;
    // A grid can remain "display:grid" while its own dimensions collapse.
    // Check only layout roots: min-width:0 / min-height:0 are intentional.
    if (/(?:^|;)\s*(?:width|height|max-width|max-height)\s*:\s*0(?:\.0+)?(?:px|em|rem|%|vh|vw|vmin|vmax)?\s*(?:!important)?\s*(?=;|$)/i.test(declarations)) return true;
  }
  return false;
}

/** The shell, workspace and chart stage must all retain their grid layout. */
export function hasDesktopComponentLayout(css) {
  if (typeof css !== 'string' || hasDesktopLayoutOverride(css)) return false;
  return componentRule(css, 'desktop-app', [
    /(?:^|;)\s*display\s*:\s*grid\s*(?:;|$)/,
    /(?:^|;)\s*grid-template-rows\s*:/,
  ]) && componentRule(css, 'workspace', [
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
  // Inspect EVERY candidate before accepting an early layout match: otherwise
  // a valid main module can hide a later symlink or oversized chunk from review.
  let bytes = 0;
  const candidates = [];
  for (const entry of names) {
    if (!entry.isFile() || entry.isSymbolicLink()) fail('Unsafe compiled style candidate');
    const path = join(root, entry.name);
    let stat;
    try { stat = lstatSync(path); } catch { fail('Cannot inspect compiled style candidate'); }
    if (!stat.isFile() || stat.isSymbolicLink()) fail('Unsafe compiled style candidate');
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 ||
        stat.size > MAX_BYTES_PER_FILE || (bytes += stat.size) > MAX_TOTAL_BYTES) {
      fail('Compiled style candidate exceeds limits');
    }
    candidates.push({name: entry.name, path});
  }
  let evidence = null;
  for (const candidate of candidates) {
    let css;
    try { css = readFileSync(candidate.path, 'utf8'); }
    catch { fail('Cannot read compiled style candidate'); }
    // Continue after the first valid candidate: a later Angular chunk may
    // contain an overriding style that makes the completed UI invisible.
    if (hasDesktopLayoutOverride(css)) fail('Desktop layout overridden by compiled CSS');
    if (evidence === null && hasDesktopComponentLayout(css)) evidence = candidate.name;
  }
  if (evidence !== null) return {checked: candidates.length, evidence};
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
