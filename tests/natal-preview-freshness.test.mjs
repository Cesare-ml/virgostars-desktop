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
