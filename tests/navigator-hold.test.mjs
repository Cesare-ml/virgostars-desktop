import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const component = read('src/app/desktop-app.component.ts');
const html = read('src/app/desktop-app.component.html');
const css = read('src/app/desktop-app.component.css');
const hold = component.match(/private beginHold\([\s\S]*?\n  holdStep\(/)?.[0] ?? '';

test('holding Indietro or Avanti keeps stepping: one step on press, then a steady repeat', () => {
  assert.match(component, /const HOLD_DELAY_MS = 350;/);
  assert.match(component, /const HOLD_REPEAT_MS = 90;/);
  assert.ok(hold.length > 300);
  assert.match(hold, /if \(!move\(\)\) return;/, 'the first step is immediate');
  assert.match(hold, /repeat\(HOLD_DELAY_MS\);/);
  assert.match(hold, /repeat\(HOLD_REPEAT_MS\);/);
});

test('the repeat ends when the button is released, at the edge of the years, or when the panel goes away', () => {
  assert.match(hold, /setPointerCapture\(event\.pointerId\)/, 'letting go anywhere is seen');
  assert.match(hold, /this\.destroyed \|\| this\.inspectorTab !== 'navigate' \|\| !move\(\)/);
  for (const handler of ['(pointerup)="stopHold()"', '(pointercancel)="stopHold()"', '(lostpointercapture)="stopHold()"']) {
    assert.ok(html.includes(handler), handler);
  }
  assert.match(component, /this\.stopHold\(\);/);
  assert.match(component, /private moveNav\(next: number \| null\): boolean/);
  assert.match(component, /if \(next === null\) \{ this\.navStatus = 'nav\.limit'; this\.cd\.markForCheck\(\); return false; \}/);
});

test('a mouse press moves once, not twice; the keyboard still works', () => {
  // The press does the step; the click that follows a pointer press is ignored, a keyboard click (detail 0) is not.
  assert.match(component, /clickStep\(event: MouseEvent, direction: 1 \| -1\): void \{ if \(event\.detail === 0\) this\.stepNav\(direction\); \}/);
  assert.match(html, /\(pointerdown\)="holdStep\(\$event, -1\)"[\s\S]*?\(click\)="clickStep\(\$event, -1\)"/);
  assert.match(html, /\(pointerdown\)="holdStep\(\$event, 1\)"[\s\S]*?\(click\)="clickStep\(\$event, 1\)"/);
  assert.match(component, /if \(event\.button !== 0\) return;/, 'only the primary button');
});

test('the clock fields are kept between redraws, so holding an arrow is not interrupted', () => {
  assert.match(html, /\*ngFor="let field of navFields; trackBy: trackNavField"/);
  assert.match(component, /trackNavField\(_index: number, field: \{key: NavField\}\): NavField \{ return field\.key; \}/);
});

test('the field arrows hold too, and the buttons do not select text or start a drag', () => {
  assert.match(html, /\(pointerdown\)="holdField\(\$event, field\.key, 1\)"/);
  assert.match(html, /\(pointerdown\)="holdField\(\$event, field\.key, -1\)"/);
  assert.match(css, /\.nav-back,\.nav-forward,\.nav-arrow \{ touch-action:none; user-select:none;/);
});

test('when a date cannot be calculated the clock goes back to the chart on screen and the hold stops', () => {
  const recompute = component.slice(component.indexOf('private async recomputeNav'));
  assert.match(recompute, /this\.stopHold\(\);\s+if \(this\.navShown && this\.nav\) this\.nav = \{\.\.\.this\.nav, current:this\.navShown\};/);
  assert.match(recompute, /this\.navShown = point;/, 'a success becomes the new reference');
  assert.match(component, /out_of_range:'calc\.range'/);
  assert.match(component, /this\.navShown = point;\n  \}/, 'starting navigation sets the reference');
});
