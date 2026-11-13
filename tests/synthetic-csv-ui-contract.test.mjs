import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('CSV export is wired only to the fictional inspector fixture, not a cloud or native IPC provider', () => {
  const source = read('src/app/desktop-app.component.ts');
  assert.match(source, /from '\.\/synthetic-csv-export'/);
  assert.match(source, /buildSyntheticChartCsv\(this\.planets,\s*this\.houses\)/);
  assert.match(source, /if \(this\.destroyed \|\| this\.exporting \|\| this\.mode !== 'natal'\) return;/);
  assert.match(source, /SYNTHETIC_CSV_FILENAME/);
  assert.match(source, /URL\.revokeObjectURL\(capturedUrl\)/);
  assert.doesNotMatch(source.slice(source.indexOf('  exportSyntheticCsv(): void'), source.indexOf('  private renderError')),
    /invoke\(|fetch\(|localStorage|sessionStorage|console\./);
});

test('accessible CSV toolbar button cannot be used for non-natal overlay views', () => {
  const html = read('src/app/desktop-app.component.html');
  assert.match(html, /class="toolbar-button csv-export-button" \[disabled\]="mode !== 'natal'"/);
  assert.match(html, /\(click\)="exportSyntheticCsv\(\)"/);
  assert.match(html, /\[attr\.title\]="t\('export\.csv\.note'\)"/);
  assert.match(html, /csvStatusLabel/);
  assert.match(html, /role="status"/);
});

test('Italian and English copy explicitly describe synthetic export and do not promise a saved file', () => {
  const strings = read('src/app/translations.ts');
  assert.equal((strings.match(/"export\.csv":/g) ?? []).length, 2);
  assert.equal((strings.match(/"export\.csv\.note":/g) ?? []).length, 2);
  assert.equal((strings.match(/"export\.csv\.started":/g) ?? []).length, 2);
  assert.equal((strings.match(/"export\.csv\.failed":/g) ?? []).length, 2);
  assert.match(strings, /Download CSV dimostrativo richiesto/);
  assert.match(strings, /Demo CSV download requested/);
});

test('fictional CSV exporter has no renderer dependency or astronomical calculation code', () => {
  const source = read('src/app/synthetic-csv-export.ts');
  assert.doesNotMatch(source, /from 'grafici-astrologici'|https?:\/\//);
  assert.match(source, /FICTIONAL_NOT_CALCULATED/);
  assert.match(source, /record_type,object_name,longitude_degrees,data_quality/);
});
