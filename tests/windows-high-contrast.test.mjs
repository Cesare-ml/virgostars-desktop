import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const shell = source('src/app/desktop-app.component.css');
const city = source('src/app/offline-city-picker.component.css');
const globalCss = source('src/styles.css');

test('both desktop themes use OS contrast colors rather than authored palettes', () => {
  assert.match(shell, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(shell, /\.desktop-app,\s*\.desktop-app\[data-theme="dark"\]/);
  for (const [token, systemColor] of Object.entries({
    '--vs-bg': 'Canvas',
    '--vs-surface': 'Canvas',
    '--vs-text': 'CanvasText',
    '--vs-border': 'ButtonBorder',
    '--vs-focus': 'Highlight',
    '--vs-sidebar': 'Canvas',
    '--vs-accent': 'Highlight',
    '--vs-accent-contrast': 'HighlightText',
  })) {
    assert.ok(shell.includes(token + ':' + systemColor + ';'), token);
  }
});

test('selection and keyboard focus remain distinguishable when fills are forced', () => {
  for (const selector of ['.nav-item.selected', '.inspector-tabs button[aria-selected="true"]', '.data-line.active']) {
    assert.ok(shell.includes(selector), selector);
  }
  assert.match(shell, /outline:2px solid Highlight/);
  assert.match(shell, /\.nav-item:focus-visible\s*\{\s*outline:3px solid Highlight/);
  assert.match(city, /\.city-option\[aria-selected="true"\]/);
  assert.match(city, /\.city-input:focus-visible,\.city-option:focus-visible/);
  assert.match(city, /outline:3px solid Highlight/);
});

test('disabled controls retain OS contrast and no stylesheet suppresses forced colors', () => {
  assert.match(globalCss, /@media\s*\(forced-colors:\s*active\)/);
  assert.match(globalCss, /button:disabled\s*\{\s*opacity:1;\s*color:GrayText;/);
  for (const [name, css] of [['shell', shell], ['city picker', city], ['global', globalCss]]) {
    assert.doesNotMatch(css, /forced-color-adjust\s*:\s*none/i, name);
  }
});
