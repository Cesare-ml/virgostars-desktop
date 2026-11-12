import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';

const place=Object.freeze({
  id:42,name:'Fictional City',italianName:null,latMicro:43769560,lngMicro:11255810,
  population:100,stateId:1,region:'Test Region',timeZone:'Europe/Rome',
  countryName:'Test Country',countryCode:'IT',
});
function complete(){
  const s=new NatalDraftState();
  s.update('name','Fictional Person');
  s.update('year','2026');s.update('month','10');s.update('day','25');
  s.update('hour','02');s.update('minute','30');s.setPlace(place);
  return s;
}
test('revision increases on all birth-data changes including place and known-time flag',()=>{
  const s=new NatalDraftState();const r=s.inputRevision;
  s.update('name','Fictional');assert.ok(s.inputRevision>r);
  const r1=s.inputRevision;s.setBirthTimeKnown(false);assert.ok(s.inputRevision>r1);
  const r2=s.inputRevision;s.setPlace(place);assert.ok(s.inputRevision>r2);
  const r3=s.inputRevision;
  s.applyCivilCorrection({year:'2026',month:'10',day:'25',hour:'02',minute:'30'});
  assert.ok(s.inputRevision>r3);
});
test('a selected UTC instant must be considered stale after external draft changes',()=>{
  const s=complete();assert.equal(s.showPreview(),true);
  const previousRevision=s.inputRevision;
  s.setPlace({...place,id:43,latMicro:43000000});
  assert.equal(s.preview,null);
  assert.notEqual(s.inputRevision,previousRevision);
});
test('clear drops time-zone preview and all personal fields while keeping the editor reusable',()=>{
  const s=complete();s.showPreview();
  const before=s.inputRevision;s.clear();
  assert.equal(s.preview,null);assert.equal(s.place,null);
  assert.equal(s.name,'');assert.equal(s.hour,'');assert.equal(s.minute,'');
  assert.deepEqual(s.issues,[]);assert.ok(s.inputRevision>before);
  s.update('name','Fictional Again');assert.equal(s.name,'Fictional Again');
});
test('root session dispose drops the in-memory birth draft and invalidates its token',()=>{
  const s=complete();s.showPreview();
  const old=s.inputRevision;s.dispose();
  assert.equal(s.preview,null);assert.equal(s.place,null);
  assert.deepEqual([s.name,s.year,s.month,s.day,s.hour,s.minute],['','','','','','']);
  assert.ok(s.inputRevision>old);
  assert.deepEqual(s.issues,[]);
});
test('a disposed draft cannot be repopulated by late edit, place, correction, or preview callbacks',()=>{
  const s=complete();s.dispose();const revision=s.inputRevision;
  s.update('name','Should Not Reappear');
  s.setPlace(place);s.setBirthTimeKnown(false);
  s.applyCivilCorrection({year:'2026',month:'2',day:'3',hour:'12',minute:'00'});
  assert.equal(s.showPreview(),false);
  assert.equal(s.validate().ok,false);
  assert.equal(s.name,'');assert.equal(s.place,null);
  assert.equal(s.birthTimeKnown,true);assert.equal(s.inputRevision,revision);
});
test('dispose is idempotent, and clear cannot re-enable a retired editor',()=>{
  const s=complete();s.dispose();const revision=s.inputRevision;
  s.dispose();s.clear();s.update('year','2000');
  assert.equal(s.inputRevision,revision);assert.equal(s.year,'');
});
test('unknown birth time still previews without invented instant before disposal',()=>{
  const s=complete();s.setBirthTimeKnown(false);
  assert.equal(s.showPreview(),true);
  assert.equal(s.preview.civil.hour,null);assert.equal(s.preview.civil.minute,null);
  assert.equal(s.preview.utcResolution,'unknown_birth_time');
  s.dispose();assert.equal(s.preview,null);
});
test('Angular UTC preview and fold selection use a current content+revision anchor',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const source=read('src/app/natal-draft.component.ts');
  const html=read('src/app/natal-draft.component.html');
  assert.match(source,/private previewAnchor: NatalPreviewAnchor \| null = null;/);
  assert.match(source,/isNatalPreviewCurrent\(this\.draft, this\.previewAnchor\)/);
  assert.match(source,/this\.previewAnchor=captureNatalPreviewAnchor\(this\.draft\)/);
  assert.match(source,/this\.previewAnchor=null/);
  assert.match(source,/const current=this\.currentTimeResult;/);
  assert.match(html,/\*ngIf="currentPreview as p"/);
  assert.match(html,/\*ngIf="currentTimeResult as z"/);
});
test('app teardown retires shared natal draft; tab switches do not retire it',()=>{
  const source=readFileSync(new URL('../src/app/desktop-app.component.ts',import.meta.url),'utf8');
  assert.match(source,/ngOnDestroy\(\): void \{[\s\S]*?this\.natalDraft\.dispose\(\)/);
  assert.doesNotMatch(source,/setInspectorTab\([\s\S]*?\bthis\.natalDraft\.dispose\(\)/);
});
