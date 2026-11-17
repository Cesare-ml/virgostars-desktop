import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');

test('on a narrow window the floating inspector starts closed instead of covering the chart', () => {
  assert.match(component, /inspectorCollapsed = window\.innerWidth <= INSPECTOR_OVERLAY_MAX_PX;/);
});

test('the navigation folds by itself until the user decides', () => {
  assert.match(component, /private navManual = false;/);
  assert.match(component, /if \(!this\.navManual\) \{/);
  assert.match(component, /this\.navManual = true;\s+this\.navCollapsed = !this\.navCollapsed;/);
});
