import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeDesktopLayout } from '../src/app/desktop-layout-probe.ts';
import { STRINGS } from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
function box(width, height, top=0, left=0) {
  // Mirror the HTMLCanvasElement drawing-buffer dimensions as well as CSS geometry.
  return {width, height, getBoundingClientRect() { return {width, height, top, left}; }};
}
const shell = box(1360, 880);
const workspace = box(1360, 880);
const stage = box(720, 650);
const canvas = box(602, 602);
const elements = {shell, workspace, stage, canvas};
const styles = new Map([
  [shell, {display:'grid', visibility:'visible', opacity:'1',
    getPropertyValue: key => key === '--vs-accent' ? '#7146B5' : ''}],
  [workspace, {display:'grid', visibility:'visible', opacity:'1', getPropertyValue: () => ''}],
  [stage, {display:'grid', visibility:'visible', opacity:'1', getPropertyValue: () => ''}],
  [canvas, {display:'inline', visibility:'visible', opacity:'1', getPropertyValue: () => ''}],
]);
const inspect = element => styles.get(element);

test('recognizes computed grid layout with a genuinely visible canvas', () => {
  assert.equal(probeDesktopLayout(elements, inspect), 'active');
});

test('detects missing root, workspace or chart-stage component CSS', () => {
  for (const target of [shell,workspace,stage]) {
    const broken = element => element === target ? {...inspect(target), display:'block'} : inspect(element);
    assert.equal(probeDesktopLayout(elements, broken), 'missing');
  }
});

test('requires component design token, not only incidental grid properties', () => {
  const noAccent = element => element === shell ?
    {...inspect(shell),getPropertyValue:()=>''} : inspect(element);
  assert.equal(probeDesktopLayout(elements,noAccent),'missing');
});

test('computed invisibility is reported even when CSS grid and geometry look healthy', () => {
  for (const target of [shell, workspace, stage, canvas]) {
    for (const visibility of ['hidden', 'collapse']) {
      const read = element => element === target ? {...inspect(target), visibility} : inspect(element);
      assert.equal(probeDesktopLayout(elements, read), 'hidden');
    }
    for (const opacity of ['0', '0.00']) {
      const read = element => element === target ? {...inspect(target), opacity} : inspect(element);
      assert.equal(probeDesktopLayout(elements, read), 'hidden');
    }
  }
  assert.equal(probeDesktopLayout(elements, element => element === canvas ?
    {...inspect(canvas), display:'none'} : inspect(element)), 'hidden');
  assert.equal(probeDesktopLayout(elements, element => element === stage ?
    {...inspect(stage), opacity:'0.5'} : inspect(element)), 'active');
});

test('nonzero styled canvas with zero or tiny backing buffer is not healthy', () => {
  for (const [width,height] of [[0,602],[602,0],[1,602],[602,31]]) {
    const missingBuffer = {...canvas,width,height};
    const read = element => element === missingBuffer ? inspect(canvas) : inspect(element);
    assert.equal(probeDesktopLayout({...elements,canvas:missingBuffer},read),
      'collapsed',`canvas backing ${width}x${height}`);
  }
  const largerBuffer = {...canvas,width:1204,height:1204};
  assert.equal(probeDesktopLayout({...elements,canvas:largerBuffer},
    element => element === largerBuffer ? inspect(canvas) : inspect(element)), 'active');
});

test('invalid canvas drawing-buffer metadata never reports healthy', () => {
  for (const size of [NaN,Infinity,-1,12.5,undefined,null]) {
    const invalid = {...canvas,width:size};
    const read = element => element === invalid ? inspect(canvas) : inspect(element);
    assert.equal(probeDesktopLayout({...elements,canvas:invalid},read),
      'unavailable',String(size));
  }
});

test('invalid computed visibility and opacity never report a healthy chart', () => {
  for (const visibility of ['', 'invalid', undefined, null]) {
    const read = element => element === canvas ?
      {...inspect(canvas), visibility} : inspect(element);
    assert.equal(probeDesktopLayout(elements,read), 'unavailable');
  }
  for (const opacity of ['', 'NaN', '-0.1', '1.1', undefined, null]) {
    const read = element => element === stage ?
      {...inspect(stage), opacity} : inspect(element);
    assert.equal(probeDesktopLayout(elements,read), 'unavailable');
  }
});

test('missing DOM nodes, thrown style reads and invalid boxes cannot pass', () => {
  for (const key of ['shell','workspace','stage','canvas']) {
    assert.equal(probeDesktopLayout({...elements,[key]:null},inspect),'unavailable');
  }
  assert.equal(probeDesktopLayout(null, inspect),'unavailable');
  assert.equal(probeDesktopLayout(elements, () => {throw Error('WebView CSS error')}),'unavailable');
  assert.equal(probeDesktopLayout(elements, () => ({get display(){throw Error('bad display')},
    getPropertyValue:()=>''})),'unavailable');
  assert.equal(probeDesktopLayout(elements, inspect, () => {throw Error('WebView geometry error')}),'unavailable');
  for (const size of [{width:NaN,height:650},{width:Infinity,height:650},
    {width:0,height:-1}]) {
    assert.equal(probeDesktopLayout(elements,inspect, () => size),'unavailable');
  }
});

test('grid and accent with a collapsed chart stage do not report healthy CSS', () => {
  const collapsedStage = {...elements,stage:box(720,0)};
  const adapted = element => element === collapsedStage.stage ? inspect(stage) : inspect(element);
  assert.equal(probeDesktopLayout(collapsedStage,adapted),'collapsed');
  const crampedWorkspace = {...elements,workspace:box(40,800)};
  const adaptedWorkspace = element => element === crampedWorkspace.workspace ?
    inspect(workspace) : inspect(element);
  assert.equal(probeDesktopLayout(crampedWorkspace,adaptedWorkspace),'collapsed');
});

test('a tiny canvas in a large stage is reported separately from missing CSS', () => {
  for (const size of [12,100]) {
    const tinyCanvas = box(size,size);
    const readTiny = element => element === tinyCanvas ? inspect(canvas) : inspect(element);
    assert.equal(probeDesktopLayout({...elements,canvas:tinyCanvas},readTiny),'collapsed');
  }
});

test('detects the Mac screenshot regression: workspace shifted down or not filling shell', () => {
  for (const displaced of [
    box(1360, 550), box(1100, 880), box(1360, 880, 150, 0), box(1360, 880, 0, 100)
  ]) {
    const readDisplaced = element => element === displaced ? inspect(workspace) : inspect(element);
    assert.equal(probeDesktopLayout({...elements, workspace:displaced}, readDisplaced), 'collapsed');
  }
});

test('a root that does not cover the native Mac viewport is also collapsed', () => {
  const viewport={width:1360,height:880};
  assert.equal(probeDesktopLayout(elements,inspect,undefined,{width:1360,height:1200}),'collapsed');
  const offset=box(1360,880,150,0);
  const readOffset=element=>element===offset?inspect(shell):inspect(element);
  assert.equal(probeDesktopLayout({...elements,shell:offset},readOffset,undefined,viewport),'collapsed');
  assert.equal(probeDesktopLayout(elements,inspect,undefined,{width:0,height:880}),'unavailable');
  assert.equal(probeDesktopLayout(elements,inspect,undefined,viewport),'active');
});

test('healthy small but usable viewports and relative chart sizes remain valid', () => {
  const resized = {...elements,shell:box(850,620),workspace:box(850,620),
    stage:box(320,390),canvas:box(272,272)};
  const readResized = element => element === resized.shell ? inspect(shell) :
    element === resized.workspace ? inspect(workspace) :
    element === resized.stage ? inspect(stage) :
    element === resized.canvas ? inspect(canvas) : inspect(element);
  assert.equal(probeDesktopLayout(resized,readResized),'active');
});

test('Angular checks live styles and geometry at startup and offers manual recheck', () => {
  const app = read('src/app/desktop-app.component.ts');
  const html = read('src/app/desktop-app.component.html');
  assert.match(app,/this\.checkStyles\(\);/);
  assert.match(app,/probeDesktopLayout\(/);
  assert.match(app,/canvas:\s*this\.canvas\.nativeElement/);
  assert.match(app,/if \(this\.destroyed\) return;/);
  assert.match(app,/this\.styleStatus === 'collapsed'/);
  assert.match(app,/this\.styleStatus === 'hidden'/);
  assert.match(html, /class="desktop-app" #shell/);
  assert.match(html, /class="workspace" #workspace/);
  assert.match(html, /\(click\)="checkStyles\(\)"/);
  assert.match(html, /class="layout-warning-banner" role="status"/);
  assert.match(html, /\*ngIf="styleStatus !== 'active'"/);
});

test('both localizations contain matching non-empty layout status keys', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const lang of ['it','en']) {
    for (const key of ['styles.label','styles.active','styles.missing',
      'styles.collapsed','styles.hidden','styles.unavailable','styles.retry']) {
      assert.ok(STRINGS[lang][key]?.trim(),lang + ':' + key);
    }
  }
});

test('existing ResizeObserver updates layout health even for collapsed or unchanged chart sizing', () => {
  const app = read('src/app/desktop-app.component.ts');
  assert.match(app, /new ResizeObserver\(\(\) => this\.fitStage\(\)\)/);
  const fit = app.match(/private fitStage\(\): void \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(fit, 'fitStage should remain the central resize handler');
  assert.match(fit, /if \(this\.destroyed\) return;/);
  assert.match(fit, /if \(diameter >= 32\)/);
  assert.match(fit, /if \(this\.initialized && !this\.destroyed\) this\.checkStyles\(\)/);
  assert.equal((fit.match(/this\.checkStyles\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(fit, /if\s*\(diameter < 32\) return/);
  assert.doesNotMatch(fit, /if\s*\(surface\.style\.width === css && surface\.style\.height === css\) return/);
});

test('the Windows chrome reserves its measured 42px strip without a false collapsed warning', () => {
  const chrome = box(1360,42);
  const insetWorkspace = box(1360,838,42,0);
  const native = {...elements,workspace:insetWorkspace,chrome};
  const inspectNative = element => element === chrome ?
    {display:'grid',visibility:'visible',opacity:'1',getPropertyValue:()=>''} :
    element === insetWorkspace ? inspect(workspace) : inspect(element);
  assert.equal(probeDesktopLayout(native,inspectNative),'active');
  assert.equal(probeDesktopLayout(native,inspectNative,undefined,{width:1360,height:880}),'active');
  // macOS and plain browser previews still require a zero-inset workspace.
  assert.equal(probeDesktopLayout({...native,chrome:null},inspectNative),'collapsed');
});

test('a mismatched, hidden or misplaced Windows titlebar cannot disguise a broken layout', () => {
  const chrome = box(1360,42);
  const insetWorkspace = box(1360,838,42,0);
  const native = {...elements,workspace:insetWorkspace,chrome};
  const inspectNative = element => element === chrome ?
    {display:'grid',visibility:'visible',opacity:'1',getPropertyValue:()=>''} :
    element === insetWorkspace ? inspect(workspace) : inspect(element);
  assert.equal(probeDesktopLayout(native, element => element === chrome ?
    {...inspectNative(chrome),visibility:'hidden'} : inspectNative(element)), 'hidden');
  assert.equal(probeDesktopLayout(native, element => element === chrome ?
    {...inspectNative(chrome),display:'none'} : inspectNative(element)), 'hidden');
  for (const brokenBar of [box(1000,42),box(1360,42,20,0),box(1360,42,0,20),
    box(1360,0),box(1360,120)]) {
    const diagnostic = {...native, chrome:brokenBar};
    const read = element => element === brokenBar ? inspectNative(chrome) : inspectNative(element);
    assert.equal(probeDesktopLayout(diagnostic,read),'collapsed');
  }
  for (const misplaced of [box(1360,880,42,0),box(1360,820,42,0),
    box(1360,838,0,0),box(1310,838,42,0),box(1360,838,42,20)]) {
    const diagnostic = {...native, workspace:misplaced};
    const read = element => element === misplaced ? inspectNative(insetWorkspace) : inspectNative(element);
    assert.equal(probeDesktopLayout(diagnostic,read),'collapsed');
  }
});
