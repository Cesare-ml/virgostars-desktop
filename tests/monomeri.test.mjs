import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result = await build({entryPoints:['src/app/monomeri.ts'], bundle:true, platform:'node', format:'esm', write:false});
const {monomeroFor, monomeriAvailable} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const corpus = Array.from({length:360}, (_, i) => `fictional ${i}`);
test('Regolo indexing uses actual longitude and sign boundaries', () => {
  assert.deepEqual(monomeroFor('Sun', 29.99, corpus), {planet:'☉',degree:29,sign:'♈︎',text:'fictional 29'});
  assert.deepEqual(monomeroFor('Moon', 30, corpus), {planet:'☽',degree:0,sign:'♉︎',text:'fictional 30'});
  assert.equal(monomeroFor('Mars', 359.999, corpus).text, 'fictional 359');
  for (const value of [-1,360,NaN,Infinity]) assert.equal(monomeroFor('Sun', value, corpus), null);
  assert.equal(monomeroFor('AS',0,corpus),null);
  assert.equal(monomeroFor('Sun',0,[]),null);
});
test('the public synthetic build does not include private interpretation text', () => assert.equal(monomeriAvailable,false));
