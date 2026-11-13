import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticCsvBrowserPort } from '../src/app/synthetic-csv-browser-port.ts';
import { requestSyntheticCsvDownload, SYNTHETIC_CSV_REVOKE_DELAY_MS } from '../src/app/synthetic-csv-download.ts';

const FILENAME = 'virgostars-FICTIONAL-NOT-CALCULATED.csv';
const CSV = 'planet,Sun,19.3,FICTIONAL_NOT_CALCULATED\r\n';

function harness(failAt = null) {
  const events = [];
  const timers = [];
  let anchor;
  const env = {
    createBlob: text => {
      if (failAt === 'blob') throw new Error('blob');
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      events.push(['blob', blob]);
      return blob;
    },
    createObjectUrl: blob => {
      if (failAt === 'url') throw new Error('url');
      events.push(['createUrl', blob]);
      return 'blob:fixture-export';
    },
    revokeObjectUrl: url => events.push(['revoke', url]),
    createAnchor: () => {
      if (failAt === 'anchor') throw new Error('anchor');
      anchor = {
        href: '', download: '',
        click() {
          events.push(['click', this.href, this.download]);
          if (failAt === 'click') throw new Error('click');
        },
        remove() { events.push(['remove']); },
      };
      return anchor;
    },
    appendAnchor: a => {
      assert.equal(a, anchor);
      events.push(['append']);
      if (failAt === 'append') throw new Error('append');
    },
    schedule: (fn, delay) => {
      if (failAt === 'schedule') throw new Error('schedule');
      timers.push({ fn, delay });
      events.push(['schedule', delay]);
    },
  };
  return { port: createSyntheticCsvBrowserPort(env), events, timers, get anchor() { return anchor; } };
}

test('actual browser port creates CSV Blob, clicks named link and defers URL cleanup', async () => {
  const h = harness();
  requestSyntheticCsvDownload(CSV, FILENAME, h.port);
  assert.equal(h.events[0][0], 'blob');
  assert.equal(h.events[0][1].type, 'text/csv;charset=utf-8');
  assert.equal(await h.events[0][1].text(), CSV);
  assert.deepEqual(h.events.slice(2), [
    ['append'], ['click', 'blob:fixture-export', FILENAME], ['remove'],
    ['schedule', SYNTHETIC_CSV_REVOKE_DELAY_MS],
  ]);
  assert.equal(h.timers.length, 1);
  assert.deepEqual(h.events.filter(e => e[0] === 'revoke'), []);
  h.timers[0].fn();
  assert.deepEqual(h.events.at(-1), ['revoke', 'blob:fixture-export']);
});

for (const failure of ['blob', 'url', 'anchor', 'append', 'click', 'schedule']) {
  test(`browser port fails closed and releases owned resources after ${failure} failure`, () => {
    const h = harness(failure);
    assert.throws(() => requestSyntheticCsvDownload(CSV, FILENAME, h.port), { message: failure });
    const allocated = !['blob', 'url'].includes(failure);
    assert.deepEqual(h.events.filter(e => e[0] === 'revoke'),
      allocated ? [['revoke', 'blob:fixture-export']] : []);
    assert.deepEqual(h.events.filter(e => e[0] === 'remove'),
      ['append', 'click', 'schedule'].includes(failure) ? [['remove']] : []);
    assert.equal(h.timers.length, 0);
  });
}

test('a completed download request does not revoke its URL early when a new one starts', () => {
  const h = harness();
  requestSyntheticCsvDownload(CSV, FILENAME, h.port);
  requestSyntheticCsvDownload(CSV, FILENAME, h.port);
  assert.equal(h.timers.length, 2);
  assert.equal(h.events.filter(e => e[0] === 'revoke').length, 0);
  h.timers.forEach(timer => timer.fn());
  assert.equal(h.events.filter(e => e[0] === 'revoke').length, 2);
});
