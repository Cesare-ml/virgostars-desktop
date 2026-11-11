import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');
const core = doc('docs/OFFLINE_FIRST_MVP.md');
const pipeline = doc('docs/LIVE_CALCULATION_PIPELINE.md');
const places = doc('docs/OFFLINE_PLACES_AND_TIMEZONES.md');
const sync = doc('docs/OPTIONAL_SYNC_AND_DUPLICATES.md');
const agents = doc('AGENTS.md');
const roadmap = doc('docs/ROADMAP.md');

test('P0 desktop product explicitly allows first-run guest and full offline usage',()=>{
  for (const text of [core, roadmap, agents, doc('docs/ARCHITECTURE.md'),
    doc('docs/OFFLINE_AUTH_AND_SYNC.md'),doc('README.md')]) {
    assert.match(text, /offline/i);
    assert.match(text, /without (an?y? )?(virgostars )?account|no.account|without registration|without any account|never require a virgostars login/i);
  }
});

test('live time controls and a bounded Angular-Rust pipeline are mandatory',()=>{
  assert.match(core, /year, month, day, hour, minute|year\/month\/day\/hour\/minute/i);
  assert.match(core, /click-and-hold|hold-repeat/i);
  for(const keyword of ['bounded','latest','worker','cancellation','memory','Rust','WebGL']) {
    assert.ok(pipeline.toLowerCase().includes(keyword.toLowerCase()),keyword);
  }
});

test('settings preserve bodies aspects toward, orbs, houses and light-dark skins',()=>{
  for(const token of ['House','body orb','aspect orb','aspetti verso','Light','Dark']) {
    assert.ok(core.toLowerCase().includes(token.toLowerCase()),token);
  }
  assert.match(core,/Egyptian\+Placidus|Egyptian \+ Placidus/);
});

test('purchased worldwide city catalog is evaluated before licensing or package decisions',()=>{
  assert.match(places,/1,951,599/);
  assert.match(places,/redistribution/i);
  assert.match(places,/SQLite/i);
  assert.match(places,/benchmark/i);
  assert.match(places,/optional remote supplement/i);
  assert.match(places,/Nominatim/i);
  assert.match(places,/historical/i);
  const sized=doc('docs/OWNED_CITY_CATALOG_SIZING.md');
  for(const field of ['nome','nome_it','lat','lng','pop','stato_id','regione','tz','tz_offs']) {
    assert.ok(sized.includes('`'+field+'`'),field);
  }
  assert.match(sized,/pg_total_relation_size/);
  assert.match(sized,/TABLESAMPLE/);
});

test('offline city search is never an online-account prerequisite',()=>{
  assert.match(places,/GeoNames/);
  assert.match(places,/IANA tzdb/);
  assert.match(places,/bundled local index/);
  assert.match(places,/optional/i);
  assert.match(places,/first run works without Internet/i);
});

test('optional first account attachment preserves both records and disambiguates names',()=>{
  assert.match(sync,/Keep both/);
  assert.match(sync,/same name/i);
  assert.match(sync,/local IDs? remain unchanged|local ID does not change/i);
  assert.match(sync,/without an account/i);
  assert.match(sync,/CloudSyncClient/);
});

test('agent instructions point at specs and list ordered implementation slices',()=>{
  const tasks=doc('docs/MVP_AGENT_TASKS.md');
  for(const path of ['OFFLINE_FIRST_MVP.md','LIVE_CALCULATION_PIPELINE.md',
    'OFFLINE_PLACES_AND_TIMEZONES.md','OPTIONAL_SYNC_AND_DUPLICATES.md']) {
    assert.ok(agents.includes(path),path);
    assert.ok(roadmap.includes(path),path);
  }
  for(const id of ['D-00','D-01','D-02','D-03','D-04','D-05','D-06','D-07','D-08','D-09','D-10','D-11','D-12']) {
    assert.ok(tasks.includes(id),id);
  }
});

test('approved new specs do not promise a compiled real ephemeris or production sync',()=>{
  assert.match(core,/NOT IMPLEMENTED/);
  assert.match(sync,/DESIGN ONLY/);
  assert.match(pipeline,/NOT an implemented calculation bridge/);
});
