import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canRetryChartRender} from '../src/app/chart-render-retry.ts';

const failed = Object.freeze({
  initialized: true, destroyed: false, busy: false,
  ready: false, exporting: false, hasError: true,
});
const withField = (field, value) => ({...failed, [field]: value});

test('initialized chart with a visible failure permits one explicit retry', () => {
  assert.equal(canRetryChartRender(failed), true);
  assert.equal(canRetryChartRender({...failed}), true);
});

test('a pending redraw or export blocks retry until it settles', () => {
  assert.equal(canRetryChartRender(withField('busy', true)), false);
  assert.equal(canRetryChartRender(withField('exporting', true)), false);
  const pending = {...failed};
  assert.equal(canRetryChartRender(pending), true);
  pending.busy = true;
  pending.hasError = false;
  assert.equal(canRetryChartRender(pending), false);
});

test('successful or destroyed charts never retry', () => {
  for (const [field, value] of [
    ['initialized', false], ['destroyed', true],
    ['ready', true], ['hasError', false],
  ]) {
    assert.equal(canRetryChartRender(withField(field, value)), false, field);
  }
});

test('unknown or coercible flags fail closed', () => {
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

test('retry is an explicit Angular UI action, with no automatic polling or IPC', () => {
  const src = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(src, /import \{ canRetryChartRender \} from '\.\/chart-render-retry'/);
  assert.match(src, /get canRetryChart\(\): boolean \{/);
  assert.match(src, /if \(!this\.canRetryChart\) return;\s*void this\.draw\(\);/);
  assert.match(src, /this\.drawGeneration\.isCurrent\(ticket\)/);
  assert.match(html, /\*ngIf="canRetryChart"/);
  assert.match(html, /\(click\)="retryChart\(\)"/);
  assert.match(html, /type="button" class="toolbar-button fit-button" \*ngIf="canRetryChart"/);
});

test('retry action is localized in both UI languages', () => {
  const catalog = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  const keys = catalog.match(/"chart\.retry":/g) ?? [];
  assert.equal(keys.length, 2);
  assert.match(catalog, /"chart\.retry":"Riprova il disegno"/);
  assert.match(catalog, /"chart\.retry":"Retry chart rendering"/);
});
