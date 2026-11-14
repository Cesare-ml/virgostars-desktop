import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSyntheticPngDownload} from '../src/app/png-download.ts';

const PNG_URL = 'data:image/png;base64,synthetic-placeholder';
const PNG_NAME = 'virgostars-synthetic-natal-light.png';

function failingPort(failAt) {
  const original = new Error('original ' + failAt);
  const cleanup = new Error('cleanup failed');
  let removals = 0;
  let clicks = 0;
  const anchor = {
    set href(_value) { if (failAt === 'href') throw original; },
    set download(_value) { if (failAt === 'download') throw original; },
    click() { clicks++; if (failAt === 'click') throw original; },
    remove() { removals++; throw cleanup; },
  };
  return {
    original, cleanup,
    get removals() { return removals; },
    get clicks() { return clicks; },
    port: {
      createAnchor() { if (failAt === 'create') throw original; return anchor; },
      appendAnchor(value) {
        assert.strictEqual(value, anchor);
        if (failAt === 'append') throw original;
      },
    },
  };
}

for (const phase of ['href', 'download', 'append', 'click']) {
  test(`original ${phase} error survives a second failure during cleanup`, () => {
    const context = failingPort(phase);
    assert.throws(
      () => requestSyntheticPngDownload(PNG_URL, PNG_NAME, context.port),
      error => error === context.original,
    );
    assert.equal(context.removals, 1, 'cleanup is attempted exactly once');
    assert.equal(context.clicks, phase === 'click' ? 1 : 0);
  });
}

test('cleanup-only error remains visible after a successful click request', () => {
  const context = failingPort(null);
  assert.throws(
    () => requestSyntheticPngDownload(PNG_URL, PNG_NAME, context.port),
    error => error === context.cleanup,
  );
  assert.equal(context.removals, 1);
  assert.equal(context.clicks, 1);
});

test('anchor creation errors cannot trigger cleanup on a missing element', () => {
  const context = failingPort('create');
  assert.throws(
    () => requestSyntheticPngDownload(PNG_URL, PNG_NAME, context.port),
    error => error === context.original,
  );
  assert.equal(context.removals, 0);
  assert.equal(context.clicks, 0);
});
