import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STRINGS, displayLanguageAction, displayMessage, displayThemeLabel, translate,
} from '../src/app/translations.ts';

test('IT/EN dictionaries have identical keys with nonempty labels', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const key of Object.keys(STRINGS.it)) {
    assert.ok(translate('it', key).trim(), key);
    assert.ok(translate('en', key).trim(), key);
  }
});

test('language action is described in current language and points at the destination', () => {
  assert.equal(displayLanguageAction('it'), "Passa all'inglese");
  assert.equal(displayLanguageAction('en'), 'Switch to Italian');
  assert.notEqual(displayLanguageAction('it'), displayLanguageAction('en'));
  assert.equal(displayLanguageAction('it'), translate('it', 'language.switchToEnglish'));
  assert.equal(displayLanguageAction('en'), translate('en', 'language.switchToItalian'));
});

test('theme state labels are not confused with the theme-switch action', () => {
  assert.equal(displayThemeLabel('it', 'light'), 'Chiaro');
  assert.equal(displayThemeLabel('it', 'dark'), 'Scuro');
  assert.equal(displayThemeLabel('en', 'light'), 'Light');
  assert.equal(displayThemeLabel('en', 'dark'), 'Dark');
  assert.notEqual(displayThemeLabel('it', 'dark'), translate('it', 'theme.dark'));
});

test('stored error key is retranslated after switching locale without original error details', () => {
  const key = 'chart.failed';
  assert.equal(displayMessage('it', key), translate('it', key));
  assert.equal(displayMessage('en', key), translate('en', key));
  assert.notEqual(displayMessage('it', key), displayMessage('en', key));
  assert.equal(displayMessage('it', null), '');
  assert.equal(displayMessage('en', null), '');
});

test('the Angular component delegates theme, language action and error display to pure helpers', () => {
  const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(source, /get languageToggleLabel\(\): string \{ return displayLanguageAction\(this\.locale\); \}/);
  assert.match(source, /get activeThemeLabel\(\): string \{ return displayThemeLabel\(this\.locale, this\.theme\); \}/);
  assert.match(source, /get errorText\(\): string \{ return displayMessage\(this\.locale, this\.error\); \}/);
  assert.match(source, /error: MessageKey \| null = null;/);
  assert.match(source, /this\.error='chart\.failed'/);
});

test('the template announces the language destination and displays localized failures', () => {
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  assert.match(html, /\[attr\.aria-label\]="languageToggleLabel"/);
  assert.match(html, /\[attr\.title\]="languageToggleLabel"/);
  assert.match(html, /\(click\)="toggleLanguage\(\)"/);
  assert.match(html, /role="alert">\{\{errorText\}\}/);
});
