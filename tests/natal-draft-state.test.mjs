import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gregorianDaysInMonth, NatalDraftState} from '../src/app/natal-draft-state.ts';

const place=Object.freeze({
  id:42,name:'Firenze',italianName:null,latMicro:43769560,lngMicro:11255810,
  population:360000,stateId:100,region:'Toscana',timeZone:'Europe/Rome',
  countryName:'Italia',countryCode:'IT',
});
function complete(state=new NatalDraftState()) {
  state.update('name','Example Person');
  state.update('year','2000');
  state.update('month','2');
  state.update('day','29');
  state.update('hour','13');
  state.update('minute','05');
  state.setPlace(place);
  return state;
}

test('new guest draft starts empty and is never an implied saved chart',()=>{
  const state=new NatalDraftState();
  assert.equal(state.preview,null);
  assert.equal(state.place,null);
  assert.equal(state.name,'');
  assert.equal(state.showPreview(),false);
  assert.deepEqual(state.issues,['name','date','time','place']);
});

test('complete known-time natal draft previews local civil values without inventing UTC',()=>{
  const state=complete();
  assert.equal(state.showPreview(),true);
  const p=state.preview;
  assert.equal(p.protocolVersion,1);
  assert.equal(p.civil.year,2000);
  assert.equal(p.civil.minute,5);
  assert.equal(p.utcResolution,'pending_historical_tzdb');
  assert.equal(p.place.source,'owned-world-cities');
  assert.equal(p.place.sourceId,42);
  assert.equal(p.place.countryCode,'IT');
  assert.equal(p.place.latMicro,43769560);
  assert.equal('utcTimestamp' in p,false);
});

test('leap-year and Gregorian century rules are validated precisely',()=>{
  assert.equal(gregorianDaysInMonth(2000,2),29);
  assert.equal(gregorianDaysInMonth(1900,2),28);
  assert.equal(gregorianDaysInMonth(2024,2),29);
  assert.equal(gregorianDaysInMonth(2023,2),28);
  assert.equal(gregorianDaysInMonth(2024,4),30);
  assert.equal(gregorianDaysInMonth(0,1),0);
  assert.equal(gregorianDaysInMonth(2024,13),0);
});

test('rejects impossible February 29 1900 and April 31',()=>{
  const s=complete();
  s.update('year','1900');
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['date']);
  s.update('year','2026');s.update('month','4');s.update('day','31');
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['date']);
});

test('unknown birth time never acquires a fabricated noon, time or houses',()=>{
  const s=complete();
  s.update('hour','99');
  s.update('minute','99');
  s.setBirthTimeKnown(false);
  assert.equal(s.showPreview(),true);
  assert.equal(s.preview.civil.hour,null);
  assert.equal(s.preview.civil.minute,null);
  assert.equal(s.preview.utcResolution,'unknown_birth_time');
});

test('known birth time requires valid 24-hour minute values',()=>{
  const s=complete();
  s.update('hour','24');
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['time']);
  s.update('hour','23');s.update('minute','60');
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['time']);
});

test('local IANA zone is required for known-time preview, not guessed from offset',()=>{
  const s=complete();
  s.setPlace({...place,timeZone:null});
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['time_zone']);
  s.setPlace({...place,timeZone:'+0100'});
  assert.equal(s.showPreview(),false);
  assert.deepEqual(s.issues,['time_zone']);
  s.setPlace({...place,timeZone:'America/Argentina/Buenos_Aires'});
  assert.equal(s.showPreview(),true);
});

test('unknown birth time can be previewed with missing timezone while remaining unresolved',()=>{
  const s=complete();
  s.setPlace({...place,timeZone:null});
  s.setBirthTimeKnown(false);
  assert.equal(s.showPreview(),true);
  assert.equal(s.preview.place.timeZone,null);
  assert.equal(s.preview.utcResolution,'unknown_birth_time');
});

test('invalid coordinates, missing city and forged country code are not accepted',()=>{
  const s=complete();
  s.setPlace({...place,latMicro:91_000_000});
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['place']);
  s.setPlace({...place,countryCode:'ITA'});
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['place']);
  s.setPlace(null);
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['place']);
});

test('name and integer input are strictly validated and bounded in memory',()=>{
  const s=complete();
  s.update('name',' '.repeat(20));
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['name']);
  s.update('name','A'.repeat(160));
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['name']);
  s.update('name','Ada');
  s.update('day','1.5');
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['date']);
  s.update('day','29');s.update('year','2e3');
  assert.equal(s.showPreview(),false);assert.deepEqual(s.issues,['date']);
});

test('every edit invalidates a previous preview without mutating its saved snapshot',()=>{
  const s=complete();assert.equal(s.showPreview(),true);
  const old=s.preview;
  s.update('minute','06');
  assert.equal(s.preview,null);
  assert.equal(old.civil.minute,5);
  assert.equal(s.showPreview(),true);
  assert.equal(s.preview.civil.minute,6);
  s.setPlace({...place,id:99,name:'Another Place'});
  assert.equal(s.preview,null);
  assert.equal(old.place.sourceId,42);
});

test('clear resets all fields and old selection, with no browser or native storage',()=>{
  const s=complete();assert.equal(s.showPreview(),true);
  s.clear();
  assert.deepEqual([s.name,s.year,s.month,s.day,s.hour,s.minute],['','','','','','']);
  assert.equal(s.birthTimeKnown,true);
  assert.equal(s.place,null);
  assert.equal(s.preview,null);
  assert.deepEqual(s.issues,[]);
});

test('inspector wiring and UI clearly retain synthetic chart/save boundary',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const parent=read('src/app/desktop-app.component.html');
  const template=read('src/app/natal-draft.component.html');
  const component=read('src/app/desktop-app.component.ts');
  const source=read('src/app/natal-draft-state.ts');
  assert.match(parent,/vs-natal-draft/);
  assert.match(parent,/openNatalDraft\(\)/);
  assert.match(template,/natal.no.save/);
  assert.match(template,/natal.utc.unresolved/);
  assert.match(component,/new NatalDraftState\(\)/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|fetch\(|invoke\(|indexedDB/);
});

test('Italian and English natal editor labels exist with equal key sets',()=>{
  const source=readFileSync(new URL('../src/app/translations.ts',import.meta.url),'utf8');
  const keys=['tab.draft','natal.title','natal.name','natal.date','natal.time',
    'natal.preview','natal.no.save','natal.utc.unresolved','natal.error.zone'];
  for(const key of keys)assert.equal(source.split('"'+key+'"').length,3,key);
});
