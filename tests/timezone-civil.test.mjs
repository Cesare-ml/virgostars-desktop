import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/timezone-civil.ts';

const spring=Date.parse('2012-03-11T07:00:00Z');
const autumn=Date.parse('2012-11-04T06:00:00Z');
const ny={name:'America/New_York',untils:[spring,autumn,null],offsets:[300,240,300]};
const romeSpring=Date.parse('2024-03-31T01:00:00Z');
const romeAutumn=Date.parse('2024-10-27T01:00:00Z');
const rome={name:'Europe/Rome',untils:[romeSpring,romeAutumn,null],offsets:[-60,-120,-60]};
function c(year,month,day,hour,minute,known=true){
  return {year,month,day,hour:known?hour:null,minute:known?minute:null,birthTimeKnown:known};
}

test('ordinary New York winter time maps to a single exact UTC instant',()=>{
 const out=resolveCivilTime(c(2012,1,15,12,30),ny,'test-2012');
 assert.equal(out.status,'unique');
 assert.deepEqual(out.candidates.map(x=>x.isoUtc),['2012-01-15T17:30:00.000Z']);
 assert.equal(out.candidates[0].offsetMinutesEast,-300);
 assert.equal(out.tzdbVersion,'test-2012');
});

test('New York spring gap does not silently roll forward 02:30',()=>{
 const out=resolveCivilTime(c(2012,3,11,2,30),ny,'test');
 assert.equal(out.status,'nonexistent');
 assert.deepEqual(out.candidates,[]);
});

test('New York autumn fold explicitly presents both choices in UTC order',()=>{
 const out=resolveCivilTime(c(2012,11,4,1,30),ny,'test');
 assert.equal(out.status,'ambiguous');
 assert.deepEqual(out.candidates.map(x=>x.isoUtc),
 ['2012-11-04T05:30:00.000Z','2012-11-04T06:30:00.000Z']);
 assert.deepEqual(out.candidates.map(x=>x.offsetMinutesEast),[-240,-300]);
});

test('Rome 2024 spring and autumn handle hour gaps and folds without using tz_offs',()=>{
 assert.equal(resolveCivilTime(c(2024,3,31,2,30),rome,'test').status,'nonexistent');
 const autumn=resolveCivilTime(c(2024,10,27,2,30),rome,'test');
 assert.equal(autumn.status,'ambiguous');
 assert.deepEqual(autumn.candidates.map(x=>x.isoUtc),
 ['2024-10-27T00:30:00.000Z','2024-10-27T01:30:00.000Z']);
 assert.deepEqual(autumn.candidates.map(x=>x.offsetMinutesEast),[120,60]);
});

test('ordinary Rome summer noon has one candidate',()=>{
 const out=resolveCivilTime(c(2024,8,9,12,0),rome,'test');
 assert.deepEqual(out.candidates.map(x=>x.isoUtc),['2024-08-09T10:00:00.000Z']);
});

test('unknown birth time has no candidate even when zone is valid',()=>{
 const out=resolveCivilTime(c(2024,8,9,0,0,false),rome,'test');
 assert.equal(out.status,'unknown_birth_time');
 assert.equal(out.candidates.length,0);
});

test('missing zone never uses local machine timezone and never invents UTC',()=>{
 const out=resolveCivilTime(c(2024,8,9,12,0),null,'test');
 assert.equal(out.status,'zone_missing');
 assert.equal(out.timezone,null);
 assert.equal(out.candidates.length,0);
});

test('Gregorian invalid date is explicitly rejected',()=>{
 for(const input of [c(1900,2,29,12,0),c(2024,4,31,0,0),c(2024,1,1,24,0),c(0,1,1,0,0)]) {
   const out=resolveCivilTime(input,rome,'test');
   assert.equal(out.status,'invalid_date');
   assert.deepEqual(out.candidates,[]);
 }
});

test('year 0050 does not accidentally become year 1950',()=>{
 const utc={name:'UTC',untils:[null],offsets:[0]};
 const out=resolveCivilTime(c(50,6,5,12,0),utc,'test');
 assert.equal(out.status,'unique');
 assert.equal(out.candidates[0].isoUtc,'0050-06-05T12:00:00.000Z');
 assert.equal(out.caution,'pre_1970');
});

test('historical times and speculative future dates have explicit caution',()=>{
 assert.equal(resolveCivilTime(c(1969,1,1,10,0),rome,'test').caution,'pre_1970');
 assert.equal(resolveCivilTime(c(2040,1,1,10,0),rome,'test').caution,'future_rules');
 assert.equal(resolveCivilTime(c(2010,1,1,10,0),rome,'test').caution,null);
});

test('historical fractional minute offsets preserve seconds in UTC',()=>{
 const zone={name:'Synthetic/LMT',untils:[null],offsets:[-19.533333333333335]};
 const out=resolveCivilTime(c(1850,5,1,12,0),zone,'test');
 assert.equal(out.status,'unique');
 assert.equal(out.candidates[0].isoUtc,'1850-05-01T11:40:28.000Z');
});

test('invalid transition arrays fail closed, not with a guessed offset',()=>{
 for(const zone of [
  {name:'X',untils:[],offsets:[]},
  {name:'X',untils:[null,1000],offsets:[0,60]},
  {name:'X',untils:[200,100],offsets:[0,60]},
  {name:'X',untils:[null],offsets:[NaN]},
  {name:'X',untils:[null],offsets:[1500]},
  {name:'X',untils:[0],offsets:[0,60]},
 ]) assert.equal(resolveCivilTime(c(2024,1,1,1,0),zone,'test').status,'invalid_zone_data');
});

test('candidate selection is deterministic and never depends on browser zone',()=>{
 const f=()=>resolveCivilTime(c(2012,11,4,1,30),ny,'test');
 assert.deepEqual(f(),f());
 assert.equal(f().candidates[0].epochMs<f().candidates[1].epochMs,true);
});
