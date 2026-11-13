import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';
import {stepCivilCorrection} from '../src/app/natal-time-step.ts';

// Fictional-only in-memory input. No saved charts, credentials or native bridge.
const place=Object.freeze({
  id:42,name:'Fictional City',italianName:null,
  latMicro:43_769_560,lngMicro:11_255_810,population:100,
  stateId:1,region:'Test Region',timeZone:'Europe/Rome',
  countryName:'Test Country',countryCode:'IT',
});
function complete(known=true) {
  const draft=new NatalDraftState();
  draft.update('name','Synthetic Subject');
  draft.update('year','2024');
  draft.update('month','2');
  draft.update('day','28');
  draft.update('hour','23');
  draft.update('minute','59');
  draft.setBirthTimeKnown(known);
  draft.setPlace(place);
  assert.equal(draft.showPreview(),true);
  return draft;
}
function fields(draft) {
  return [draft.year,draft.month,draft.day,draft.hour,draft.minute];
}

test('a valid leap-day correction commits together and revokes the previous preview',()=>{
  const draft=complete();
  const before=draft.inputRevision;
  const previous=draft.preview;
  draft.applyCivilCorrection({year:'2024',month:'2',day:'29',hour:'00',minute:'00'});
  assert.deepEqual(fields(draft),['2024','2','29','00','00']);
  assert.equal(draft.inputRevision,before+1);
  assert.equal(draft.preview,null);
  assert.equal(previous.civil.day,28);
  assert.equal(draft.showPreview(),true);
  assert.equal(draft.preview.civil.day,29);
});

test('malformed correction fields leave date, preview and revision untouched',()=>{
  const baseline={year:'2024',month:'2',day:'29',hour:'12',minute:'30'};
  const rejected=[
    null,undefined,[],{},'2024-02-29',
    {...baseline,year:2024},
    {...baseline,year:'0'},
    {...baseline,year:'10000'},
    {...baseline,year:'2000e0'},
    {...baseline,year:'9'.repeat(1000)},
    {...baseline,month:'0'},
    {...baseline,month:'13'},
    {...baseline,day:'0'},
    {...baseline,day:'30'},
    {...baseline,year:'1900'},
    {...baseline,minute:30},
    {...baseline,minute:'60'},
    {...baseline,hour:'24'},
    {...baseline,hour:'-1'},
    {...baseline,hour:'Infinity'},
    {...baseline,minute:undefined},
  ];
  for(const candidate of rejected) {
    const draft=complete();
    const revision=draft.inputRevision;
    const preview=draft.preview;
    const original=fields(draft);
    draft.applyCivilCorrection(candidate);
    assert.deepEqual(fields(draft),original,JSON.stringify(candidate));
    assert.equal(draft.inputRevision,revision,JSON.stringify(candidate));
    assert.equal(draft.preview,preview,JSON.stringify(candidate));
  }
});

test('unknown-time date corrections never introduce, erase or edit time fields',()=>{
  const draft=complete(false);
  draft.update('hour','99');
  draft.update('minute',''); // retained but intentionally ignored when time is unknown
  assert.equal(draft.showPreview(),true);
  const revision=draft.inputRevision;
  const old=draft.preview;
  const dateOnly={year:'2024',month:'2',day:'29',hour:'99',minute:''};
  draft.applyCivilCorrection({...dateOnly,hour:'00'});
  draft.applyCivilCorrection({...dateOnly,minute:'00'});
  assert.equal(draft.inputRevision,revision);
  assert.equal(draft.preview,old);
  assert.deepEqual(fields(draft),['2024','2','28','99','']);

  draft.applyCivilCorrection(dateOnly);
  assert.equal(draft.inputRevision,revision+1);
  assert.deepEqual(fields(draft),['2024','2','29','99','']);
  assert.equal(draft.preview,null);
  assert.equal(draft.showPreview(),true);
  assert.equal(draft.preview.utcResolution,'unknown_birth_time');
  assert.equal(draft.preview.civil.hour,null);
  assert.equal(draft.preview.civil.minute,null);
});

test('actual day/minute step outputs remain accepted without timezone inference',()=>{
  const known=complete();
  const correction=stepCivilCorrection(known,'minute',1);
  assert.deepEqual(correction,{year:'2024',month:'2',day:'29',hour:'00',minute:'00'});
  known.applyCivilCorrection(correction);
  assert.deepEqual(fields(known),['2024','2','29','00','00']);

  const unknown=complete(false);
  const step=stepCivilCorrection(unknown,'day',1);
  assert.ok(step);
  unknown.applyCivilCorrection(step);
  assert.deepEqual(fields(unknown),['2024','2','29','23','59']);
  assert.equal(unknown.showPreview(),true);
  assert.equal(unknown.preview.utcResolution,'unknown_birth_time');
});

test('a disposed draft cannot be repopulated through a valid correction',()=>{
  const draft=complete();
  draft.dispose();
  const revision=draft.inputRevision;
  draft.applyCivilCorrection({year:'2024',month:'2',day:'29',hour:'00',minute:'00'});
  assert.deepEqual(fields(draft),['','','','','']);
  assert.equal(draft.inputRevision,revision);
  assert.equal(draft.preview,null);
});
