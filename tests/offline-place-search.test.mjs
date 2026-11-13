import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeOfflinePlaceResults, OfflinePlaceSearch} from '../src/app/native/offline-places-contract.ts';

const city = {
  id: 1, name: 'San José', italianName: null,
  latMicro: 9933300, lngMicro: -84083300,
  population: 350000, stateId: 12, region: 'San José', timeZone: 'America/Costa_Rica',
};
const response = {protocolVersion:1,items:[city]};

test('decodes bounded Unicode city records without fetching from network', () => {
  const items=decodeOfflinePlaceResults(response);
  assert.equal(items.length,1);
  assert.equal(items[0].name,'San José');
  assert.equal(items[0].latMicro,9933300);
  assert.equal(items[0].timeZone,'America/Costa_Rica');
});

test('rejects version mismatch, more than thirty results and duplicate place IDs', () => {
  for(const bad of [
    {},null,[],{...response,protocolVersion:2},
    {...response,items:Array(31).fill(city)},
    {...response,items:[city,city]},
  ])assert.throws(()=>decodeOfflinePlaceResults(bad));
});

test('rejects untrusted coordinates, timezones and inconsistent population',()=>{
  for(const bad of [
    {...city,latMicro:90_000_001},
    {...city,lngMicro:-180_000_001},
    {...city,latMicro:NaN},
    {...city,region:42},
    {...city,timeZone:{zone:'Europe/Rome'}},
    {...city,population:-1},
    {...city,id:0},
    {...city,name:''},
  ])assert.throws(()=>decodeOfflinePlaceResults({protocolVersion:1,items:[bad]}));
});

test('empty and short searches do not invoke Tauri IPC',async()=>{
  let called=0;
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:async()=>{called++;return response;},
  });
  assert.equal((await search.search(' ')).kind,'query_too_short');
  assert.equal((await search.search('x')).kind,'query_too_short');
  assert.equal(called,0);
});

test('browser preview does not pretend native offline cities are installed',async()=>{
  const search=new OfflinePlaceSearch({
    isNative:()=>false,
    invoke:async()=>{throw new Error('must not call')},
  });
  assert.equal((await search.search('Firenze')).kind,'not_native');
});

test('native query sends only query and bounded limit',async()=>{
  let command='',args={};
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:async(c,a)=>{command=c;args=a;return response;},
  });
  const result=await search.search('San Jose',8);
  assert.deepEqual({command,args},{
    command:'search_offline_places',
    args:{query:'San Jose',limit:8}
  });
  assert.equal(result.kind,'ready');
  assert.equal(result.items[0].id,1);
});

test('older promise completion cannot overwrite a newer search result',async()=>{
  const deferred=[];
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:()=>new Promise(resolve=>deferred.push(resolve)),
  });
  const first=search.search('Firenze');
  const second=search.search('San José');
  deferred[1](response);
  assert.equal((await second).kind,'ready');
  deferred[0]({protocolVersion:1,items:[{...city,id:3,name:'Firenze'}]});
  assert.equal((await first).kind,'stale');
});

test('older failure is suppressed after a newer search',async()=>{
  const deferred=[];
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:()=>new Promise((resolve,reject)=>deferred.push({resolve,reject})),
  });
  const first=search.search('Bologna');
  const second=search.search('Firenze');
  deferred[1].resolve(response);
  assert.equal((await second).kind,'ready');
  deferred[0].reject(new Error('secret path never shown'));
  assert.equal((await first).kind,'stale');
});

test('native overload and missing catalog have stable, non-sensitive statuses',async()=>{
  let reason='PLACE_SEARCH_BUSY';
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:async()=>{throw reason;},
  });
  assert.equal((await search.search('Firenze')).kind,'busy');
  reason='PLACE_CATALOG_UNAVAILABLE';
  assert.equal((await search.search('Firenze')).kind,'catalog_unavailable');
  reason='C:\\secret\\user\\cities.sqlite';
  assert.deepEqual(await search.search('Firenze'),{kind:'unavailable',items:[]});
});

test('dispose and clear invalidate every pending request',async()=>{
  let finish;
  const search=new OfflinePlaceSearch({
    isNative:()=>true,
    invoke:()=>new Promise(resolve=>{finish=resolve;}),
  });
  const pending=search.search('Firenze');
  search.dispose();
  finish(response);
  assert.equal((await pending).kind,'stale');
  assert.equal((await search.search('Firenze')).kind,'stale');
});

test('Rust native command is registered and only read-only local resource path is used',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const rust=read('src-tauri/src/offline_places.rs');
  const entry=read('src-tauri/src/lib.rs');
  const cargo=read('src-tauri/Cargo.toml');
  assert.match(entry,/offline_places::search_offline_places/);
  assert.match(entry,/manage\(offline_places::PlaceSearchGate::default\(\)\)/);
  assert.match(rust,/spawn_blocking/);
  assert.match(rust,/SQLITE_OPEN_READ_ONLY/);
  assert.match(rust,/MAX_ACTIVE_QUERIES: usize = 2/);
  assert.match(rust,/MAX_RESULTS: u8 = 30/);
  assert.match(rust,/BaseDirectory::Resource/);
  assert.match(cargo,/rusqlite\s*=\s*\{.*"bundled"/);
  assert.doesNotMatch(rust,/https?:\/\/|reqwest|Command::new|database_password/);
});


test('older v1 place payloads remain valid with unknown country fields',()=>{
  const places=decodeOfflinePlaceResults(response);
  assert.equal(places[0].countryName,null);
  assert.equal(places[0].countryCode,null);
});

test('v2 places preserve explicit country mapping without assuming stateId is ISO',()=>{
  const result=decodeOfflinePlaceResults({protocolVersion:1,items:[
    {...city,countryName:'Costa Rica',countryCode:'CR'}
  ]});
  assert.equal(result[0].countryName,'Costa Rica');
  assert.equal(result[0].countryCode,'CR');
  assert.equal(result[0].stateId,12);
});

test('v2 country metadata rejects invalid codes and untrusted value types',()=>{
  for(const candidate of [
    {...city,countryName:123,countryCode:'IT'},
    {...city,countryName:'Italy',countryCode:'ITA'},
    {...city,countryName:'Italy',countryCode:'iT'},
    {...city,countryName:'Italy',countryCode:{}},
  ])assert.throws(()=>decodeOfflinePlaceResults({protocolVersion:1,items:[candidate]}));
});

test('Rust queries v1 and v2 resource schemas using fixed SQL branches',()=>{
  const rust=readFileSync(new URL('../src-tauri/src/offline_places.rs',import.meta.url),'utf8');
  assert.match(rust,/"1" => "WITH candidate AS/);
  assert.match(rust,/"2" => "WITH candidate AS/);
  assert.match(rust,/LEFT JOIN country_lookup/);
  assert.match(rust,/country_name: row.get\(9\)/);
  assert.match(rust,/country_code: row.get\(10\)/);
});

test('cancelling one independent lookup never cancels another picker',async()=>{
  const pending=[];
  const transport={
    isNative:()=>true,
    invoke:(_command,args)=>new Promise(resolve=>pending.push({query:args.query,resolve})),
  };
  const first=new OfflinePlaceSearch(transport);
  const second=new OfflinePlaceSearch(transport);
  const firstRequest=first.search('Roma');
  const secondRequest=second.search('Firenze');
  assert.deepEqual(pending.map(x=>x.query),['Roma','Firenze']);
  first.clear();
  pending[1].resolve(response);
  pending[0].resolve(response);
  assert.equal((await firstRequest).kind,'stale');
  assert.equal((await secondRequest).kind,'ready');
});
