import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareProvisionalNatalCandidate as prepare} from '../src/app/natal-calculation-candidate.ts';
import {captureNatalPreviewAnchor,isNatalPreviewCurrent} from '../src/app/natal-preview-freshness.ts';
const place=Object.freeze({source:'owned-world-cities',sourceId:42,name:'Fictionalville',countryName:'Invented Country',countryCode:'IT',stateId:12,region:'Fictional Region',latMicro:43769560,lngMicro:11255810,timeZone:'Europe/Rome'});
const civil=Object.freeze({year:2026,month:10,day:25,hour:2,minute:30,birthTimeKnown:true});
function fresh(overrides={}){
 const preview={protocolVersion:1,name:'Completely Fictional Person',civil:{...civil,...(overrides.civil||{})},place:{...place,...(overrides.place||{})},utcResolution:overrides.utcResolution||'pending_historical_tzdb'};
 const draft={preview,inputRevision:1,source:structuredClone(preview),validate(){return {ok:true,preview:structuredClone(this.source)};}};
 return {draft,anchor:captureNatalPreviewAnchor(draft)};
}
const coverage={providerId:'test-only-native-v1',earliestUtc:'2026-01-01T00:00:00.000Z',latestUtc:'2026-12-31T23:59:59.999Z'};
const a={isoUtc:'2026-10-25T00:30:00.000Z',epochMs:Date.parse('2026-10-25T00:30:00.000Z'),offsetMinutesEast:120};
const b={isoUtc:'2026-10-25T01:30:00.000Z',epochMs:Date.parse('2026-10-25T01:30:00.000Z'),offsetMinutesEast:60};
const fold={status:'ambiguous',timezone:'Europe/Rome',tzdbVersion:'2026b',caution:null,candidates:[a,b]};
const unique={...fold,status:'unique',candidates:[a]};
const call=(options={})=>{
 const f=options.fixture??fresh(options.draftOverride);
 return prepare(f.draft,f.anchor,options.validator??isNatalPreviewCurrent,options.resolution===undefined?fold:options.resolution,
 options.selected===undefined?null:options.selected,options.coverage===undefined?coverage:options.coverage);
};

test('ambiguous DST hour requires explicit UTC selection',()=>{assert.deepEqual(call(),{status:'selection_required'})});
test('both explicit fold choices preserve correct UTC offsets and provenance',()=>{
 for(const [option,offset] of [[a,7200],[b,3600]]){
  const result=call({selected:option.isoUtc});
  assert.equal(result.status,'provisional_only');assert.equal(result.instantUtc,option.isoUtc);
  assert.equal(result.offsetSeconds,offset);assert.equal(result.timeZoneProvenance,'bundled_moment_unverified');
  assert.equal(result.tzdbVersion,'2026b');assert.equal(result.declaredProviderId,coverage.providerId);
 }
});
test('unique local time selects sole candidate without a choice',()=>{
 const r=call({resolution:unique});assert.equal(r.status,'provisional_only');assert.equal(r.instantUtc,a.isoUtc);
});
test('forged or stale UTC selection fails closed',()=>{
 assert.equal(call({selected:'2026-10-25T00:31:00.000Z'}).status,'selection_invalid');
 assert.equal(call({resolution:unique,selected:b.isoUtc}).status,'selection_invalid');
});
test('a date/hour/zone edited after capture invalidates the entire handoff',()=>{
 for(const key of ['hour','year','minute']){
  const fixture=fresh();fixture.draft.source.civil[key]=key==='hour'?3:key==='year'?2025:59;
  assert.equal(call({fixture,selected:a.isoUtc}).status,'stale_preview',key);
 }
 const fixture=fresh();fixture.draft.source.place.timeZone='UTC';
 assert.equal(call({fixture,selected:a.isoUtc}).status,'stale_preview');
});
test('revision changes and reset prevent dispatch even if input returns to same values',()=>{
 const fixture=fresh();fixture.draft.inputRevision++;assert.equal(call({fixture,selected:a.isoUtc}).status,'stale_preview');
 fixture.draft.preview=null;assert.equal(call({fixture,selected:a.isoUtc}).status,'stale_preview');
});
test('unknown birth time is never converted into an invented midnight',()=>{
 const f=fresh({civil:{hour:null,minute:null,birthTimeKnown:false},utcResolution:'unknown_birth_time'});
 assert.equal(call({fixture:f,resolution:{...fold,status:'unknown_birth_time',candidates:[]}}).status,'time_unknown');
});
test('unsupported civil year is rejected independently of provider coverage',()=>{
 for(const year of [1899,2101]){
  const f=fresh({civil:{year}});assert.equal(call({fixture:f}).status,'civil_range_unsupported');
 }
});
test('mismatching timezone labels do not reuse an otherwise identical UTC',()=>{
 assert.equal(call({resolution:{...fold,timezone:'Etc/UTC'},selected:a.isoUtc}).status,'timezone_mismatch');
 assert.equal(call({draftOverride:{place:{timeZone:null}},selected:a.isoUtc}).status,'timezone_mismatch');
});
test('missing, broken and skipped civil resolution never produce a candidate',()=>{
 for(const status of ['nonexistent','invalid_date','zone_missing','invalid_zone_data','unknown_birth_time']){
  assert.equal(call({resolution:{...fold,status,candidates:[]}}).status,'resolution_unavailable',status);
 }
 assert.equal(call({resolution:null}).status,'timezone_mismatch');
 assert.equal(call({resolution:{...fold,tzdbVersion:'unknown'}}).status,'resolution_unavailable');
});
test('duplicate, unsorted or truncated DST options are rejected',()=>{
 for(const c of [[a,a],[b,a],[a],[a,b,a]]){
  assert.equal(call({resolution:{...fold,candidates:c},selected:a.isoUtc}).status,'invalid_candidates');
 }
});
test('mislabelled UTC, incorrect timestamp and fake offsets cannot pass',()=>{
 for(const altered of [
  {...a,isoUtc:'2026-10-25T00:31:00.000Z'},
  {...a,epochMs:a.epochMs+1000},
  {...a,offsetMinutesEast:60},
  {...a,offsetMinutesEast:Infinity},
  {...a,offsetMinutesEast:2000},
  {...a,isoUtc:'2026-10-25T00:30:00+00:00'},
  {...a,isoUtc:'2026-10-25T00:30:00.000Z\n'},
 ])assert.equal(call({resolution:{...unique,candidates:[altered]}}).status,'invalid_candidates');
});
test('incomplete or forged declared provider coverage always fails closed',()=>{
 for(const range of [null,{...coverage,earliestUtc:'bad'},{...coverage,providerId:'unsafe /local/path'},
   {...coverage,earliestUtc:'2027-01-01T00:00:00.000Z'},
   {...coverage,latestUtc:'2025-12-31T00:00:00.000Z'}]){
  assert.equal(call({resolution:unique,coverage:range}).status,'coverage_unavailable');
 }
});
test('out-of-range provider dates are rejected; boundaries are inclusive',()=>{
 assert.equal(call({resolution:unique,coverage:{...coverage,earliestUtc:'2026-10-25T00:30:00.001Z'}}).status,'outside_provider_range');
 assert.equal(call({resolution:unique,coverage:{...coverage,earliestUtc:a.isoUtc,latestUtc:a.isoUtc}}).status,'provisional_only');
});
test('strict payload projection omits the fictional name, city ID and other unrelated PII',()=>{
 const result=call({selected:a.isoUtc});
 assert.deepEqual(Object.keys(result).sort(),['status','protocolVersion','instantUtc','latMicro','lngMicro','timeZone','offsetSeconds','tzdbVersion','tzdbCaution','timeZoneProvenance','declaredProviderId'].sort());
 const serialized=JSON.stringify(result);
 for(const forbidden of ['Completely Fictional Person','Fictionalville','Invented Country','Fictional Region','sourceId'])assert.equal(serialized.includes(forbidden),false);
});
test('unexpected guard errors never open the calculation gate',()=>{
 assert.equal(call({validator:()=>{throw Error('private birth record')}}).status,'stale_preview');
});
test('historical caution remains explicit even when candidate can be projected',()=>{
 const r=call({selected:a.isoUtc,resolution:{...fold,caution:'pre_1970'}});
 assert.equal(r.status,'provisional_only');assert.equal(r.tzdbCaution,'pre_1970');
});
