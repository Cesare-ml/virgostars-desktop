import test from 'node:test';
import assert from 'node:assert/strict';
import {NatalDraftState} from '../src/app/natal-draft-state.ts';
import {captureNatalPreviewAnchor,isNatalPreviewCurrent} from '../src/app/natal-preview-freshness.ts';
import {resolveCivilTime} from '../src/app/timezone-civil.ts';
import {prepareProvisionalNatalCandidate as prepare} from '../src/app/natal-calculation-candidate.ts';

// All fixtures are fictional. This exercises only pure local preview logic.
const fictionalPlace=Object.freeze({
  id:42,name:'Fictionalville',italianName:null,
  latMicro:43_769_560,lngMicro:11_255_810,population:100,
  stateId:12,region:'Invented Region',timeZone:'Europe/Rome',
  countryName:'Invented Country',countryCode:'IT'
});
const spring=Date.parse('2024-03-31T01:00:00.000Z');
const autumn=Date.parse('2024-10-27T01:00:00.000Z');
const syntheticRome=Object.freeze({
  name:'Europe/Rome',untils:[spring,autumn,Infinity],offsets:[-60,-120,-60]
});
const coverage=Object.freeze({
  providerId:'fictional-native-v1',
  earliestUtc:'2024-01-01T00:00:00.000Z',
  latestUtc:'2024-12-31T23:59:59.999Z'
});
function draft({name='Мария 🌟',month='10',day='27',hour='02',minute='30',known=true}={}){
  const s=new NatalDraftState();
  s.update('name',name);
  s.update('year','2024');
  s.update('month',month);
  s.update('day',day);
  s.update('hour',hour);
  s.update('minute',minute);
  s.setBirthTimeKnown(known);
  s.setPlace(fictionalPlace);
  assert.equal(s.showPreview(),true);
  return s;
}
function current(s){
  const anchor=captureNatalPreviewAnchor(s);
  const resolution=resolveCivilTime(s.preview.civil,syntheticRome,'synthetic-2024');
  return {anchor,resolution};
}
function candidate(s, anchor, resolution, selected=null, declared=coverage){
  return prepare(s,anchor,isNatalPreviewCurrent,resolution,selected,declared);
}

test('real natal state and pure timezone resolver require an explicit DST-fold decision',()=>{
  const s=draft();
  const {anchor,resolution}=current(s);
  assert.equal(resolution.status,'ambiguous');
  assert.deepEqual(resolution.candidates.map(c=>c.isoUtc),[
    '2024-10-27T00:30:00.000Z','2024-10-27T01:30:00.000Z'
  ]);
  assert.deepEqual(candidate(s,anchor,resolution),{status:'selection_required'});
});

test('either selected fold instant is provisional only and contains no subject identity',()=>{
  const s=draft();
  const {anchor,resolution}=current(s);
  for(const c of resolution.candidates){
    const out=candidate(s,anchor,resolution,c.isoUtc);
    assert.equal(out.status,'provisional_only');
    assert.equal(out.instantUtc,c.isoUtc);
    assert.equal(out.offsetSeconds,c.offsetMinutesEast*60);
    assert.equal(out.timeZoneProvenance,'bundled_moment_unverified');
    assert.equal(out.declaredProviderId,coverage.providerId);
    const serialized=JSON.stringify(out);
    for(const omitted of ['Мария','Fictionalville','Invented','sourceId','name']) {
      assert.equal(serialized.includes(omitted),false,omitted);
    }
  }
});

test('detached immutable anchor rejects coordinated draft and preview tampering',()=>{
  const s=draft();
  const {anchor,resolution}=current(s);
  s.name='Renamed Subject';
  s.preview.name='Renamed Subject';
  const out=candidate(s,anchor,resolution,resolution.candidates[0].isoUtc);
  assert.deepEqual(out,{status:'stale_preview'});
});

test('malformed atomic correction does not silently invalidate a still-current preview',()=>{
  const s=draft();
  const {anchor,resolution}=current(s);
  const revision=s.inputRevision;
  s.applyCivilCorrection({
    year:'2024',month:'2',day:'30',hour:'02',minute:'30'
  });
  assert.equal(s.inputRevision,revision);
  assert.equal(isNatalPreviewCurrent(s,anchor),true);
  assert.equal(candidate(s,anchor,resolution,resolution.candidates[1].isoUtc).status,'provisional_only');
  s.applyCivilCorrection({year:'2024',month:'10',day:'28',hour:'02',minute:'30'});
  assert.equal(candidate(s,anchor,resolution,resolution.candidates[1].isoUtc).status,'stale_preview');
});

test('nonexistent spring hour and unknown birth time never enter candidate stage',()=>{
  const springDraft=draft({month:'3',day:'31'});
  const gap=current(springDraft);
  assert.equal(gap.resolution.status,'nonexistent');
  assert.equal(candidate(springDraft,gap.anchor,gap.resolution).status,'resolution_unavailable');

  const unknown=draft({known:false});
  const unresolved=current(unknown);
  assert.equal(unresolved.resolution.status,'unknown_birth_time');
  assert.equal(candidate(unknown,unresolved.anchor,unresolved.resolution).status,'time_unknown');
});

test('changed IANA city and unsupported declared provider coverage fail closed',()=>{
  const s=draft();
  const {anchor,resolution}=current(s);
  const utc=resolution.candidates[0].isoUtc;
  assert.equal(candidate(s,anchor,resolution,utc,{...coverage,
    earliestUtc:'2024-10-27T00:30:00.001Z'}).status,'outside_provider_range');
  assert.equal(candidate(s,anchor,resolution,utc,{...coverage,
    providerId:'invalid provider/id'}).status,'coverage_unavailable');
  s.setPlace({...fictionalPlace,timeZone:'UTC'});
  assert.equal(candidate(s,anchor,resolution,utc).status,'stale_preview');
});
