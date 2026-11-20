import test from 'node:test';
import assert from 'node:assert/strict';
import {axisContactError,axisSamplerForBody,findAxisEvent} from '../src/app/astro/axis-events.ts';

test('angles follow the last ascendant before the reference, then the requested angle', async () => {
  const hour=3_600_000, day=24*hour;
  const sampler=async time=>({longitude:0,ascendant:((time/day*360)%360+360)%360,midheaven:((time/day*360-90)%360+360)%360});
  const reference=29*hour;
  for (const [axis,expected] of [['AS',24],['MC',30],['DS',36],['IC',42]]) {
    const result=await findAxisEvent(sampler,reference,axis);
    assert.ok(Math.abs(result-expected*hour)<1100,`${axis}: ${result}`);
  }
});

test('the resulting chart actually places the body on the selected axis',async()=>{
  const hour=3_600_000,day=24*hour;
  const sample=async t=>({longitude:((15+t/day*.98)%360+360)%360,
    ascendant:((t/day*360)%360+360)%360,midheaven:((t/day*360-95)%360+360)%360});
  const reference=day+12*hour;
  const previous=await findAxisEvent(sample,reference,'AS');
  assert.ok(previous<=reference);
  assert.ok(axisContactError(await sample(previous),'AS')<0.01);
  assert.ok(previous>reference-day-2*hour);
  for(const axis of ['MC','DS','IC']) {
    const event=await findAxisEvent(sample,reference,axis);
    assert.ok(event>previous);
    assert.ok(axisContactError(await sample(event),axis)<0.01);
  }
});

test('wrap at 180 degrees is not a conjunction and missing angles fail explicitly', async () => {
  const sampler=async time=>({longitude:0,ascendant:180+time/3_600_000,midheaven:0});
  const found=await findAxisEvent(sampler,0,'AS');
  assert.ok(found===null || found<0);
  await assert.rejects(findAxisEvent(async()=>({longitude:NaN,ascendant:0,midheaven:0}),0,'AS'));
});

test('selecting the Sun searches its own ascendant, not the previous Mars selection',async()=>{
  const hour=3_600_000, day=24*hour;
  const snapshot=async time=>({bodies:[{id:'Mars',longitudeDeg:180},{id:'Sun',longitudeDeg:60},
      {id:'true Node',longitudeDeg:30}],
    houses:[{ascendantDeg:((time/day*360)%360+360)%360,mcDeg:0}]});
  const reference=18*hour;
  const mars=await findAxisEvent(axisSamplerForBody('Mars',snapshot),reference,'AS');
  const sun=await findAxisEvent(axisSamplerForBody('Sun',snapshot),reference,'AS');
  const southNode=await findAxisEvent(axisSamplerForBody('true Node Sud',snapshot),reference,'AS');
  assert.ok(Math.abs(mars-12*hour)<1000);
  assert.ok(Math.abs(sun-4*hour)<1000);
  assert.ok(Math.abs(southNode-14*hour)<1000);
});
