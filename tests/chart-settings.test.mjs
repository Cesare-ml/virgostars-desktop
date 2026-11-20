import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASPECT_DEFINITIONS, CHART_SETTINGS_KEY, POINT_IDS, defaultChartSettings, loadChartSettings,
  parseOrb, sanitizeChartSettings, saveChartSettings, FIXED_STAR_DEFAULTS_KEY,
  loadChartSettingsForSession, loadFixedStarDefaults, saveFixedStarDefaults,
} from '../src/app/chart-settings.ts';

const memory = (initial = {}) => {
  const data = {...initial};
  return {data, getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }};
};

test('defaults include aspects for visible outer planets and points', () => {
  const settings = defaultChartSettings();
  assert.equal(settings.showAspects, true);
  const active = ASPECT_DEFINITIONS.filter(({id}) => settings.aspects[id].active).map(({id}) => id);
  assert.deepEqual(active, ['congiunzione', 'opposizione', 'trigono', 'quadrato', 'sestile']);
  assert.equal(settings.aspects.trigono.orb, null);
  assert.deepEqual([settings.aspects.quintile.orb, settings.aspects.semiquadrato.orb, settings.aspects.quinconce.orb], [3, 3, 2]);
  for (const id of POINT_IDS) assert.equal(settings.points[id].orb, 6, id);
  assert.deepEqual(settings.points.Sun, {shown: true, orb: 6, aspects: true});
  for (const id of ['Uranus', 'Neptune', 'Pluto', 'Chiron']) assert.deepEqual(settings.points[id], {shown: true, orb: 6, aspects: true}, id);
  for (const id of ['mean Node', 'mean Apogee']) assert.deepEqual(settings.points[id], {shown: false, orb: 6, aspects: false}, id);
  for (const id of ['true Node', 'osc. Apogee', 'AS', 'MC']) assert.deepEqual(settings.points[id], {shown: true, orb: 6, aspects: true}, id);
});

test('aspect and point lists are complete and free of duplicates', () => {
  assert.equal(ASPECT_DEFINITIONS.length, 17);
  assert.equal(new Set(ASPECT_DEFINITIONS.map(({id}) => id)).size, 17);
  assert.equal(new Set(POINT_IDS).size, POINT_IDS.length);
  for (const {id, angleDeg, kind} of ASPECT_DEFINITIONS) {
    const declination = kind === 'parallel' || kind === 'contraparallel';
    assert.equal(angleDeg === null, declination, id);
  }
  assert.deepEqual(ASPECT_DEFINITIONS.filter(({kind}) => kind === 'directed').map(({id}) => id), ['phisolare', 'philunare']);
});

test('valid values are kept field by field and everything else falls back', () => {
  const settings = sanitizeChartSettings({
    showAspects: false,
    aspects: {
      trigono: {active: false, orb: 4.26},
      quintile: {active: true, orb: null},
      sestile: {active: 'yes', orb: 99},
      quadrato: {orb: 0},
      invented: {active: true, orb: 1},
    },
    points: {
      Pluto: {shown: false, orb: 2.5, aspects: true},
      Sun: {shown: 1, orb: -1, aspects: null},
      Moon: {orb: Number.NaN},
      Vulcan: {shown: true, orb: 3, aspects: true},
    },
    injected: {path: 'C:/x'},
  });
  assert.equal(settings.showAspects, false);
  assert.deepEqual(settings.aspects.trigono, {active: false, orb: 4.3});
  assert.deepEqual(settings.aspects.quintile, {active: true, orb: null});
  assert.deepEqual(settings.aspects.sestile, {active: true, orb: null});
  assert.deepEqual(settings.aspects.quadrato, {active: true, orb: null});
  assert.deepEqual(settings.points.Pluto, {shown: false, orb: 2.5, aspects: true});
  assert.deepEqual(settings.points.Sun, {shown: true, orb: 6, aspects: true});
  assert.equal(settings.points.Moon.orb, 6);
  assert.deepEqual(Object.keys(settings).sort(), ['applicationMode','aspects','australInversion','fixedStars','focusAspects','outerWhenConjunct','planetOfYear','points','showAspects','showDecades','showDecans','showTerms']);
  assert.equal(Object.keys(settings.aspects).length, 17);
  assert.equal(Object.keys(settings.points).length, POINT_IDS.length);
  assert.equal(settings.aspects.invented, undefined);
  assert.equal(settings.points.Vulcan, undefined);
});

test('hostile or meaningless input yields plain defaults', () => {
  for (const raw of [null, undefined, 'text', 42, [], {aspects: [], points: 'x'},
    JSON.parse('{"__proto__":{"showAspects":false},"points":{"__proto__":{"Sun":{"shown":false}}}}')]) {
    assert.deepEqual(sanitizeChartSettings(raw), defaultChartSettings());
  }
  // An inherited key must not be read as a setting.
  const inherited = Object.create({trigono: {active: false, orb: 1}});
  assert.equal(sanitizeChartSettings({aspects: inherited}).aspects.trigono.active, true);
});

test('settings survive a save and load and are stored sanitized', () => {
  const storage = memory();
  const settings = defaultChartSettings();
  settings.aspects.quinconce.active = true;
  settings.points.Uranus.aspects = true;
  settings.points.Moon.orb = 8;
  assert.equal(saveChartSettings(storage, {...settings, extra: 'dropped'}), true);
  const stored = JSON.parse(storage.data[CHART_SETTINGS_KEY]);
  assert.deepEqual(Object.keys(stored).sort(), ['settings', 'version']);
  assert.equal(stored.settings.extra, undefined);
  assert.deepEqual(loadChartSettings(storage), settings);
});

test('fixed-star limits persist independently and invalid values fall back safely', () => {
  const storage=memory();
  const settings=defaultChartSettings();
  settings.fixedStars={magnitudeLimit:2.5,includeUnknownMagnitude:false,longitudeOrb:0.4,axisOrb:2};
  assert.equal(saveChartSettings(storage,settings),true);
  assert.deepEqual(loadChartSettings(storage).fixedStars,settings.fixedStars);
  assert.deepEqual(sanitizeChartSettings({fixedStars:{magnitudeLimit:99,includeUnknownMagnitude:'yes',longitudeOrb:-1,axisOrb:20}}).fixedStars,
    defaultChartSettings().fixedStars);
  assert.deepEqual(sanitizeChartSettings({}).fixedStars,defaultChartSettings().fixedStars);
});

test('only explicitly saved star defaults persist; old automatic values do not change 1° defaults', () => {
  const storage=memory();
  const old=defaultChartSettings();
  old.fixedStars={magnitudeLimit:2.5,includeUnknownMagnitude:false,longitudeOrb:1.5,axisOrb:1.5};
  old.showDecans=true;
  saveChartSettings(storage,old);
  let session=loadChartSettingsForSession(storage);
  assert.equal(session.showDecans,true);
  assert.deepEqual(session.fixedStars,{magnitudeLimit:null,includeUnknownMagnitude:true,longitudeOrb:1,axisOrb:1});
  session.fixedStars={magnitudeLimit:3,includeUnknownMagnitude:false,longitudeOrb:0.4,axisOrb:2};
  assert.deepEqual(loadChartSettingsForSession(storage).fixedStars,defaultChartSettings().fixedStars);
  assert.equal(saveFixedStarDefaults(storage,session.fixedStars),true);
  assert.deepEqual(loadChartSettingsForSession(storage).fixedStars,session.fixedStars);
  session.fixedStars.axisOrb=6;
  assert.equal(loadChartSettingsForSession(storage).fixedStars.axisOrb,2);
  assert.equal(JSON.parse(storage.data[FIXED_STAR_DEFAULTS_KEY]).version,1);
  assert.equal(loadFixedStarDefaults(memory({[FIXED_STAR_DEFAULTS_KEY]:'damaged'})).axisOrb,1);
  assert.equal(saveFixedStarDefaults({getItem:()=>null,setItem:()=>{throw new Error('blocked');}},session.fixedStars),false);
});

test('unknown versions, damaged text and failing storage use defaults without throwing', () => {
  const defaults = defaultChartSettings();
  assert.deepEqual(loadChartSettings(null), defaults);
  assert.deepEqual(loadChartSettings(memory({[CHART_SETTINGS_KEY]: '{not json'})), defaults);
  assert.deepEqual(loadChartSettings(memory({[CHART_SETTINGS_KEY]: JSON.stringify({version: 99, settings: {showAspects: false}})})), defaults);
  assert.deepEqual(loadChartSettings(memory({[CHART_SETTINGS_KEY]: 'x'.repeat(9000)})), defaults);
  const throwing = {getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); }};
  assert.deepEqual(loadChartSettings(throwing), defaults);
  assert.equal(saveChartSettings(throwing, defaults), false);
  assert.equal(saveChartSettings(null, defaults), false);
});

test('old four-planet defaults upgrade once while mixed choices remain unchanged', () => {
  const legacy = defaultChartSettings();
  for (const id of ['Uranus','Neptune','Pluto','Chiron']) legacy.points[id].aspects = false;
  const storage = memory({[CHART_SETTINGS_KEY]:JSON.stringify({version:1,settings:legacy})});
  const upgraded = loadChartSettings(storage);
  for (const id of ['Uranus','Neptune','Pluto','Chiron']) assert.equal(upgraded.points[id].aspects,true);
  assert.equal(JSON.parse(storage.data[CHART_SETTINGS_KEY]).version,2);
  upgraded.points.Uranus.aspects = false;
  saveChartSettings(storage,upgraded);
  assert.equal(loadChartSettings(storage).points.Uranus.aspects,false);
  legacy.points.Uranus.aspects = true;
  const customized = loadChartSettings(memory({[CHART_SETTINGS_KEY]:JSON.stringify({version:1,settings:legacy})}));
  assert.equal(customized.points.Neptune.aspects,false);
});

test('typed orbs accept one decimal with point or comma; empty means none', () => {
  assert.equal(parseOrb('6', 0), 6);
  assert.equal(parseOrb(' 2,5 ', 0.1), 2.5);
  assert.equal(parseOrb('0', 0), 0);
  assert.equal(parseOrb('', 0.1), null);
  for (const bad of ['0', '15.1', '16', '-1', '2.55', 'abc', '1e1', '3°']) assert.equal(parseOrb(bad, 0.1), undefined, bad);
  assert.equal(parseOrb('15', 0.1), 15);
});
