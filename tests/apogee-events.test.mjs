import test from 'node:test';
import assert from 'node:assert/strict';
import {findApogeeConjunctions} from '../src/app/astro/apogee-events.ts';

test('returns the preceding group in chronological order',async () => {
  const day=86400000, reference=100*day;
  const sample=async instant=>{
    const t=(instant-reference)/day;
    const difference=(t+20)*(t+16)*(t+12)/25;
    return {sun:100,apogee:100+Math.max(-90,Math.min(90,difference)),speed:t < -15 ? -0.4 : 0.4};
  };
  const result=await findApogeeConjunctions(sample,reference);
  assert.equal(result.length,3);
  for (const event of result) assert.ok(Math.abs(event.longitude-100)<.001);
  assert.deepEqual(result.map(event=>event.speed < 0),[true,true,false]);
  for (let i=1;i<result.length;i++) assert.ok(result[i].instant>result[i-1].instant);
});

test('does not invent a conjunction when none can be found',async()=>{
  await assert.rejects(findApogeeConjunctions(async()=>({sun:0,apogee:90,speed:0}),0));
});
