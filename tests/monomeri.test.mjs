import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result = await build({entryPoints:['src/app/monomeri.ts'], bundle:true, platform:'node', format:'esm', write:false});
const {monomeroFor, monomeroOnHover, monomeroForChart, monomeriAvailable} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const corpus = Array.from({length:360}, (_, i) => `fictional ${i}`);
test('Regolo indexing uses actual longitude and sign boundaries', () => {
  assert.deepEqual(monomeroFor('Sun', 29.99, corpus), {name:'Sun',degree:29,sign:0,text:'fictional 29'});
  assert.deepEqual(monomeroFor('Moon', 30, corpus), {name:'Moon',degree:0,sign:1,text:'fictional 30'});
  assert.equal(monomeroFor('Mars', 359.999, corpus).text, 'fictional 359');
  for (const value of [-1,360,NaN,Infinity]) assert.equal(monomeroFor('Sun', value, corpus), null);
  for (const name of ['AS','DS','MC','IC','true Node','osc. Apogee','Tyche','Daimon']) {
    assert.deepEqual(monomeroFor(name,120.3,corpus), {name,degree:0,sign:4,text:'fictional 120'});
  }
  assert.equal(monomeroFor('',0,corpus),null);
  assert.equal(monomeroFor('Sun',0,[]),null);
});
test('the public synthetic build does not include private interpretation text', () => assert.equal(monomeriAvailable,false));
test('leaving the glyph retains the last selection and a new valid hover replaces it', () => {
  const sun = monomeroOnHover(null,{name:'Sun',longitude:29.9},corpus);
  assert.equal(monomeroOnHover(sun,null,corpus),sun);
  assert.equal(monomeroOnHover(sun,{name:'Moon',longitude:NaN},corpus),sun);
  assert.equal(monomeroOnHover(sun,{name:'Moon',longitude:30},corpus).text,'fictional 30');
});
test('redraw resolves a selected point and the selected house system without stale degrees', () => {
  const data = {planets:{Sun:{longitude:31.2}},houses:{egizia:{ascendant:50,ds:230,mc:300,ic:120},placido:{ascendant:51,ds:231,mc:301,ic:121}}};
  assert.equal(monomeroForChart('Sun',data,'egizia',corpus).text,'fictional 31');
  assert.equal(monomeroForChart('AS',data,'placido',corpus).text,'fictional 51');
  assert.equal(monomeroForChart('DS',data,'egizia',corpus).text,'fictional 230');
  assert.equal(monomeroForChart('Moon',data,'egizia',corpus),null);
  assert.equal(monomeroForChart('AS',data,'koch',corpus),null);
});

test('a dodecatemorion resolves its projected longitude rather than the natal longitude', () => {
  const data={planets:{Sun:{longitude:10,dodecatemoria:{longitude:130.8}},Moon:{longitude:25}},houses:{}};
  assert.equal(monomeroForChart('Sun',data,'egizia',corpus,true).text,'fictional 130');
  assert.equal(monomeroForChart('Sun',data,'egizia',corpus,false).text,'fictional 10');
  assert.equal(monomeroForChart('Moon',data,'egizia',corpus,true),null);
  assert.equal(monomeroForChart('AS',data,'egizia',corpus,true),null);
});
