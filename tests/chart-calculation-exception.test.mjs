import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');

test('conversion exceptions are reduced to an opaque calculation failure', () => {
  assert.match(source, /private async computeChartSafely\(input: NewChartInput, archiveId: string \| null = null\): Promise<SessionChart \| MessageKey> \{\s*try \{\s*return await this\.computeChart\(input, archiveId\);\s*\} catch \{\s*return 'calc\.failed';\s*\}/);
});

test('natal and transit chart requests both use the exception boundary', () => {
  assert.match(source, /const chart = await this\.computeChartSafely\(input, archiveId\);/);
  assert.match(source, /const chart = await this\.computeChartSafely\(\{/);
  const callSites = source.match(/await this\.computeChartSafely\(/g) ?? [];
  assert.equal(callSites.length, 2);
});

test('stale completion guards and busy release remain in both request flows', () => {
  assert.match(source, /if \(this\.destroyed \|\| ticket !== this\.calcTicket\) return;\s*this\.calcBusy = false;/);
  assert.match(source, /if \(this\.destroyed \|\| ticket !== this\.calcTicket \|\| this\.activeChartId !== natal\.id\) return;\s*this\.calcBusy = false;/);
});
