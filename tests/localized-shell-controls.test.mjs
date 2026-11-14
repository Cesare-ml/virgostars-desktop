import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, translate } from '../src/app/translations.ts';

test('English and Italian dictionaries retain identical message keys', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
});

test('settings describe the ACTIVE theme rather than the opposite toggle action', () => {
  assert.equal(translate('it', 'theme.currentLight'), 'Chiaro');
  assert.equal(translate('it', 'theme.currentDark'), 'Scuro');
  assert.equal(translate('en', 'theme.currentLight'), 'Light');
  assert.equal(translate('en', 'theme.currentDark'), 'Dark');
  assert.notEqual(translate('it', 'theme.currentLight'), translate('it', 'theme.light'));
  assert.notEqual(translate('en', 'theme.currentDark'), translate('en', 'theme.dark'));
});

test('language button announces the destination language in each locale', () => {
  assert.equal(translate('it', 'language.switchToEnglish'), "Passa all'inglese");
  assert.equal(translate('en', 'language.switchToItalian'), 'Switch to Italian');
  for (const locale of ['it', 'en']) {
    for (const key of ['language.switchToEnglish', 'language.switchToItalian']) {
      assert.ok(translate(locale, key).length > 3);
    }
  }
});

test('desktop component chooses current-theme and target-language message keys', () => {
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(component, /get activeThemeLabel\(\): string \{ return this\.t\(this\.theme === 'light' \? 'theme\.currentLight' : 'theme\.currentDark'\); \}/);
  assert.match(component, /get languageToggleLabel\(\): string \{ return this\.t\(this\.locale === 'it' \? 'language\.switchToEnglish' : 'language\.switchToItalian'\); \}/);
});

test('language control uses its actionable label for assistive technology and tooltip', () => {
  const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(template, /\[attr\.aria-label\]="languageToggleLabel"/);
  assert.match(template, /\[attr\.title\]="languageToggleLabel"/);
  assert.match(template, /\(click\)="toggleLanguage\(\)"/);
});
