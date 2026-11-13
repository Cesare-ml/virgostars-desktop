import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePngDataUrl, syntheticPngFilename } from '../src/app/png-export-safety.ts';
import { requestSyntheticPngDownload } from '../src/app/png-download.ts';

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YlxYy8AAAAASUVORK5CYII=';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('synthetic PNG output carries exact validated data URL and mode/theme filename', () => {
  for (const mode of ['natal','transits','synastry','latitude']) {
    for (const theme of ['light','dark']) {
      const actions = [];
      const anchor = {
        href: '', download: '',
        click() { actions.push(['click',this.href,this.download]); },
        remove() { actions.push(['remove']); },
      };
      const url = validatePngDataUrl(VALID_PNG);
      const name = syntheticPngFilename(mode,theme);
      requestSyntheticPngDownload(url,name,{
        createAnchor: () => anchor,
        appendAnchor: element => { assert.equal(element,anchor); actions.push(['append']); },
      });
      assert.deepEqual(actions,[
        ['append'],['click',VALID_PNG,`virgostars-synthetic-${mode}-${theme}.png`],['remove'],
      ]);
    }
  }
});

test('invalid renderer payload fails before a download is requested', () => {
  let requested = false;
  for (const value of [null, '', 'https://example.invalid/chart.png', 'data:image/svg+xml;base64,PGgxPg==']) {
    assert.throws(() => {
      const url = validatePngDataUrl(value);
      requested = true;
      requestSyntheticPngDownload(url,'virgostars-synthetic-natal-light.png',{
        createAnchor: () => { throw new Error('unexpected'); },
        appendAnchor: () => { throw new Error('unexpected'); },
      });
    }, /Invalid PNG export/);
  }
  assert.equal(requested,false);
});

test('validation rejects arbitrary filenames before a download is requested', () => {
  for (const [mode,theme] of [['../secret','light'],['natal','external'],['','dark']]) {
    assert.throws(() => syntheticPngFilename(mode,theme), /Invalid PNG export/);
  }
});

test('Angular PNG path validates payload and immutable filename before touching the browser', () => {
  const source = read('src/app/desktop-app.component.ts');
  const png = source.slice(source.indexOf('  async exportPng()'),source.indexOf('  exportSyntheticCsv()'));
  assert.match(source, /from '\.\/png-export-safety'/);
  assert.match(source, /from '\.\/png-download'/);
  assert.ok(png.indexOf('const exportMode = this.mode') < png.indexOf('await this.renderer.generaImmagine'));
  assert.ok(png.indexOf('const exportTheme = this.theme') < png.indexOf('await this.renderer.generaImmagine'));
  assert.ok(png.indexOf('validatePngDataUrl(png)') < png.indexOf('requestSyntheticPngDownload('));
  const safeFilename = png.search(/syntheticPngFilename\(exportMode,\s*exportTheme\)/);
  assert.ok(safeFilename >= 0 && safeFilename < png.indexOf('requestSyntheticPngDownload('));
  assert.match(png, /appendAnchor: anchor => \{ document\.body\.appendChild\(anchor\); \}/);
  assert.doesNotMatch(png, /link\.href\s*=\s*png|fetch\(|invoke\(|localStorage|sessionStorage|console\./);
  assert.match(png, /if\(this\.destroyed\) return;/);
});

test('merged desktop retains shortcut guards, localized inspector and the existing synthetic CSV port', () => {
  const source = read('src/app/desktop-app.component.ts');
  assert.match(source, /HostListener\('window:keydown', \['\$event'\]\)/);
  assert.match(source, /parseDesktopShortcut\(event\)/);
  assert.match(source, /formatEclipticLongitude\(value, this\.locale\)/);
  assert.match(source, /createSyntheticCsvBrowserPort/);
  assert.match(source, /buildSyntheticChartCsv\(this\.planets, this\.houses\)/);
  assert.match(source, /this\.destroyed \|\| this\.exporting/);
  assert.match(source, /displayMessage\(/);
});

test('merged template preserves bilingual shortcuts, CSV, PNG and inspector data views', () => {
  const template = read('src/app/desktop-app.component.html');
  const translations = read('src/app/translations.ts');
  assert.match(template, /exportPng\(\)/);
  assert.match(template, /exportSyntheticCsv\(\)/);
  assert.match(template, /t\('shortcuts\.title'\)/);
  assert.match(template, /formatDegrees\(planet\.longitude\)/);
  assert.match(template, /formatDegrees\(house\.longitude\)/);
  for (const key of ['shortcuts.title','export.csv','export']) {
    const escaped = key.replaceAll('.','\\.');
    const expression = new RegExp('"' + escaped + '":','g');
    assert.equal((translations.match(expression) ?? []).length,2,key+' IT/EN');
  }
});
