import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment-timezone';
import {resolveCivilTime} from '../src/app/timezone-civil.ts';

// Exercise the actual bundled IANA data, in addition to synthetic interval tests.
const zone = moment.tz.zone('Europe/Rome');
function resolve(month, day, hour, minute) {
  assert.ok(zone, 'bundled tzdb must contain Europe/Rome');
  return resolveCivilTime({year:2024,month,day,hour,minute,birthTimeKnown:true}, zone, moment.tz.dataVersion);
}

test('bundled Rome data rejects the 2024 spring gap and exposes both autumn instants', () => {
  assert.equal(resolve(3,31,2,30).status, 'nonexistent');
  const fold = resolve(10,27,2,30);
  assert.equal(fold.status, 'ambiguous');
  assert.deepEqual(fold.candidates.map(c => c.isoUtc), [
    '2024-10-27T00:30:00.000Z', '2024-10-27T01:30:00.000Z',
  ]);
  assert.ok(fold.tzdbVersion);
});
