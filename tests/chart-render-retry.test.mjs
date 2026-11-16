import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canRetryChartRender} from '../src/app/chart-render-retry.ts';

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
  assert.match(src, /if \(!this\.canRetryChart\) return;\s*void this\.draw\(\);/);
  assert.match(src, /this\.drawGeneration\.isCurrent\(ticket\)/);
  assert.match(html, /\*ngIf="canRetryChart"/);
  assert.match(html, /\(click\)="retryChart\(\)"/);
  assert.match(html, /aria-label\]\s*=\s*"t\('chart\.retry'\)"/);
});

test('retry action has matching Italian and English labels', () => {
  const catalog = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  const keys = catalog.match(/"chart\.retry":/g) ?? [];
  assert.equal(keys.length, 2);
  assert.match(catalog, /"chart\.retry":"Riprova il disegno"/);
  assert.match(catalog, /"chart\.retry":"Retry chart rendering"/);
});
