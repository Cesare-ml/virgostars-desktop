import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyStyleHealth, measureStyleHealth } from '../src/app/style-health.ts';

const healthy = Object.freeze({
  globalMarker:'ready', componentMarker:'ready',
  shellDisplay:'grid', stageDisplay:'grid',
  stageWidth:850, stageHeight:720,
  canvasWidth:650, canvasHeight:650,
});

test('healthy compiled CSS and centered chart dimensions are recognized',()=>{
  assert.equal(classifyStyleHealth(healthy),'ok');
});

test('distinguishes both styles missing from only the global stylesheet missing',()=>{
  assert.equal(classifyStyleHealth({...healthy,globalMarker:'',componentMarker:''}),'both_missing');
  assert.equal(classifyStyleHealth({...healthy,globalMarker:''}),'global_missing');
});

test('detects Angular component stylesheet missing while global CSS is present',()=>{
  assert.equal(classifyStyleHealth({...healthy,componentMarker:''}),'component_missing');
});

test('CSS marker whitespace is harmless, but falsified marker values are rejected',()=>{
  assert.equal(classifyStyleHealth({...healthy,globalMarker:' ready ',componentMarker:'\nready'}),'ok');
  assert.equal(classifyStyleHealth({...healthy,componentMarker:'disabled'}),'component_missing');
});

test('an unstyled browser layout cannot falsely report an acceptable chart',()=>{
  assert.equal(classifyStyleHealth({...healthy,shellDisplay:'block'}),'layout_unexpected');
  assert.equal(classifyStyleHealth({...healthy,stageDisplay:'block'}),'layout_unexpected');
});

test('non-finite or collapsed stage geometry is not a valid layout',()=>{
  for(const width of [-1,0,31,NaN,Infinity]) {
    assert.equal(classifyStyleHealth({...healthy,stageWidth:width}),'layout_unexpected',String(width));
  }
});

test('tiny canvas is detected when chart stage is large',()=>{
  assert.equal(classifyStyleHealth({...healthy,canvasWidth:100,canvasHeight:120}),'canvas_small');
  assert.equal(classifyStyleHealth({...healthy,canvasWidth:650,canvasHeight:NaN}),'canvas_small');
});

test('small split window does not cause a false tiny-chart alarm',()=>{
  assert.equal(classifyStyleHealth({...healthy,stageWidth:220,stageHeight:220,canvasWidth:100,canvasHeight:100}),'ok');
});

test('reads only CSS sentinel markers and computed layout from injected DOM objects',()=>{
  const requested=[];
  const root={kind:'root'},shell={kind:'shell'},stage={kind:'stage'},canvas={kind:'canvas'};
  const styleMap=new Map([
    [root,{display:'block',getPropertyValue:key=>key==='--vs-global-css-marker'?'ready':''}],
    [shell,{display:'grid',getPropertyValue:key=>key==='--vs-component-css-marker'?'ready':''}],
    [stage,{display:'grid',getPropertyValue:()=>''}],
  ]);
  const documentRef={
    documentElement:root,
    defaultView:{getComputedStyle:element=>{requested.push(element.kind);return styleMap.get(element);}},
  };
  const metrics=measureStyleHealth(documentRef,shell,
    { ...stage,getBoundingClientRect:()=>({width:850,height:720}) },
    { ...canvas,getBoundingClientRect:()=>({width:650,height:650}) });
  assert.deepEqual(requested,['root','shell','stage']);
  assert.equal(classifyStyleHealth(metrics),'ok');
  assert.deepEqual(Object.keys(metrics),[
    'globalMarker','componentMarker','shellDisplay','stageDisplay',
    'stageWidth','stageHeight','canvasWidth','canvasHeight'
  ]);
});

test('absent WebView DOM view is treated as unavailable by caller',()=>{
  assert.throws(()=>measureStyleHealth({defaultView:null}, {}, {}, {}),/unavailable/);
});

test('CSS sentinels and Angular inspection wiring exist in real source',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  assert.match(read('src/styles.css'),/--vs-global-css-marker:\s*ready;/);
  assert.match(read('src/app/desktop-app.component.css'),/--vs-component-css-marker:\s*ready;/);
  const shell=read('src/app/desktop-app.component.ts');
  assert.match(shell,/measureStyleHealth\(/);
  assert.match(shell,/classifyStyleHealth\(/);
  assert.match(shell,/this\.scheduleStyleCheck\(\)/);
  assert.match(shell,/requestAnimationFrame\(/);
  const html=read('src/app/desktop-app.component.html');
  assert.match(html,/#shell class="desktop-app"/);
  assert.match(html,/\(click\)="recheckStyles\(\)"/);
  assert.match(html,/t\(styleStatus\)/);
});
