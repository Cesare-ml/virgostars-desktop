import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canRetryChartRender } from '../src/app/chart-render-retry.ts';

const eligible = Object.freeze({
  initialized: true, destroyed: false, busy: false,
  ready: false, exporting: false, hasError: true,
});

test('allows only an initialized idle renderer after a completed failed draw', () => {
  assert.equal(canRetryChartRender(eligible), true);
});

test('rejects missing state and every ineligible lifecycle condition', () => {
  assert.equal(canRetryChartRender(null), false);
  assert.equal(canRetryChartRender(undefined), false);
  for (const patch of [
    { initialized: false }, { destroyed: true }, { busy: true },
    { ready: true }, { exporting: true }, { hasError: false },
  ]) {
    assert.equal(canRetryChartRender({ ...eligible, ...patch }), false, JSON.stringify(patch));
  }
});

test('requires strict boolean states rather than truthy or missing values', () => {
  for (const patch of [
    { initialized: 1 }, { destroyed: 0 }, { busy: 0 },
    { ready: 0 }, { exporting: 0 }, { hasError: 1 },
  ]) {
    assert.equal(canRetryChartRender({ ...eligible, ...patch }), false);
  }
});

test('desktop action reuses the current draw path and does not recreate the renderer', () => {
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(component, /get canRetryChart\(\): boolean/);
  assert.match(component, /retryChart\(\): void[\s\S]*?if \(!this\.canRetryChart\) return;[\s\S]*?void this\.draw\(\);/);
  assert.match(template, /\*ngIf="canRetryChart"[\s\S]*?\(click\)="retryChart\(\)"/);
  assert.doesNotMatch(component.match(/retryChart\(\): void[\s\S]*?\n  }/)?.[0] ?? '', /inizializzaGraficoRender|new GraficoRenderService/);
});
