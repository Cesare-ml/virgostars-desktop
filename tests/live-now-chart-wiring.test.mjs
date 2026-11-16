import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const formContract = read('../src/app/new-chart-form.ts');
const formComponent = read('../src/app/new-chart.component.ts');
const desktop = read('../src/app/desktop-app.component.ts');
const translations = read('../src/app/translations.ts');

test('only the explicit Now action marks a chart as live', () => {
  assert.match(formContract, /liveNow\?: boolean/);
  assert.match(formComponent, /submitNow\(\)[\s\S]*?liveNow:\s*true/);
  assert.doesNotMatch(formContract, /resolveNewChart[\s\S]*?liveNow:\s*true/);
});

test('live refresh is minute-bounded and pauses while the WebView is hidden', () => {
  assert.match(desktop, /dueLiveNowMinute\(this\.deviceClock\.timestamp, this\.lastLiveNowMinute\)/);
  assert.match(desktop, /document\.visibilityState\s*===\s*'hidden'/);
  assert.match(desktop, /this\.refreshLiveNowChart\(\);/);
  assert.match(desktop, /private liveNowRefreshBusy\s*=\s*false/);
});

test('refresh uses the existing local provider path and preserves chart identity', () => {
  assert.match(desktop, /this\.computeChart\(input, null\)/);
  assert.match(desktop, /id:\s*previous\.id/);
  assert.match(desktop, /archiveId:\s*previous\.archiveId/);
  assert.match(desktop, /liveNow:\s*true/);
});

test('historical archive payload excludes the transient live marker', () => {
  const saveBlock = desktop.match(/async saveActiveChart\(\): Promise<void>[\s\S]*?\n  }/)?.[0] ?? '';
  assert.ok(saveBlock.length > 0);
  assert.match(saveBlock, /placeName:\s*chart\.placeName/);
  assert.match(saveBlock, /liveNow:false/);
  assert.match(saveBlock, /this\.liveNowRefreshBusy/);
});

test('live-state label is paired in Italian and English', () => {
  assert.match(translations, /"live\.now":"Cielo aggiornato in tempo reale"/);
  assert.match(translations, /"live\.now":"Live current sky"/);
});
