import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');

test('the planet and aspect tables start closed, whatever the window size', () => {
  assert.match(component, /inspectorCollapsed = true;/);
  assert.doesNotMatch(component, /inspectorCollapsed = window\.innerWidth/);
});

test('the navigation folds by itself until the user decides', () => {
  assert.match(component, /private navManual = false;/);
  assert.match(component, /if \(!this\.navManual\) \{/);
  assert.match(component, /this\.navManual = true;\s+this\.navCollapsed = !this\.navCollapsed;/);
});
