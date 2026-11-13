import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS, translate, displayThemeLabel, displayLanguageAction, displayMessage} from '../src/app/translations.ts';
import {parseDesktopShortcut} from '../src/app/desktop-shortcuts.ts';
import {formatEclipticLongitude} from '../src/app/format-longitude.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const key = code => ({
  code, altKey:true, shiftKey:true, ctrlKey:false, metaKey:false,
  repeat:false, target:{tagName:'BUTTON',closest:()=>null},
});

test('both locales retain identical nonempty keys for CSV, hotkeys and renderer messages', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const locale of ['it', 'en']) {
    for (const name of ['chart.failed','settings.theme.light','settings.theme.dark',
      'language.switchToEnglish','language.switchToItalian',
      'shortcuts.title','shortcuts.help','export.csv.started','export.csv.failed']) {
      assert.ok(translate(locale, name).trim(), locale + ' ' + name);
    }
  }
});

test('renderer error is retranslated when locale changes without losing its safe key', () => {
  const errorKey = 'chart.failed';
  const italian = displayMessage('it', errorKey);
  const english = displayMessage('en', errorKey);
  assert.equal(italian, translate('it', errorKey));
  assert.equal(english, translate('en', errorKey));
  assert.notEqual(italian, english);
  assert.equal(displayMessage('it', null), '');
  assert.equal(displayMessage('en', null), '');
});

test('active theme and target-language action are different from toggle labels', () => {
  assert.equal(displayThemeLabel('it','light'), 'Chiaro');
  assert.equal(displayThemeLabel('it','dark'), 'Scuro');
  assert.equal(displayThemeLabel('en','light'), 'Light');
  assert.equal(displayThemeLabel('en','dark'), 'Dark');
  assert.equal(displayLanguageAction('it'), "Passa all'inglese");
  assert.equal(displayLanguageAction('en'), 'Switch to Italian');
  assert.notEqual(displayThemeLabel('it','dark'), translate('it','theme.dark'));
});

test('keyboard chart actions and displayed numbers are independent of chosen language', () => {
  for (const locale of ['it','en']) {
    assert.deepEqual(parseDesktopShortcut(key('Digit2')),{kind:'mode',mode:'transits'});
    assert.deepEqual(parseDesktopShortcut(key('Digit0')),{kind:'fit'});
    assert.equal(formatEclipticLongitude(19.3,locale), locale === 'it' ? '19,3°' : '19.3°');
    assert.equal(parseDesktopShortcut({...key('Digit1'),target:{tagName:'INPUT'}}),null);
  }
});

test('integrated Angular shell keeps errors as keys and all three localized getters', () => {
  const app = read('src/app/desktop-app.component.ts');
  assert.match(app, /error: MessageKey \| null = null;/);
  assert.match(app, /this\.error='chart\.failed'/);
  assert.match(app, /this\.error=null/);
  assert.match(app, /get errorText\(\): string \{ return displayMessage\(this\.locale, this\.error\); \}/);
  assert.match(app, /get languageToggleLabel\(\): string \{ return displayLanguageAction\(this\.locale\); \}/);
  assert.match(app, /get activeThemeLabel\(\): string \{ return displayThemeLabel\(this\.locale, this\.theme\); \}/);
  assert.match(app, /parseDesktopShortcut\(event\)/);
  assert.match(app, /formatEclipticLongitude\(value, this\.locale\)/);
  assert.match(app, /createSyntheticCsvBrowserPort/);
});

test('integrated template uses live translated error, accessible language switch and hotkey legend', () => {
  const html = read('src/app/desktop-app.component.html');
  assert.match(html, /role="alert">\{\{errorText\}\}/);
  assert.match(html, /\[attr\.aria-label\]="languageToggleLabel"/);
  assert.match(html, /\[attr\.title\]="languageToggleLabel"/);
  assert.match(html, /t\('shortcuts\.help'\)/);
  assert.match(html, /formatDegrees\(planet\.longitude\)/);
  assert.match(html, /formatDegrees\(house\.longitude\)/);
  assert.match(html, /exportSyntheticCsv\(\)/);
});
