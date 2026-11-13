import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayMessage, displayThemeLabel, translate } from '../src/app/translations.ts';

test('settings shows current theme name in the chosen UI language', () => {
  assert.equal(displayThemeLabel('it', 'light'), 'Chiaro');
  assert.equal(displayThemeLabel('it', 'dark'), 'Scuro');
  assert.equal(displayThemeLabel('en', 'light'), 'Light');
  assert.equal(displayThemeLabel('en', 'dark'), 'Dark');
});

test('a previously raised renderer error changes language without recreating its state', () => {
  const savedKey = 'chart.failed';
  const italian = displayMessage('it', savedKey);
  const english = displayMessage('en', savedKey);
  assert.equal(italian, translate('it', savedKey));
  assert.equal(english, translate('en', savedKey));
  assert.notEqual(italian, english);
  assert.equal(displayMessage('it', null), '');
  assert.equal(displayMessage('en', null), '');
});

test('desktop error state stores the key, while the template displays the localized getter', () => {
  const base = new URL('../', import.meta.url);
  const component = readFileSync(new URL('src/app/desktop-app.component.ts', base), 'utf8');
  const template = readFileSync(new URL('src/app/desktop-app.component.html', base), 'utf8');
  assert.match(component, /error: MessageKey \| null = null;/);
  assert.match(component, /this\.error='chart\.failed'/);
  assert.match(component, /get errorText\(\): string \{ return displayMessage\(this\.locale, this\.error\); \}/);
  assert.match(template, /role="alert">\{\{errorText\}\}/);
});
