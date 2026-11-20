import test from 'node:test';
import assert from 'node:assert/strict';
import {findApogeeConjunctions} from '../src/app/astro/apogee-events.ts';

test('returns the preceding group in chronological order',async () => {
  const day=86400000, reference=100*day;
  const sample=async instant=>{
    const t=(instant-reference)/day;
    const difference=(t+20)*(t+16)*(t+12)/25;
    return {sun:100,apogee:100+Math.max(-90,Math.min(90,difference))};
  };
  const result=await findApogeeConjunctions(sample,reference);
  assert.equal(result.length,3);
  for (const longitude of result) assert.ok(Math.abs(longitude-100)<.001);
});

test('does not invent a conjunction when none can be found',async()=>{
  await assert.rejects(findApogeeConjunctions(async()=>({sun:0,apogee:90}),0));
});
