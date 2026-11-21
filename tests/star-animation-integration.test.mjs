import test from 'node:test';
import assert from 'node:assert/strict';
import {StarAnimationRepaint} from '../src/app/star-animation-repaint.ts';

// The pinned chart library does not ship a fixed-stars.renderer module.
// Exercise the real desktop animation lifecycle with a deterministic timer,
// not timing-sensitive waits on busy macOS runners.
test('star repaint works only while visible and cancels stale callbacks on disposal', () => {
  let visible=true, repaints=0, cancelled=0, scheduled=0;
  let tick=()=>{};
  const repaint=new StarAnimationRepaint(
    callback=>{scheduled++;tick=callback;return 1;},
    ()=>{cancelled++;},
    ()=>visible,
    ()=>{repaints++;}
  );
  repaint.start();
  repaint.start();
  assert.equal(scheduled,1,'start is idempotent');
  tick();tick();
  assert.equal(repaints,2,'visible scene repaints');
  visible=false;
  tick();
  assert.equal(repaints,2,'hidden scene must not repaint');
  repaint.stop();
  repaint.stop();
  assert.equal(cancelled,1,'dispose cancels timer exactly once');
  visible=true;
  tick();
  assert.equal(repaints,2,'a pending callback cannot repaint after disposal');
});
