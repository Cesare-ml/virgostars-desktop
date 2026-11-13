import test from 'node:test';
import assert from 'node:assert/strict';
import {CorrectionHold, stepCivilCorrection} from '../src/app/natal-time-step.ts';

const at=(year,month,day,hour='12',minute='30',birthTimeKnown=true)=>({
  year:String(year),month:String(month),day:String(day),
  hour:String(hour),minute:String(minute),birthTimeKnown,
});
function next(input,field,direction) {return stepCivilCorrection(input,field,direction);}

test('day correction crosses leap February and year boundaries without DST logic',()=>{
  assert.deepEqual(next(at(2024,2,28),'day',1),
    {year:'2024',month:'2',day:'29',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2024,2,29),'day',1),
    {year:'2024',month:'3',day:'1',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2023,12,31),'day',1),
    {year:'2024',month:'1',day:'1',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2024,1,1),'day',-1),
    {year:'2023',month:'12',day:'31',hour:'12',minute:'30'});
});
test('hour and minute correction roll over to adjacent days in both directions',()=>{
  assert.deepEqual(next(at(2024,12,31,'23','59'),'minute',1),
    {year:'2025',month:'1',day:'1',hour:'00',minute:'00'});
  assert.deepEqual(next(at(2024,1,1,'00','00'),'minute',-1),
    {year:'2023',month:'12',day:'31',hour:'23',minute:'59'});
  assert.deepEqual(next(at(2026,3,1,'00','45'),'hour',-1),
    {year:'2026',month:'2',day:'28',hour:'23',minute:'45'});
});
test('month correction clamps invalid days, preserves known time and crosses years',()=>{
  assert.deepEqual(next(at(2024,1,31),'month',1),
    {year:'2024',month:'2',day:'29',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2023,1,31),'month',1),
    {year:'2023',month:'2',day:'28',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2024,12,31),'month',1),
    {year:'2025',month:'1',day:'31',hour:'12',minute:'30'});
});
test('year correction clamps February 29 in non-leap year',()=>{
  assert.deepEqual(next(at(2024,2,29),'year',1),
    {year:'2025',month:'2',day:'28',hour:'12',minute:'30'});
  assert.deepEqual(next(at(2000,2,29),'year',-1),
    {year:'1999',month:'2',day:'28',hour:'12',minute:'30'});
});
test('year 0050 is never silently shifted to year 1950',()=>{
  assert.deepEqual(next(at(50,6,5,'00','01'),'minute',-1),
    {year:'50',month:'6',day:'5',hour:'00',minute:'00'});
  assert.equal(next(at(1,1,1),'day',-1),null);
  assert.equal(next(at(9999,12,31),'day',1),null);
  assert.equal(next(at(9999,12,31),'year',1),null);
  assert.equal(next(at(1,1,1),'month',-1),null);
});
test('unknown birth time never receives a fabricated hour',()=>{
  const source=at(2026,3,10,'','','false');
  source.birthTimeKnown=false;
  assert.equal(next(source,'hour',1),null);
  assert.equal(next(source,'minute',-1),null);
  const changed=next(source,'day',1);
  assert.equal(changed.day,'11');
  assert.equal(changed.hour,'');
  assert.equal(changed.minute,'');
  // Unknown time must not become 00:00 even after day/month/year corrections.
});
test('partial and invalid input never receives hidden default dates',()=>{
  for(const bad of [
    at('','2','1'),at(2026,2,30),at(1900,2,29),at(2024,13,1),
    at(2024,1,1,'24','0'),at(2024,1,1,'0','60'),at(2024,1,1,'',''),
    at('2e3',1,1),at(2024,4,31)
  ]) assert.equal(next(bad,'day',1),null);
});
test('input fields are immutable and direction must be +/-1',()=>{
  const original=Object.freeze(at(2024,5,6));
  next(original,'minute',1);
  assert.deepEqual(original,at(2024,5,6));
  assert.equal(next(original,'minute',0),null);
  assert.equal(next(original,'minute',2),null);
});
function fakeTimer(){
  let nextId=0;
  const tasks=new Map();
  return {
    tasks,
    timer:{set:(callback,ms)=>{const id=++nextId;tasks.set(id,{callback,ms});return id;},
      clear:id=>tasks.delete(id)},
    fire(){const task=[...tasks.entries()][0];if(!task)return false;tasks.delete(task[0]);task[1].callback();return true;},
    nextDelay(){return [...tasks.values()][0]?.ms}
  };
}
test('one immediate step and at most one scheduled hold callback',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);let count=0;
  h.start(()=>{count++;return true;});
  assert.equal(count,1);
  assert.equal(f.tasks.size,1);
  assert.equal(f.nextDelay(),340);
  f.fire();
  assert.equal(count,2);
  assert.equal(f.nextDelay(),75);
  assert.equal(f.tasks.size,1);
  h.stop();
  assert.equal(f.tasks.size,0);
  assert.equal(h.running,false);
});
test('long hold speeds up but never queues more than one timer',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);let count=0;
  h.start(()=>{count++;return true;});
  for(let i=0;i<80;i++){assert.equal(f.tasks.size,1);f.fire();}
  assert.equal(count,81);
  assert.equal(f.nextDelay(),45);
  h.stop();assert.equal(f.tasks.size,0);
});
test('rapid direction reversal cancels the previous pending timer',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);const directions=[];
  h.start(()=>{directions.push(1);return true;});
  h.start(()=>{directions.push(-1);return true;});
  assert.deepEqual(directions,[1,-1]);
  assert.equal(f.tasks.size,1);
  f.fire();
  assert.deepEqual(directions,[1,-1,-1]);
  h.stop();assert.equal(f.tasks.size,0);
});
test('invalid/boundary value stops repeating immediately',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);let count=0;
  h.start(()=>++count<3);
  assert.equal(count,1);f.fire();assert.equal(count,2);f.fire();
  assert.equal(count,3);assert.equal(f.tasks.size,0);assert.equal(h.running,false);
});
test('dispose prevents any further adjustment or timer',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);let count=0;
  h.start(()=>{count++;return true;});h.dispose();
  assert.equal(f.tasks.size,0);
  h.start(()=>{count++;return true;});
  assert.equal(count,1);
});
test('stress: 10k repeat events do not accumulate pending jobs',()=>{
  const f=fakeTimer();const h=new CorrectionHold(f.timer);let count=0;
  h.start(()=>{count++;return true;});
  for(let i=0;i<10000;i++){f.fire();assert.ok(f.tasks.size<=1);}
  assert.equal(count,10001);
  h.dispose();assert.equal(f.tasks.size,0);
});
test('source controls cancel on all native pointer and blur events',async()=>{
  const {readFileSync}=await import('node:fs');
  const html=readFileSync(new URL('../src/app/natal-draft.component.html',import.meta.url),'utf8');
  const source=readFileSync(new URL('../src/app/natal-draft.component.ts',import.meta.url),'utf8');
  for(const event of ['pointerdown','pointerup','pointercancel','lostpointercapture','click']){
    assert.ok(html.includes('('+event+')'),event);
  }
  assert.match(source,/window:blur/);
  assert.match(source,/ngOnDestroy/);
  assert.match(source,/markForCheck/);
  assert.match(html,/natal.correction.preview/);
});
