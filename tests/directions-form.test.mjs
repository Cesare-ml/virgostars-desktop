import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDirectionPlan} from '../src/app/directions-form.ts';

test('fractional calendar years are based on the natal UTC time, not a fixed 365-day year', () => {
  let request;
  const capture = input => { request = input; return {degreeOffset:input.elapsedYears, directedUtcMillis:null}; };
  const result = makeDirectionPlan('2000-02-29T12:30:00.000Z', '2001-02-28', 'SYMBOLIC', capture);
  assert.equal(request.natalUtcMillis, Date.parse('2000-02-29T12:30:00.000Z'));
  assert.equal(request.elapsedYears, 1);
  assert.equal(result.degreeOffset, 1);
  assert.equal(request.birthTimeKnown, true);
});

test('invalid dates and failed method calls do not produce a direction', () => {
  const fail = () => { throw new Error('invalid'); };
  assert.equal(makeDirectionPlan('2000-01-01T12:00:00Z', '2026-02-30', 'SYMBOLIC', fail), null);
  assert.equal(makeDirectionPlan('invalid', '2026-01-01', 'SYMBOLIC', fail), null);
  assert.equal(makeDirectionPlan('2000-01-01T12:00:00Z', '2026-01-01', 'SYMBOLIC', fail), null);
});
