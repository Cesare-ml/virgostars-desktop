import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareRendererCalls,hasNamedExport}
  from '../scripts/mac/verify-sibling-api-contracts.mjs';

const desktop='class App { f(){this.renderer.zoomAt(1,2,3);this.renderer.resetFraming()} }';
const renderer='export class GraficoRenderService {public zoomAt(x:number,y:number,z:number):void {} public resetFraming():void {}}';

test('AST verifies actual Desktop renderer methods, not just matching comment text',()=>{
  const valid=compareRendererCalls(desktop,renderer);
  assert.deepEqual(valid.requested,['resetFraming','zoomAt']);
  assert.deepEqual(valid.missing,[]);
  assert.deepEqual(compareRendererCalls(desktop,renderer.replace('resetFraming():void','unrelated():void')).missing,['resetFraming']);
  assert.deepEqual(compareRendererCalls('class A {f(){ /* this.renderer.secret() */ }}',renderer).requested,[]);
});
test('AST checks Functions actual named exports and rejects comment-only shims',()=>{
  assert.equal(hasNamedExport('export function buildPlanetaryHours(){}','buildPlanetaryHours'),true);
  assert.equal(hasNamedExport("export {buildPlanetaryHours} from './planetary-hours.mjs';",'buildPlanetaryHours'),true);
  assert.equal(hasNamedExport('/* export function buildPlanetaryHours(){} */','buildPlanetaryHours'),false);
  assert.equal(hasNamedExport('function buildPlanetaryHours(){}','buildPlanetaryHours'),false);
});
test('macOS build executes the pinned API preflight after the sibling install',()=>{
  const build=readFileSync(new URL('../scripts/mac/build.mjs',import.meta.url),'utf8');
  const install=build.indexOf("command('npm',['ci']);");
  const preflight=build.indexOf("verify-sibling-api-contracts.mjs");
  const tests=build.indexOf("command('npm',['test']);");
  assert.ok(install>=0 && preflight>install && tests>preflight);
});
