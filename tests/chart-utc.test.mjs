import test from 'node:test';
import assert from 'node:assert/strict';
import { validChartUtcIso } from '../src/app/native/chart-utc.ts';
import { validChartRequest } from '../src/app/native/chart-calculation-contract.ts';
import { validChartRecord } from '../src/app/native/chart-archive-contract.ts';

const position = {latMicro: 44_697_805, lngMicro: 11_805_778};
const archive = {id:'11111111-1111-4111-8111-111111111111',name:'Test',
  timeZone:'Europe/Rome',placeName:'Test place',...position};

function both(utcIso, expected) {
  assert.equal(validChartUtcIso(utcIso), expected, String(utcIso));
  assert.equal(validChartRequest({utcIso,...position}), expected, 'calculation '+String(utcIso));
  assert.equal(validChartRecord({...archive,utcIso}), expected, 'archive '+String(utcIso));
}

test('shared Gregorian UTC validator accepts the native Rust boundary dates and leap years', () => {
  for (const date of [
    '1600-01-01T00:00:00Z', '2000-02-29T23:59:59.999Z',
    '2004-02-29T12:00:00Z', '2400-12-31T23:59:59Z',
  ]) both(date, true);
});

test('both IPC paths reject impossible dates before native invocation', () => {
  for (const date of [
    '1599-12-31T23:59:59Z', '2401-01-01T00:00:00Z',
    '1900-02-29T00:00:00Z', '2100-02-29T00:00:00Z',
    '2001-02-29T00:00:00Z', '2001-04-31T00:00:00Z',
    '2001-00-01T00:00:00Z', '2001-13-01T00:00:00Z',
    '2001-01-00T00:00:00Z', '2001-01-32T00:00:00Z',
    '2001-01-01T24:00:00Z', '2001-01-01T23:60:00Z',
    '2001-01-01T23:59:60Z', '2001-01-01T23:59:59.1Z',
    '2001-01-01T23:59:59.1234Z', '2001-01-01T23:59:59+01:00',
    '2001-01-01 23:59:59Z', '２００１-01-01T00:00:00Z',
    '', null, undefined, 1234,
  ]) both(date, false);
});
