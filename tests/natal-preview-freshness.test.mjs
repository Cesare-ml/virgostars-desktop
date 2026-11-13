import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';
import {captureNatalPreviewAnchor,isNatalPreviewCurrent} from '../src/app/natal-preview-freshness.ts';

const place=Object.freeze({
  id:42,name:'Fictional City',italianName:null,latMicro:43769560,lngMicro:11255810,
  population:100,stateId:1,region:'Test Region',timeZone:'Europe/Rome',
  countryName:'Test Country',countryCode:'IT',
});
const make=()=>{
  const state=new NatalDraftState();
  state.update('name','Fictional Person');
  state.update('year','2026');state.update('month','10');state.update('day','25');
  state.update('hour','02');state.update('minute','30');state.setPlace(place);
  assert.equal(state.showPreview(),true);
  return state;
};

test('fresh source snapshot and revision authorize only current preview',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  assert.ok(a);assert.equal(isNatalPreviewCurrent(s,a),true);
});
test('without a preview or anchor there is no authorized UTC candidate',()=>{
  const s=new NatalDraftState();
  assert.equal(captureNatalPreviewAnchor(s),null);
  assert.equal(isNatalPreviewCurrent(s,null),false);
});
test('supported field edits revoke old UTC preview even when edited back',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  s.update('minute','31');assert.equal(isNatalPreviewCurrent(s,a),false);
  s.update('minute','30');s.showPreview();assert.equal(isNatalPreviewCurrent(s,a),false);
});
test('recreating preview on unchanged input still invalidates previous anchor',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  assert.equal(s.showPreview(),true);
  assert.equal(isNatalPreviewCurrent(s,a),false);
  assert.equal(isNatalPreviewCurrent(s,captureNatalPreviewAnchor(s)),true);
});
test('direct mutation of public civil input cannot reuse old UTC selection',()=>{
  for(const [field,value] of [
    ['year','2025'],['month','11'],['day','26'],['hour','03'],['minute','45'],['name','Changed'],
  ]){
    const s=make(),a=captureNatalPreviewAnchor(s);
    s[field]=value;
    assert.equal(isNatalPreviewCurrent(s,a),false,field);
  }
});
test('direct change to timezone, coordinates or city ID revokes old instant',()=>{
  for(const changed of [
    {timeZone:'UTC'}, {latMicro:43_000_000},{lngMicro:11_000_000}, {id:43},
    {name:'Second City'}, {region:'New Region'}, {countryCode:'FR'},
  ]){
    const s=make(),a=captureNatalPreviewAnchor(s);
    s.place={...place,...changed};
    assert.equal(isNatalPreviewCurrent(s,a),false,JSON.stringify(changed));
  }
});
test('direct unknown-time change invalidates UTC rather than synthesizing noon',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  s.birthTimeKnown=false;
  assert.equal(isNatalPreviewCurrent(s,a),false);
});
test('invalid direct calendar mutation fails closed without throwing',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  s.day='99';assert.equal(isNatalPreviewCurrent(s,a),false);
});
test('normal clear and terminal disposal revoke all previous UTC anchors',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  s.clear();assert.equal(isNatalPreviewCurrent(s,a),false);
  s.showPreview();assert.equal(isNatalPreviewCurrent(s,a),false);
  s.dispose();assert.equal(isNatalPreviewCurrent(s,a),false);
});
test('valid unknown birth time preserves unresolved status, never generates UTC',()=>{
  const s=make();s.setBirthTimeKnown(false);s.showPreview();
  const a=captureNatalPreviewAnchor(s);
  assert.equal(isNatalPreviewCurrent(s,a),true);
  assert.equal(a.preview.utcResolution,'unknown_birth_time');
  assert.equal(a.preview.civil.hour,null);
});

test('the anchor owns a frozen value copy, never the mutable preview objects',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  assert.ok(a);
  assert.notEqual(a.snapshot,s.preview);
  assert.notEqual(a.snapshot.civil,s.preview.civil);
  assert.notEqual(a.snapshot.place,s.preview.place);
  assert.equal(Object.isFrozen(a),true);
  assert.equal(Object.isFrozen(a.snapshot),true);
  assert.equal(Object.isFrozen(a.snapshot.civil),true);
  assert.equal(Object.isFrozen(a.snapshot.place),true);
  assert.equal(isNatalPreviewCurrent(s,a),true);
});

test('direct mutation of the displayed preview alone revokes authorization',()=>{
  for(const mutate of [
    p=>{p.name='Changed preview';},
    p=>{p.civil.day=26;},
    p=>{p.place.timeZone='UTC';},
    p=>{p.place.lngMicro=11_000_000;},
  ]){
    const s=make(),a=captureNatalPreviewAnchor(s);
    mutate(s.preview);
    assert.equal(isNatalPreviewCurrent(s,a),false);
  }
});

test('coordinated direct edits cannot launder a stale UTC selection',()=>{
  const cases=[
    s=>{s.name='Changed';s.preview.name='Changed';},
    s=>{s.year='2027';s.preview.civil.year=2027;},
    s=>{s.birthTimeKnown=false;
      s.preview.civil.birthTimeKnown=false;
      s.preview.civil.hour=null;s.preview.civil.minute=null;
      s.preview.utcResolution='unknown_birth_time';},
    s=>{s.place={...place,timeZone:'UTC'};
      s.preview.place.timeZone='UTC';},
    s=>{s.place={...place,latMicro:44_000_000};
      s.preview.place.latMicro=44_000_000;},
  ];
  for(const mutate of cases){
    const s=make(),a=captureNatalPreviewAnchor(s);
    assert.equal(isNatalPreviewCurrent(s,a),true);
    mutate(s);
    assert.equal(isNatalPreviewCurrent(s,a),false);
  }
});

test('a new explicit preview and anchor are needed after a source mutation',()=>{
  const s=make(),a=captureNatalPreviewAnchor(s);
  s.name='Changed';s.preview.name='Changed';
  assert.equal(isNatalPreviewCurrent(s,a),false);
  assert.equal(s.showPreview(),true);
  const fresh=captureNatalPreviewAnchor(s);
  assert.equal(isNatalPreviewCurrent(s,fresh),true);
  assert.equal(isNatalPreviewCurrent(s,a),false);
});
