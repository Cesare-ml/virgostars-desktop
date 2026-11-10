import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderGeneration } from '../src/app/render-generation.ts';

test('only latest redraw may settle chart UI', () => {
  const state = new RenderGeneration();
  const natal = state.begin();
  const dark = state.begin();
  assert.ok(natal !== null && dark !== null);
  assert.equal(state.isCurrent(natal), false);
  assert.equal(state.isCurrent(dark), true);
});

test('a stale failure cannot overwrite the current success', async () => {
  const state = new RenderGeneration();
  let resolveFirst;
  let resolveSecond;
  const first = new Promise(resolve => { resolveFirst=resolve; });
  const second = new Promise(resolve => { resolveSecond=resolve; });
  const statuses = [];
  async function task(ticket, pending) {
    const succeeded = await pending;
    if (state.isCurrent(ticket)) statuses.push(succeeded ? 'ready' : 'failed');
  }
  const a=state.begin(); const firstTask=task(a, first);
  const b=state.begin(); const secondTask=task(b, second);
  resolveSecond(true); await secondTask;
  resolveFirst(false); await firstTask;
  assert.deepEqual(statuses,['ready']);
});

test('an earlier success does not hide the latest loading state', async () => {
  const state = new RenderGeneration();
  const a = state.begin();
  const b = state.begin();
  assert.equal(state.isCurrent(a),false);
  assert.equal(state.isCurrent(b),true);
});

test('destroying a component invalidates every pending redraw', () => {
  const state = new RenderGeneration();
  const a=state.begin();
  state.dispose();
  assert.equal(state.isCurrent(a),false);
  assert.equal(state.begin(),null);
});

test('invalid and future tickets never gain permission to update UI', () => {
  const state = new RenderGeneration();
  state.begin();
  for(const ticket of [0,-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,2]) {
    assert.equal(state.isCurrent(ticket),false,String(ticket));
  }
});

test('explicit invalidation does not reopen a disposed coordinator', () => {
  const state = new RenderGeneration();
  const a=state.begin();
  state.invalidate();
  assert.equal(state.isCurrent(a),false);
  assert.equal(state.isCurrent(state.begin()),true);
  state.dispose();
  state.invalidate();
  assert.equal(state.begin(),null);
});

test('Async scene generation markers are wired into the actual Angular shell', () => {
  // Intentionally avoid evaluating the Angular component without its installed dependencies.
  // This source contract complements (but does not replace) an ng build and WebView2 tests.
  const src = readFileSync(new URL('../src/app/desktop-app.component.ts',import.meta.url),'utf8');
  assert.match(src,/new RenderGeneration\(\)/);
  assert.match(src,/const ticket = this\.drawGeneration\.begin\(\)/);
  assert.match(src,/this\.drawGeneration\.isCurrent\(ticket\)/);
  assert.match(src,/this\.drawGeneration\.dispose\(\)/);
  assert.match(src,/if \(this\.exporting \|\| this\.destroyed\) return/);
});
