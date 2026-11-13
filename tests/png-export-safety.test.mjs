import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PNG_DATA_URL_BASE64_LENGTH, validatePngDataUrl, syntheticPngFilename} from '../src/app/png-export-safety.ts';

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YlxYy8AAAAASUVORK5CYII=';
const prefix = 'data:image/png;base64,';

const withChangedDimension = (offset, newValue) => {
  const data = Buffer.from(VALID_PNG.slice(prefix.length), 'base64');
  data.writeUInt32BE(newValue, offset);
  return prefix + data.toString('base64');
};

test('accepts a PNG-shaped data URL and returns it byte-for-byte unchanged', () => {
  assert.equal(validatePngDataUrl(VALID_PNG), VALID_PNG);
});

test('rejects external, active, non-PNG or empty download URLs', () => {
  for (const candidate of [null, undefined, {}, '', 'data:,', 'javascript:alert(1)',
    'https://example.test/chart.png', 'blob:https://example.test/a',
    'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=',
    VALID_PNG.replace('image/png', 'image/svg+xml'),
    VALID_PNG.replace('image/png', 'IMAGE/PNG')]) {
    assert.throws(() => validatePngDataUrl(candidate), /Invalid PNG export/);
  }
});

test('rejects malformed or truncated base64 and unsafe whitespace', () => {
  for (const candidate of [prefix, prefix + 'abcd', VALID_PNG.slice(0, -1),
    VALID_PNG + '\n', VALID_PNG + '<script>', VALID_PNG.replace('AAAANS', 'AAA NS'),
    VALID_PNG.replace('AAABCA', 'AAAB@A'), VALID_PNG + 'AAAA']) {
    assert.throws(() => validatePngDataUrl(candidate), /Invalid PNG export/);
  }
});

test('rejects non-PNG payload even when labeled image/png', () => {
  const text = Buffer.from('hello world '.repeat(8)).toString('base64');
  assert.throws(() => validatePngDataUrl(prefix + text), /Invalid PNG export/);
});

test('rejects missing IHDR length and signature', () => {
  const bytes = Buffer.from(VALID_PNG.slice(prefix.length), 'base64');
  const badIHDR = Buffer.from(bytes);
  badIHDR.writeUInt32BE(12, 8);
  assert.throws(() => validatePngDataUrl(prefix + badIHDR.toString('base64')), /Invalid PNG export/);
  const badSig = Buffer.from(bytes);
  badSig[0] = 0;
  assert.throws(() => validatePngDataUrl(prefix + badSig.toString('base64')), /Invalid PNG export/);
});

test('rejects zero or unreasonably large declared dimensions', () => {
  for (const sample of [withChangedDimension(16, 0), withChangedDimension(20, 0),
    withChangedDimension(16, 16385), withChangedDimension(20, 16385)]) {
    assert.throws(() => validatePngDataUrl(sample), /Invalid PNG export/);
  }
});

test('rejects excessive data URLs before decoding the image body', () => {
  const tooLarge = prefix + 'A'.repeat(MAX_PNG_DATA_URL_BASE64_LENGTH + 4);
  assert.throws(() => validatePngDataUrl(tooLarge), /Invalid PNG export/);
});

test('filenames are fixed to synthetic charts and known modes/themes', () => {
  for (const mode of ['natal','transits','synastry','latitude']) {
    for (const theme of ['light','dark']) {
      assert.equal(syntheticPngFilename(mode,theme),`virgostars-synthetic-${mode}-${theme}.png`);
    }
  }
  for (const [mode, theme] of [['../../secret','dark'], ['natal','dark.png'], ['natal',''], ['','light']]) {
    assert.throws(() => syntheticPngFilename(mode,theme), /Invalid PNG export/);
  }
});
