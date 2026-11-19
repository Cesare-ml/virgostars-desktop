import test from 'node:test';
import assert from 'node:assert/strict';
import * as astrology from 'astrological-functions';
import {makeDirectionPlan} from '../src/app/directions-form.ts';

test('desktop direction date is passed through the Regolo methods without a 365-day approximation',
  {skip: typeof astrology.calculateRegoloDirection !== 'function'}, () => {
    const birth = '2000-02-29T12:30:00.000Z';
    const primary = makeDirectionPlan(birth, '2001-02-28', 'SIMPLIFIED_PRIMARY', astrology.calculateRegoloDirection);
    const progressed = makeDirectionPlan(birth, '2001-02-28', 'SECONDARY_PROGRESSION', astrology.calculateRegoloDirection);
    assert.equal(primary.directedUtcMillis, Date.parse(birth) + 4 * 60_000);
    assert.equal(progressed.directedUtcMillis, Date.parse(birth) + 86_400_000);
    assert.equal(astrology.regoloSymbolicLongitude(1, -0.1, 2), 359);
  });
