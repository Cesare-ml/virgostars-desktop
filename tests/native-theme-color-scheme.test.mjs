import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../src/app/desktop-app.component.css', import.meta.url), 'utf8');
const globalCss = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');

function declarations(source, selector) {
  const opening = selector + ' {';
  const first = source.indexOf(opening);
  assert.notEqual(first, -1, 'missing CSS selector: ' + selector);
  assert.equal(source.indexOf(opening, first + opening.length), -1,
    'duplicate CSS selector: ' + selector);
  const end = source.indexOf('}', first + opening.length);
  assert.notEqual(end, -1, 'unterminated CSS selector: ' + selector);
  return source.slice(first + opening.length, end);
}

test('light native widgets are the deterministic Desktop and document defaults', () => {
  assert.match(declarations(globalCss, ':root'), /\bcolor-scheme:\s*light\s*;/);
  assert.match(declarations(css, '.desktop-app'), /\bcolor-scheme:\s*light\s*;/);
});

test('the explicit dark Desktop theme overrides the document light scheme', () => {
  const dark = declarations(css, '.desktop-app[data-theme="dark"]');
  assert.match(dark, /\bcolor-scheme:\s*dark\s*;/);
  assert.match(dark, /--vs-bg\s*:/);
  assert.match(declarations(css, '.desktop-app'), /--vs-bg\s*:/);
});

test('theme selector is driven by the existing saved preference and toggle, not OS preference', () => {
  assert.match(template, /\[attr\.data-theme\]="theme"/);
  assert.match(component, /theme:\s*UiTheme\s*=\s*this\.initialUiPreferences\.theme/);
  assert.match(component, /this\.theme\s*=\s*this\.theme === 'light' \? 'dark' : 'light'/);
  assert.match(component, /this\.persistUiPreferences\(\)/);
  assert.doesNotMatch(css, /@media\s*\(prefers-color-scheme\s*:/);
});
