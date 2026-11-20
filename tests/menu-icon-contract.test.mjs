import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const icons = read('src/app/menu-icon.component.ts');
const markup = read('src/app/desktop-app.component.html');
const desktop = read('src/app/desktop-app.component.ts');
const styles = read('src/app/desktop-app.component.css');

test('all four navigation marks are reusable stroke-only, accessible SVG symbols', () => {
  for (const name of ['solar-return', 'lunar-return', 'account-virgostars', 'monomeri']) {
    assert.match(icons, new RegExp('<g \\*ngSwitchCase="\\\'' + name + '\\\'">'));
  }
  assert.match(icons, /viewBox="0 0 24 24"/);
  assert.match(icons, /stroke="currentColor"/);
  assert.match(icons, /fill="none"/);
  assert.match(icons, /aria-hidden="true"/);
  assert.match(icons, /focusable="false"/);
  assert.match(desktop, /import \{ MenuIconComponent \} from '\.\/menu-icon\.component';/);
  assert.match(desktop, /imports:\[CommonModule, MenuIconComponent,/);
});

test('return marks have the same orbital return but distinct solar/lunar centers', () => {
  const item = name => icons.match(new RegExp('<g \\*ngSwitchCase="\\\'' + name + '\\\'">([\\s\\S]*?)<\\/g>'))?.[1] ?? '';
  const solar = item('solar-return');
  const lunar = item('lunar-return');
  assert.ok(solar && lunar);
  const orbit = 'M4.1 16.9A9 9 0 0 1 19.7 7.4';
  assert.ok(solar.includes(orbit));
  assert.ok(lunar.includes(orbit));
  assert.match(solar, /<circle/);
  assert.doesNotMatch(lunar, /<circle/);
});

test('account and all three function actions use their new icons', () => {
  const nav = markup.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.match(nav, /<vs-menu-icon name="account-virgostars"><\/vs-menu-icon>/);
  assert.doesNotMatch(nav, /nav-mark" aria-hidden="true">◯/);
  for (const [action,name] of [['solar_return','solar-return'], ['lunar_return','lunar-return'], ['monomeri','monomeri']]) {
    assert.ok(markup.includes(`*ngIf="entry.action==='${action}'" name="${name}"`));
  }
  assert.match(markup, /class="stage-menu-label"><vs-menu-icon name="monomeri"><\/vs-menu-icon>/);
  assert.match(styles, /\.function-line \{ justify-content:flex-start; gap:10px; \}/);
});
