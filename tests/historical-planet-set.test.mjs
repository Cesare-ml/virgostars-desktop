import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePlanetSet} from '../src/app/historical-planet-set.ts';

const request = Object.freeze({body:'Sun', year:-500, month:7, day:1, hour:12, minute:0, second:30.5,
  deltaT:Object.freeze({kind:'supplied', seconds:10000, uncertaintySeconds:500, source:'synthetic'}), includeScenarios:true});
const bodies = ['Sun', 'Moon', 'Mars'];
const planet = body => ({body, jdUt1:123, jdTt:124, jdTdb:125, deltaTSeconds:10000,
  uncertaintySeconds:500, deltaTSource:'synthetic', longitudeDeg:100, latitudeDeg:1, distanceAu:1});

test('calculates every body with the same epoch and time source', async () => {
  const calls = [];
  const result = await calculatePlanetSet(request, bodies, async r => {
    calls.push(r);
    return {kind:'ready', planet:planet(r.body)};
  }, () => false);
  assert.equal(result.kind, 'ready');
  assert.deepEqual(result.planets.map(p => p.body), bodies);
  assert.ok(Object.isFrozen(result.planets));
  for (const [index, r] of calls.entries()) assert.deepEqual(r, {...request, body:bodies[index]});
});

test('reports the failing body without displaying an incomplete set', async () => {
  const called = [];
  const result = await calculatePlanetSet(request, bodies, async r => {
    called.push(r.body);
    return r.body === 'Moon' ? {kind:'calculation_failed'} : {kind:'ready', planet:planet(r.body)};
  }, () => false);
  assert.deepEqual(result, {kind:'failed', body:'Moon', reason:'calculation_failed'});
  assert.deepEqual(called, ['Sun', 'Moon']);
});

test('rejects inconsistent epoch or source instead of mixing results', async () => {
  for (const changed of [{jdUt1:124}, {deltaTSeconds:9999}, {uncertaintySeconds:1},
    {deltaTSource:'other'}, {uncertaintySource:'other'}, {usnoSourceError:{seconds:0}}]) {
    const result = await calculatePlanetSet(request, bodies, async r => ({kind:'ready',
      planet:{...planet(r.body), ...(r.body === 'Moon' ? changed : {})}}), () => false);
    assert.deepEqual(result, {kind:'failed', body:'Moon', reason:'unavailable'});
  }
});

test('cancellation stops the remaining calls and suppresses their results', async () => {
  let cancelled = false;
  const called = [];
  const result = await calculatePlanetSet(request, bodies, async r => {
    called.push(r.body); cancelled = true;
    return {kind:'ready', planet:planet(r.body)};
  }, () => cancelled);
  assert.deepEqual(result, {kind:'cancelled'});
  assert.deepEqual(called, ['Sun']);
});
