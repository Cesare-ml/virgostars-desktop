import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';

// All identities, dates and coordinates are synthetic development fixtures.
const place=Object.freeze({
  id:42,name:'Fictional City',italianName:null,latMicro:43769560,lngMicro:11255810,
  population:100,stateId:1,region:'Test Region',timeZone:'Europe/Rome',
  countryName:'Test Country',countryCode:'IT',
});
function ready() {
  const state=new NatalDraftState();
  state.update('name','Example Person');
  state.update('year','2024');state.update('month','10');state.update('day','27');
  state.update('hour','02');state.update('minute','30');state.setPlace(place);
  return state;
}

test('state stores no more than 160 whole astral scalars and rejects a too-long preview',()=>{
  const state=ready();
  state.update('name','🌟'.repeat(161));
  assert.equal(state.name,'🌟'.repeat(160));
  assert.equal(state.showPreview(),false);
  assert.deepEqual(state.issues,['name']);
  state.update('name','🌟'.repeat(120));
  assert.equal(state.showPreview(),true);
  assert.equal(state.preview.name,'🌟'.repeat(120));
});

test('direct name mutation cannot bypass the scalar preview limit',()=>{
  const state=ready();
  state.name='🌟'.repeat(121);
  assert.equal(state.showPreview(),false);
  assert.deepEqual(state.issues,['name']);
});

test('untrimmed control characters fail before a preview could hide them',()=>{
  for(const name of ['Ada\n', '\tAda', 'A\u2029B', 'A\ud800B', 'A\u0000B']){
    const state=ready();
    state.update('name',name);
    assert.equal(state.showPreview(),false,JSON.stringify(name));
    assert.deepEqual(state.issues,['name']);
  }
});

test('valid international names stay in memory only and retain a civil-time preview',()=>{
  for(const name of ['Мария', '李明', 'مريم', 'Élodie']){
    const state=ready();
    state.update('name',name);
    assert.equal(state.showPreview(),true,name);
    assert.equal(state.preview.name,name);
    assert.equal(state.preview.utcResolution,'pending_historical_tzdb');
    assert.equal('utcTimestamp' in state.preview,false);
  }
});

test('date and numeric fields retain their existing bounded input contract',()=>{
  const state=ready();
  state.update('year','123456789');
  assert.equal(state.year,'12345678');
  assert.equal(state.showPreview(),false);
  assert.deepEqual(state.issues,['date']);
});

test('Angular text field accommodates supplementary scalars and resynchronizes clipped text',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const html=read('src/app/natal-draft.component.html');
  const component=read('src/app/natal-draft.component.ts');
  const state=read('src/app/natal-draft-state.ts');
  assert.match(html,/id="draft-subject"[^>]*maxlength="320"/);
  assert.match(component,/field === 'name' && target\.value !== this\.draft\.name/);
  assert.match(component,/target\.value = this\.draft\.name/);
  assert.match(state,/isValidNatalName\(this\.name\)/);
  assert.doesNotMatch(state,/\b(?:localStorage|sessionStorage|indexedDB)\s*[.\[]/);
});
