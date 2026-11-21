import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

test('macOS root and workspace always occupy the native viewport, not implicit grid rows', () => {
  const global=read('src/styles.css'), css=read('src/app/desktop-app.component.css');
  assert.match(global, /vs-desktop-app\s*\{[^}]*position:fixed;[^}]*inset:0;/s);
  assert.match(css, /:host\s*\{[^}]*position:fixed;[^}]*inset:0;/s);
  assert.match(css, /\.desktop-app\s*\{[^}]*position:relative;[^}]*width:100%; height:100%;/s);
  assert.match(css, /\.workspace\s*\{[^}]*position:absolute; inset:0; width:100%; height:100%; display:grid;/s);
  assert.match(css, /@media \(max-width:1140px\)/);
  assert.match(css, /@media \(max-width:760px\)/);
});

test('both native-window and chart-stage resizes update the wheel', () => {
  const app=read('src/app/desktop-app.component.ts');
  assert.match(app, /new ResizeObserver\(\(\) => this\.fitStage\(\)\)/);
  assert.match(app, /this\.resizeObserver\.observe\(this\.shell\.nativeElement\)/);
  assert.match(app, /this\.resizeObserver\.observe\(this\.stage\.nativeElement\)/);
  assert.match(app, /window\.dispatchEvent\(new Event\('resize'\)\)/);
});
