import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the chart toolbar does not display a device clock', () => {
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  const toolbar = html.match(/<div class="stage-tools"[^>]*>[\s\S]*?<button type="button"/)?.[0] ?? '';
  assert.ok(toolbar.includes('stage-tools'));
  assert.doesNotMatch(toolbar, /device-clock|clockText|<time/);
});
