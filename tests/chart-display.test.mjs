import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultChartSettings} from '../src/app/chart-settings.ts';
import {australChartData,regoloPlanetOfYear,settingsWithConjunctOuter} from '../src/app/astro/chart-display.ts';

test('southern inversion shifts each ecliptic longitude and preserves the original chart', () => {
  const planet = {longitude:350,longitudeSign:11,longitude30:20,longitudeSpeed:1,
    dodecatemoria:{longitude:20,longitudeSign:0,longitude30:20,longitudeSpeed:1}};
  const house = {house:[12,42,72],ascendant:12,mc:270,ds:192,ic:90,vertex:70,armc:80};
  const data = {planets:{Sun:planet},houses:{egizia:house},as:12,ds:192,mc:270,ic:90,australInversion:false};
  assert.equal(australChartData(data,10,true),data);
  assert.equal(australChartData(data,-10,false),data);
  const inverted = australChartData(data,-10,true);
  assert.equal(inverted.australInversion,true);
  assert.equal(inverted.planets.Sun.longitude,170);
  assert.equal(inverted.planets.Sun.longitudeSign,5);
  assert.equal(inverted.planets.Sun.dodecatemoria.longitude,200);
  assert.deepEqual(inverted.houses.egizia.house,[192,222,252]);
  assert.equal(data.planets.Sun.longitude,350);
});

test('outer planets appear only when hidden and within their configured orb, including across 0 degrees', () => {
  const settings=defaultChartSettings();
  settings.outerWhenConjunct=true;
  for (const name of ['Uranus','Neptune','Pluto']) settings.points[name].shown=false;
  settings.points.Uranus.orb=3;
  const data={as:40,ds:220,mc:130,ic:310,planets:{Sun:{longitude:359},Uranus:{longitude:1},Neptune:{longitude:10},Pluto:{longitude:80}}};
  const result=settingsWithConjunctOuter(data,settings);
  assert.equal(result.points.Uranus.shown,true);
  assert.equal(result.points.Neptune.shown,false);
  assert.equal(result.points.Pluto.shown,false);
  assert.equal(settings.points.Uranus.shown,false);
  data.planets.Uranus.longitude=2;
  assert.equal(settingsWithConjunctOuter(data,settings).points.Uranus.shown,false,'exact orb boundary is excluded');
});

test('planet of year follows Regolo’s 36-year blocks, 252-year cycle and solar boundary', () => {
  for (const [year,planet] of [[1765,'Saturn'],[1801,'Venus'],[1837,'Jupiter'],[1873,'Mercury'],[1909,'Mars'],[1945,'Moon'],[1981,'Sun'],[2016,'Sun'],[2017,'Saturn'],[2026,'Mars']]) {
    assert.equal(regoloPlanetOfYear(year,6,90),planet);
    assert.equal(regoloPlanetOfYear(year+252,6,90),planet);
  }
  assert.equal(regoloPlanetOfYear(2026,3,350),'Jupiter');
  assert.equal(regoloPlanetOfYear(2026,3,0),'Mars');
  assert.equal(regoloPlanetOfYear(2026,13,0),null);
});
