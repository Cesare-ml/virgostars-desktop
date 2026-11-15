import test from 'node:test';
import assert from 'node:assert/strict';
import {DeviceClockTextCache, formatDeviceClock} from '../src/app/device-clock.ts';

test('repeated Angular getters format each clock variant only once per instant', () => {
  const calls=[];
  const cache=new DeviceClockTextCache((ms, locale, compact)=>{
    calls.push([ms,locale,compact]);
    return `${locale}:${ms}:${compact}`;
  });
  for(let i=0;i<100;i++) {
    assert.equal(cache.text(1000,'it'),'it:1000:false');
    assert.equal(cache.text(1000,'it',true),'it:1000:true');
  }
  assert.deepEqual(calls,[[1000,'it',false],[1000,'it',true]]);
});

test('changing sampled time or language invalidates both cached strings', () => {
  const calls=[];
  const cache=new DeviceClockTextCache((ms,locale,compact)=>{
    calls.push([ms,locale,compact]);
    return `${locale}:${ms}:${compact}`;
  });
  assert.equal(cache.text(1000,'it',true),'it:1000:true');
  assert.equal(cache.text(1000,'it'),'it:1000:false');
  assert.equal(cache.text(2000,'it',true),'it:2000:true');
  assert.equal(cache.text(2000,'en'),'en:2000:false');
  assert.equal(cache.text(2000,'en',true),'en:2000:true');
  assert.equal(calls.length,5);
});

test('invalid readings are cached but safely re-evaluated when clock recovers', () => {
  let calls=0;
  const cache=new DeviceClockTextCache((ms,locale,compact)=>{
    calls++;
    return formatDeviceClock(ms,locale,compact);
  });
  for(let i=0;i<10;i++) assert.equal(cache.text(NaN,'it'),'—');
  assert.equal(calls,1);
  const instant=Date.parse('2026-11-12T16:31:10Z');
  assert.equal(cache.text(instant,'en'),formatDeviceClock(instant,'en'));
  assert.equal(cache.text(instant,'en',true),formatDeviceClock(instant,'en',true));
  assert.equal(calls,3);
});

test('real clock formatting remains timezone-aware across winter/summer instants', () => {
  const cache=new DeviceClockTextCache();
  const jan=Date.parse('2026-01-12T12:00:00Z');
  const jul=Date.parse('2026-07-12T12:00:00Z');
  assert.equal(cache.text(jan,'it'),formatDeviceClock(jan,'it'));
  assert.equal(cache.text(jul,'it'),formatDeviceClock(jul,'it'));
  assert.equal(cache.text(jul,'en',true),formatDeviceClock(jul,'en',true));
});
