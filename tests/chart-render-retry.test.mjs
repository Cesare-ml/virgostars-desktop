import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canRetryChartRender} from '../src/app/chart-render-retry.ts';
import {RenderGeneration} from '../src/app/render-generation.ts';

const failed = Object.freeze({
  initialized: true, destroyed: false, busy: false,
  ready: false, exporting: false, hasError: true,
});
const withField = (field, value) => ({...failed, [field]: value});

test('initialized chart with a visible failure permits explicit retry', () => {
  assert.equal(canRetryChartRender(failed), true);
  assert.equal(canRetryChartRender({...failed}), true);
});

test('a draw or export in progress blocks retry', () => {
  assert.equal(canRetryChartRender(withField('busy', true)), false);
  assert.equal(canRetryChartRender(withField('exporting', true)), false);
});

test('startup, teardown, healthy and cleared-error states never retry', () => {
  for (const [field, value] of [
    ['initialized', false], ['destroyed', true],
    ['ready', true], ['hasError', false],
  ]) {
    assert.equal(canRetryChartRender(withField(field, value)), false, field);
  }
});

test('null, missing and coercible flags fail closed', () => {
  for (const state of [null, undefined, {}, [], '', 1]) {
    assert.equal(canRetryChartRender(state), false);
  }
  for (const [field, value] of [
    ['initialized', 1], ['destroyed', undefined], ['busy', 0],
    ['ready', null], ['exporting', 'false'], ['hasError', 'true'],
  ]) {
    assert.equal(canRetryChartRender(withField(field, value)), false, field);
  }
});

test('retry is a guarded user action using the existing generation-owned draw path', () => {
  const src = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(src, /import \{ canRetryChartRender \} from '\.\/chart-render-retry'/);
  assert.match(src, /get canRetryChart\(\): boolean \{/);
  assert.match(src, /hasError:this\.lastDrawFailed && this\.error\.length > 0/);
  assert.match(src, /if \(!this\.canRetryChart\) return;\s*void this\.draw\(\);/);
  assert.match(src, /this\.drawGeneration\.isCurrent\(ticket\)/);
  assert.match(html, /\*ngIf="canRetryChart"/);
  assert.match(html, /\(click\)="retryChart\(\)"/);
  assert.match(html, /aria-label\]\s*=\s*"t\('chart\.retry'\)"/);
});

test('retry only follows a failed draw, never a failed PNG export or failed init', () => {
  const src = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(src, /private lastDrawFailed = false/);
  assert.match(src, /this\.lastDrawFailed=false;\s*this\.busy=true; this\.ready=false/);
  assert.match(src, /if\(this\.drawGeneration\.isCurrent\(ticket\)\) \{\s*this\.lastDrawFailed=true;\s*this\.renderError\(error\);/);
  assert.match(src, /catch\(error\) \{ if\(!this\.destroyed\) this\.renderError\(error\); \}/);
  assert.match(src, /this\.initialized = true;/);
});

test('retry action has matching Italian and English labels', () => {
  const catalog = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  const keys = catalog.match(/"chart\.retry":/g) ?? [];
  assert.equal(keys.length, 2);
  assert.match(catalog, /"chart\.retry":"Riprova il disegno"/);
  assert.match(catalog, /"chart\.retry":"Retry chart rendering"/);
});


test('stale draw failure cannot reopen retry after a newer successful redraw', async () => {
  const generations = new RenderGeneration();
  const ui = {...failed, busy: true, ready: false, hasError: false};
  let rejectOld;
  const oldDraw = new Promise((_, reject) => { rejectOld = reject; });
  const oldTicket = generations.begin();
  const oldCompletion = oldDraw.catch(() => {
    if (generations.isCurrent(oldTicket)) {
      ui.busy = false;
      ui.hasError = true;
    }
  });
  const newTicket = generations.begin();
  if (generations.isCurrent(newTicket)) {
    ui.busy = false;
    ui.ready = true;
  }
  rejectOld(new Error('synthetic old render failure'));
  await oldCompletion;
  assert.equal(ui.hasError, false);
  assert.equal(canRetryChartRender(ui), false);
});

test('destroyed component cannot expose retry after a pending failure settles', async () => {
  const generations = new RenderGeneration();
  const ui = {...failed, busy: true, hasError: false};
  const ticket = generations.begin();
  generations.dispose();
  ui.destroyed = true;
  await Promise.resolve();
  if (generations.isCurrent(ticket)) {
    ui.busy = false;
    ui.hasError = true;
  }
  assert.equal(generations.isCurrent(ticket), false);
  assert.equal(canRetryChartRender(ui), false);
});
