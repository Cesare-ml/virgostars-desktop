import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySyncedBirth} from '../src/app/native/sync-civil-time.ts';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';

const birth={localDate:'1984-03-25',localTime:null,timeUnknown:true,timeZoneIana:'Europe/Rome',resolvedInstantUtc:null,utcOffsetSeconds:null};
const classify=overrides=>classifySyncedBirth({...birth,...overrides},resolveCivilTime);

test('unknown time remains unknown without choosing midnight or calling the resolver',()=>{
  const result=classifySyncedBirth(birth,()=>{throw new Error('must not resolve');});
  assert.equal(result.kind,'unknown');
  assert.equal(result.source.localTime,null);
  assert.equal(result.source.resolvedInstantUtc,null);
  assert.ok(Object.isFrozen(result.source));
  assert.equal(classify({localTime:'00:00:00'}).kind,'invalid');
  assert.equal(classify({localDate:'1984-02-30'}).kind,'invalid');
});

test('DST gaps and folds require review while a unique time resolves',()=>{
  assert.equal(classify({localDate:'2024-03-31',localTime:'02:30:00',timeUnknown:false}).reason,'nonexistent');
  assert.equal(classify({localDate:'2024-10-27',localTime:'02:30:00',timeUnknown:false}).reason,'ambiguous');
  const unique=classify({localDate:'2024-02-01',localTime:'12:00:00',timeUnknown:false});
  assert.equal(unique.kind,'resolved');
  assert.equal(unique.instantUtc,'2024-02-01T11:00:00.000Z');
});

test('an explicit instant must agree with a real time-zone choice',()=>{
  const fields={localDate:'2024-10-27',localTime:'02:30:00',timeUnknown:false};
  assert.equal(classify({...fields,resolvedInstantUtc:'2024-10-27T00:30:00.000Z',utcOffsetSeconds:7200}).kind,'resolved');
  assert.equal(classify({...fields,resolvedInstantUtc:'2024-10-27T00:30:00.000Z',utcOffsetSeconds:3600}).reason,'inconsistent_instant');
  assert.equal(classify({...fields,timeZoneIana:null}).reason,'missing_zone');
});
