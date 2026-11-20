import test from 'node:test';
import assert from 'node:assert/strict';
import {StarAnimationRepaint} from '../src/app/star-animation-repaint.ts';

test('the animated scene repaints only while visible and releases its timer', () => {
  let tick, schedules=0, repaints=0, cancelled=0, visible=true;
  const loop=new StarAnimationRepaint(callback=>{tick=callback; schedules++; return 1;},
    id=>{assert.equal(id,1); cancelled++;}, ()=>visible, ()=>repaints++);
  loop.start();
  loop.start();
  assert.equal(schedules,1);
  tick();
  visible=false;
  tick();
  assert.equal(repaints,1);
  loop.stop();
  loop.stop();
  assert.equal(cancelled,1);
  visible=true;
  tick();
  assert.equal(repaints,1);
  const stale=tick;
  loop.start();
  stale();
  assert.equal(repaints,1);
  tick();
  assert.equal(repaints,2);
  loop.stop();
});
