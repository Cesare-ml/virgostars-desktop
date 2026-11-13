import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS, translate} from '../src/app/translations.ts';

const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');

test('theme names describe the active theme in the selected language', () => {
  assert.equal(translate('it', 'theme.current.light'), 'Chiaro');
  assert.equal(translate('it', 'theme.current.dark'), 'Scuro');
  assert.equal(translate('en', 'theme.current.light'), 'Light');
  assert.equal(translate('en', 'theme.current.dark'), 'Dark');
});

test('toggle button label still describes the action, not the current state', () => {
  assert.equal(translate('it', 'theme.light'), 'Attiva tema scuro');
  assert.equal(translate('it', 'theme.dark'), 'Attiva tema chiaro');
  assert.equal(translate('en', 'theme.light'), 'Switch to dark mode');
  assert.equal(translate('en', 'theme.dark'), 'Switch to light mode');
});

test('Italian and English retain identical translation keys', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const key of ['theme.current.light', 'theme.current.dark']) {
    assert.ok(STRINGS.it[key]);
    assert.ok(STRINGS.en[key]);
  }
});

test('the desktop inspector uses current theme names instead of hardcoded English', () => {
  assert.match(component, /get activeThemeLabel\(\): string \{ return this\.t\(this\.theme === 'light' \? 'theme\.current\.light' : 'theme\.current\.dark'\); \}/);
  assert.doesNotMatch(component, /get activeThemeLabel\(\): string \{ return this\.theme === 'light' \? 'Light' : 'Dark'; \}/);
  assert.match(component, /get themeToggleLabel\(\): string \{ return this\.t\(this\.theme === 'light' \? 'theme\.light':'theme\.dark'\); \}/);
});
