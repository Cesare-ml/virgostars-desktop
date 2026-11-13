import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestSyntheticCsvDownload, SYNTHETIC_CSV_REVOKE_DELAY_MS
} from '../src/app/synthetic-csv-download.ts';

function harness(options = {}) {
  const calls = [];
  let later;
  const port = {
    createUrl: csv => {
      calls.push(['create', csv]);
      if (options.fail === 'create') throw new Error('create unavailable');
      return 'blob:fictional-test';
    },
    click: (url, filename) => {
      calls.push(['click', url, filename]);
      if (options.fail === 'click') throw new Error('download blocked');
    },
    scheduleRevoke: (url, delay) => {
      calls.push(['schedule', url, delay]);
      if (options.fail === 'schedule') throw new Error('timer unavailable');
      later = () => port.revoke(url);
    },
    revoke: url => calls.push(['revoke', url]),
  };
  return { port, calls, runTimer: () => later?.() };
}

test('successful fictional CSV download requests a single delayed URL revocation', () => {
  const h = harness();
  requestSyntheticCsvDownload('FICTIONAL_NOT_CALCULATED', h.port);
  assert.deepEqual(h.calls, [
    ['create','FICTIONAL_NOT_CALCULATED'],
    ['click','blob:fictional-test','virgostars-FICTIONAL-NOT-CALCULATED.csv'],
    ['schedule','blob:fictional-test',30_000],
  ]);
  assert.equal(SYNTHETIC_CSV_REVOKE_DELAY_MS,30_000);
  h.runTimer();
  assert.deepEqual(h.calls.at(-1),['revoke','blob:fictional-test']);
  assert.equal(h.calls.filter(([kind]) => kind === 'revoke').length,1);
});

test('failed anchor click revokes allocated Blob URL immediately', () => {
  const h = harness({fail:'click'});
  assert.throws(() => requestSyntheticCsvDownload('fictional',h.port),/download blocked/);
  assert.deepEqual(h.calls.map(([kind]) => kind), ['create','click','revoke']);
});

test('failed timer registration revokes allocated Blob URL immediately', () => {
  const h = harness({fail:'schedule'});
  assert.throws(() => requestSyntheticCsvDownload('fictional',h.port),/timer unavailable/);
  assert.deepEqual(h.calls.map(([kind]) => kind), ['create','click','schedule','revoke']);
});

test('failed URL creation does not invoke anchor, timer or revoke unknown URL', () => {
  const h = harness({fail:'create'});
  assert.throws(() => requestSyntheticCsvDownload('fictional',h.port),/create unavailable/);
  assert.deepEqual(h.calls.map(([kind]) => kind), ['create']);
});

test('the portable helper has no network, storage or privileged native IPC', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('../src/app/synthetic-csv-download.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|\binvoke\s*\(|localStorage|sessionStorage|https?:\/\//);
});
