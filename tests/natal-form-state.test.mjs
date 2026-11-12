import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalFormState} from '../src/app/natal-form-state.ts';
import {NATAL_INPUT_TEXT} from '../src/app/natal-input-messages.ts';
const rome={id:1,name:'Firenze',latMicro:43769560,lngMicro:11255810,timeZone:'Europe/Rome'};
const lag=()=>new Promise(r=>setImmediate(r));
function harness(){
 const calls=[],inv={count:0},results=[];
 const port={invalidate(){inv.count++;},dispose(){inv.disposed=true;},submit(...args){calls.push(args);return results.shift()??{status:'submitted',requestSeq:calls.length,selection:{instantUtc:'2026-01-15T07:05:00.000Z'}};}};
 const state=new NatalFormState(port);
 return {state,calls,results,inv};
}
test('empty form cannot submit without a city',()=>{const h=harness();h.state.verify();assert.equal(h.state.status,'city_required');assert.equal(h.calls.length,0)});
test('missing zone cannot submit',()=>{const h=harness();h.state.setPlace({...rome,timeZone:null});h.state.verify();assert.equal(h.state.status,'zone_required');assert.equal(h.calls.length,0)});
test('edits invalidate previous queue work and clear stale choices',()=>{const h=harness();h.state.setPlace(rome);h.results.push({status:'choice_required',timeZone:'Europe/Rome',choices:[{instantUtc:'2026-10-25T00:30:00.000Z',offsetSeconds:7200}]});h.state.editDate('2026-10-25');h.state.editTime('02:30');h.state.verify();assert.equal(h.state.status,'choice_required');const n=h.inv.count;h.state.editTime('03:30');assert.equal(h.inv.count,n+1);assert.equal(h.state.choices.length,0);assert.equal(h.state.status,'idle')});
test('only an offered UTC instant can be chosen',()=>{const h=harness();h.state.setPlace(rome);h.results.push({status:'choice_required',timeZone:'Europe/Rome',choices:[{instantUtc:'2026-10-25T00:30:00.000Z',offsetSeconds:7200}]});h.state.verify();h.state.verify('2026-10-25T01:30:00.000Z');assert.equal(h.calls.length,1);h.state.verify('2026-10-25T00:30:00.000Z');assert.equal(h.calls.length,2);assert.equal(h.state.status,'pending')});
test('submitted requests use opaque per-submission keys and no names',()=>{const h=harness();h.state.setPlace(rome);h.state.editDate('2026-01-15');h.state.editTime('08:05');h.state.verify();assert.equal(h.state.status,'pending');assert.equal(h.calls[0][2],'ui_preview_1');assert.equal(JSON.stringify(h.calls[0]).includes('Firenze'),false);});
test('stale and matching queue outcomes are handled separately',()=>{const h=harness();h.state.setPlace(rome);h.state.verify();h.state.handleOutcome({kind:'ready',request:{requestSeq:5}});assert.equal(h.state.status,'pending');h.state.handleOutcome({kind:'ready',request:{requestSeq:1}});assert.equal(h.state.status,'invalid_reply')});
test('late outcome after edit does not override idle status',()=>{const h=harness();h.state.setPlace(rome);h.state.verify();h.state.editDate('2026-01-16');h.state.handleOutcome({kind:'unavailable',request:{requestSeq:1}});assert.equal(h.state.status,'idle')});
test('failed queue responses keep sanitized statuses',()=>{const h=harness();h.state.setPlace(rome);h.results.push({status:'queue_unavailable'});h.state.verify();assert.equal(h.state.status,'queue_unavailable')});
test('dispose clears transient birth details and prevents new submits',()=>{const h=harness();h.state.setPlace(rome);h.state.editDate('2026-01-15');h.state.editTime('08:05');h.state.dispose();h.state.verify();assert.equal(h.calls.length,0);assert.equal(h.state.place,null);assert.equal(h.state.date,'');assert.equal(h.inv.disposed,true)});
test('Italian and English natal text keys are aligned',()=>{assert.deepEqual(Object.keys(NATAL_INPUT_TEXT.it).sort(),Object.keys(NATAL_INPUT_TEXT.en).sort());for(const key of Object.keys(NATAL_INPUT_TEXT.it))assert.ok(NATAL_INPUT_TEXT.en[key]&&NATAL_INPUT_TEXT.it[key])});
import {readFileSync} from 'node:fs';
test('natal component exposes a guarded unavailable-only preview port',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const cmp=read('src/app/natal-input.component.ts');
 const tpl=read('src/app/natal-input.component.html');
 assert.match(cmp,/new CivilCalculationSession/);
 assert.match(cmp,/status:'unavailable'/);
 assert.doesNotMatch(cmp,/\binvoke\(|localStorage|sessionStorage|fetch\(/);
 assert.match(tpl,/\(submit\)="onVerify\(\$event\)"/);
 assert.match(tpl,/\(click\)="choose\(choice\.instantUtc\)"/);
});
