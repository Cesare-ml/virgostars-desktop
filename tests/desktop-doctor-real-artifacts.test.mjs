import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {diagnoseEnvironment} from '../scripts/desktop-doctor.mjs';

// Deliberately fictional artifacts: no real app, account, charts or private data.
const CSS = ':root{font-family:system-ui}*{box-sizing:border-box}vs-desktop-app{height:100%}';
const MAIN = 'export const fictionalDesktopFixture = true;';

function fixture(check) {
  const root = mkdtempSync(join(tmpdir(), 'vs-desktop-doctor-bundle-'));
  const bundle = join(root, 'dist', 'desktop', 'browser');
  mkdirSync(bundle, {recursive: true});
  const index = join(bundle, 'index.html');
  const main = join(bundle, 'main-LOCAL123.js');
  const css = join(bundle, 'styles-LOCAL123.css');
  function writeHtml(link = '<link rel="stylesheet" href="styles-LOCAL123.css">',
                     script = '<script type="module" src="main-LOCAL123.js"></script>') {
    writeFileSync(index, '<!doctype html><html><head>' + link +
      '</head><body><vs-desktop-app></vs-desktop-app>' + script + '</body></html>');
  }
  function report() {
    // Use actual on-disk CSS/JS inspectors; other build prerequisites are absent.
    return diagnoseEnvironment({
      root, charts: join(root, 'missing-charts'), stage: 'verify',
      platform: 'win32', nodeArch: 'x64', nodeVersion: 'v22.16.0',
      command: () => null, json: () => null,
      peInspector: () => { throw new Error('No real executable in fixture'); },
    });
  }
  try {
    writeHtml();
    writeFileSync(main, MAIN);
    writeFileSync(css, CSS);
    return check({writeHtml, report, main, css});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}
const status = (report, id) => report.checks.find(item => item.id === id)?.status;

test('real synthetic CSS and JS bundle files pass their independent doctor gates', () => fixture(f => {
  const result = f.report();
  assert.equal(status(result, 'angular-bundle'), 'pass');
  assert.equal(status(result, 'angular-css'), 'pass');
  assert.equal(status(result, 'angular-js'), 'pass');
  // This is not a native build; the Windows PE gate must still be blocked.
  assert.equal(status(result, 'windows-pe'), 'blocked');
}));

test('missing or empty main blocks JS but not valid CSS', () => fixture(f => {
  unlinkSync(f.main);
  let result = f.report();
  assert.equal(status(result, 'angular-js'), 'blocked');
  assert.equal(status(result, 'angular-css'), 'pass');

  writeFileSync(f.main, '');
  result = f.report();
  assert.equal(status(result, 'angular-js'), 'blocked');
  assert.equal(status(result, 'angular-css'), 'pass');
}));

test('external or inline executable JavaScript blocks JS but not valid CSS', () => fixture(f => {
  f.writeHtml(undefined, '<script type="module" src="https://example.invalid/main.js"></script>');
  assert.equal(status(f.report(), 'angular-js'), 'blocked');
  f.writeHtml(undefined, '<script type="module">alert(1)</script>');
  const result = f.report();
  assert.equal(status(result, 'angular-js'), 'blocked');
  assert.equal(status(result, 'angular-css'), 'pass');
}));

test('missing or print-only global CSS blocks CSS but not valid main', () => fixture(f => {
  unlinkSync(f.css);
  let result = f.report();
  assert.equal(status(result, 'angular-css'), 'blocked');
  assert.equal(status(result, 'angular-js'), 'pass');

  writeFileSync(f.css, CSS);
  f.writeHtml('<link rel="stylesheet" href="styles-LOCAL123.css" media="print">');
  result = f.report();
  assert.equal(status(result, 'angular-css'), 'blocked');
  assert.equal(status(result, 'angular-js'), 'pass');
}));
