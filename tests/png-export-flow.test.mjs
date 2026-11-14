import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePngDataUrl, syntheticPngFilename} from '../src/app/png-export-safety.ts';
import {requestSyntheticPngDownload} from '../src/app/png-download.ts';

// Deliberately fictional 1x1 PNG. No real subject, ephemerides or user data.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YlxYy8AAAAASUVORK5CYII=';
const PNG_PREFIX = 'data:image/png;base64,';

function fakePort({failClick = null, failRemove = null} = {}) {
  const calls = [];
  const anchor = {
    href: '', download: '',
    click() { calls.push('click'); if (failClick) throw failClick; },
    remove() { calls.push('remove'); if (failRemove) throw failRemove; },
  };
  return {
    calls, anchor,
    port: {
      createAnchor() { calls.push('create'); return anchor; },
      appendAnchor(candidate) { assert.strictEqual(candidate, anchor); calls.push('append'); },
    },
  };
}

function exportSynthetic(rendererOutput, mode, theme, port) {
  // The Angular caller's order: validate first; create the filename second;
  // only then hand the payload to the DOM download adapter.
  const safePng = validatePngDataUrl(rendererOutput);
  const safeFilename = syntheticPngFilename(mode, theme);
  requestSyntheticPngDownload(safePng, safeFilename, port);
}

test('all eight synthetic mode/theme exports preserve the exact validated URL and filename', () => {
  for (const mode of ['natal', 'transits', 'synastry', 'latitude']) {
    for (const theme of ['light', 'dark']) {
      const h = fakePort();
      exportSynthetic(PNG, mode, theme, h.port);
      assert.deepEqual(h.calls, ['create', 'append', 'click', 'remove']);
      assert.equal(h.anchor.href, PNG);
      assert.equal(h.anchor.download, `virgostars-synthetic-${mode}-${theme}.png`);
    }
  }
});

test('unsafe renderer URLs and invalid filenames cannot allocate any anchor', () => {
  for (const url of [
    'javascript:alert(1)', 'https://example.invalid/chart.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', PNG + '\n',
  ]) {
    const h = fakePort();
    assert.throws(() => exportSynthetic(url, 'natal', 'light', h.port), /Invalid PNG export/);
    assert.deepEqual(h.calls, []);
  }
  for (const [mode, theme] of [['../../private', 'light'], ['natal', '../../dark'], ['unknown', 'dark']]) {
    const h = fakePort();
    assert.throws(() => exportSynthetic(PNG, mode, theme, h.port), /Invalid PNG export/);
    assert.deepEqual(h.calls, []);
  }
});

test('a PNG with a valid signature but corrupt IHDR CRC never reaches the DOM', () => {
  const bytes = Buffer.from(PNG.slice(PNG_PREFIX.length), 'base64');
  bytes[32] ^= 0x01; // Change only the stored header CRC, leaving signature/IHDR.
  const forged = PNG_PREFIX + bytes.toString('base64');
  const h = fakePort();
  assert.throws(() => exportSynthetic(forged, 'natal', 'light', h.port), /Invalid PNG export/);
  assert.deepEqual(h.calls, []);
});

test('when a click and cleanup both fail, the original click exception is preserved', () => {
  const clickFailure = new Error('synthetic click failed');
  const removeFailure = new Error('synthetic cleanup failed');
  const h = fakePort({failClick: clickFailure, failRemove: removeFailure});
  assert.throws(() => exportSynthetic(PNG, 'transits', 'dark', h.port),
    error => error === clickFailure);
  assert.deepEqual(h.calls, ['create', 'append', 'click', 'remove']);
});

test('click request completion is observable but cannot be mistaken for an OS save receipt', () => {
  const h = fakePort();
  const result = exportSynthetic(PNG, 'synastry', 'light', h.port);
  assert.equal(result, undefined);
  assert.equal(h.calls.filter(x => x === 'click').length, 1);
  assert.equal(h.calls.filter(x => x === 'remove').length, 1);
});
