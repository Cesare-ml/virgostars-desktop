import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canRetryChartRender} from '../src/app/chart-render-retry.ts';

const failed = Object.freeze({
  initialized: true, destroyed: false, busy: false,
  ready: false, exporting: false, hasError: true,
});
const withField = (field, value) => ({...failed, [field]: value});

test('an initialized, idle renderer with a visible draw error permits manual retry', () => {
  assert.equal(canRetryChartRender(failed), true);
  assert.equal(canRetryChartRender({...failed}), true);
});

test('pending render and PNG export block another retry', () => {
  assert.equal(canRetryChartRender(withField('busy', true)), false);
  assert.equal(canRetryChartRender(withField('exporting', true)), false);
});

test('startup failure, successful render and teardown never permit retry', () => {
  for (const [field, value] of [
    ['initialized', false], ['destroyed', true],
    ['ready', true], ['hasError', false],
  ]) {
    assert.equal(canRetryChartRender(withField(field, value)), false, field);
  }
});

test('unknown and coercible state values fail closed', () => {
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

test('Angular exposes a user action that reuses the latest-generation draw path', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(source, /import \{ canRetryChartRender \} from '\.\/chart-render-retry'/);
  assert.match(source, /get canRetryChart\(\): boolean \{/);
  assert.match(source, /if \(!this\.canRetryChart\) return;\s*void this\.draw\(\);/);
  assert.match(source, /this\.drawGeneration\.isCurrent\(ticket\)/);
  assert.match(template, /\*ngIf="canRetryChart"/);
  assert.match(template, /\(click\)="retryChart\(\)"/);
  assert.match(template, /\[attr\.aria-label\]="t\('chart\.retry'\)"/);
});

test('retry text exists in both locales', () => {
  const catalog = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');
  assert.equal((catalog.match(/"chart\.retry":/g) ?? []).length, 2);
  assert.match(catalog, /"chart\.retry":"Riprova il disegno"/);
  assert.match(catalog, /"chart\.retry":"Retry chart rendering"/);
});

test('only draw failure sets retry eligibility; export and initialization errors do not', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(source, /private drawFailed = false;/);
  assert.match(source, /this.drawFailed=false;\\s*this.busy=true;/);
  const drawStart = source.indexOf('  async draw(): Promise<void> {');
  const exportStart = source.indexOf('  async exportPng(): Promise<void> {', drawStart);
  const draw = source.slice(drawStart, exportStart);
  assert.match(draw, /if\\(this.drawGeneration.isCurrent\\(ticket\\)\\) \\{\\s*this.drawFailed=true;\\s*this.renderError\\(error\\);/);
  assert.doesNotMatch(source.slice(exportStart), /this.drawFailed=true/);
});

test('retry is not automatic and introduces no timer or native IPC call', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  retryChart(): void {');
  const end = source.indexOf('  async draw(): Promise<void> {', start);
  assert.ok(start >= 0 && end > start);
  const method = source.slice(start, end);
  assert.match(method, /if \(!this\.canRetryChart\) return;/);
  assert.match(method, /void this\.draw\(\);/);
  assert.doesNotMatch(method, /setTimeout|setInterval|invoke\(/);
});

test('PNG export errors preserve the rendered chart and do not call renderError', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  async exportPng(): Promise<void> {');
  const end = source.indexOf('  private renderError(', start);
  assert.ok(start >= 0 && end > start);
  const method = source.slice(start, end);
  assert.doesNotMatch(method, /this\\.renderError\\(/);
  assert.match(method, /PNG export does not invalidate an already rendered, usable chart/);
  assert.doesNotMatch(method, /this\\.ready=false/);
});
