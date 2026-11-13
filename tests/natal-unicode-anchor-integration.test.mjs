import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';
import {captureNatalPreviewAnchor, isNatalPreviewCurrent} from '../src/app/natal-preview-freshness.ts';
import {stepCivilCorrection} from '../src/app/natal-time-step.ts';

// Fictional development fixture. No private chart, network or persistent storage.
const place=Object.freeze({
  id:42,name:'Fictional City',italianName:null,latMicro:43_769_560,
  lngMicro:11_255_810,population:100,stateId:1,region:'Test Region',
  timeZone:'Europe/Rome',countryName:'Fictional Country',countryCode:'IT',
});
function draft(name='Мария 🌟') {
  const state=new NatalDraftState();
  state.update('name',name);
  state.update('year','2024');
  state.update('month','10');
  state.update('day','27');
  state.update('hour','02');
  state.update('minute','30');
  state.setPlace(place);
  assert.equal(state.showPreview(),true);
  return state;
}

test('international names coexist with detached frozen UTC preview anchors',()=>{
  for (const name of ['Мария 🌟','李明','مريم','Élodie']) {
    const state=draft(name);
    const anchor=captureNatalPreviewAnchor(state);
    assert.equal(anchor.snapshot.name,name);
    assert.notEqual(anchor.snapshot,state.preview);
    assert.equal(Object.isFrozen(anchor.snapshot),true);
    assert.equal(isNatalPreviewCurrent(state,anchor),true,name);
  }
});

test('changing a Unicode subject revokes previous UTC preview with no silent reauthorization',()=>{
  const state=draft('Мария 🌟');
  const anchor=captureNatalPreviewAnchor(state);
  state.update('name','李明 🌟');
  assert.equal(state.preview,null);
  assert.equal(isNatalPreviewCurrent(state,anchor),false);
  assert.equal(state.showPreview(),true);
  assert.equal(isNatalPreviewCurrent(state,anchor),false);
  assert.equal(isNatalPreviewCurrent(state,captureNatalPreviewAnchor(state)),true);
});

test('directly mutating both Unicode input and displayed preview cannot reuse UTC anchor',()=>{
  const state=draft();
  const anchor=captureNatalPreviewAnchor(state);
  state.name='李明';
  state.preview.name='李明';
  assert.equal(isNatalPreviewCurrent(state,anchor),false);
  assert.equal(anchor.snapshot.name,'Мария 🌟');
});

test('malformed civil correction does not invalidate a current Unicode preview',()=>{
  const state=draft();
  const anchor=captureNatalPreviewAnchor(state);
  const revision=state.inputRevision;
  state.applyCivilCorrection({
    year:'2024',month:'2',day:'30',hour:'02',minute:'30',
  });
  assert.equal(state.inputRevision,revision);
  assert.equal(isNatalPreviewCurrent(state,anchor),true);
  const next=stepCivilCorrection(state,'minute',1);
  assert.ok(next);
  state.applyCivilCorrection(next);
  assert.equal(state.preview,null);
  assert.equal(isNatalPreviewCurrent(state,anchor),false);
});
