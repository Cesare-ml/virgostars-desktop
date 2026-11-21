import test from 'node:test';
import assert from 'node:assert/strict';
import {StarAnimationRepaint} from '../src/app/star-animation-repaint.ts';

// The current pinned chart library does not ship a fixed-stars.renderer module.
// Verify the real desktop repaint lifecycle instead of importing a nonexistent
// upstream source path (that made the whole macOS test file fail to load).
test('visible star scene repaints; hiding stops work and disposing cancels the timer', async () => {
  let visible=true, repaints=0, cancelled=0;
  const repaint=new StarAnimationRepaint(
    tick=>setInterval(tick,15),
    timer=>{cancelled++;clearInterval(timer);},
    ()=>visible,
    ()=>{repaints++;}
  );
  repaint.start(); repaint.start();
  try {
    await new Promise(resolve=>setTimeout(resolve,90));
    assert.ok(repaints>=2, 'visible star scene must redraw');
    visible=false;
    const count=repaints;
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.equal(repaints,count,'hidden scene must not redraw');
  } finally {repaint.stop();}
  assert.equal(cancelled,1,'the timer is released once');
  const finished=repaints;
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(repaints,finished,'disposed scene never receives stale callbacks');
});
