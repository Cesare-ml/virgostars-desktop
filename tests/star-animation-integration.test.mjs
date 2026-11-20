import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {StarAnimationRepaint} from '../src/app/star-animation-repaint.ts';

// Exercise the sibling renderer's real star materials with fictional markers.
const bundle=await build({stdin:{contents:`export {createFixedStarRing} from './src/lib/renderers/moduli/fixed-stars.renderer';
  export {stopSceneAnimations} from './src/lib/renderers/scene-animations';`,
  resolveDir:fileURLToPath(new URL('../../astrological-charts/',import.meta.url)),loader:'ts'},
  bundle:true,write:false,platform:'node',format:'esm',target:'es2022'});
const {createFixedStarRing,stopSceneAnimations}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

test('axis material fades and the repaint loop stops while the chart is hidden', async () => {
  const group=createFixedStarRing([{id:1,longitude:20,magnitude:1,axisContact:true},
    {id:2,longitude:120,magnitude:1,axisContact:false}],0,2);
  const samples=[];
  let visible=true;
  const repaint=new StarAnimationRepaint(tick=>setInterval(tick,40),clearInterval,()=>visible,
    ()=>samples.push(group.children[0].material.opacity));
  try {
    repaint.start();
    await new Promise(resolve=>setTimeout(resolve,320));
    assert.ok(samples.length>=2);
    assert.ok(Math.min(...samples)<0.98,'axis marker opacity changes during repaints');
    assert.equal(group.children[1].material.opacity,1,'ordinary conjunction remains steady');
    visible=false;
    const count=samples.length;
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(samples.length,count);
  } finally {
    repaint.stop();
    stopSceneAnimations(group);
    for (const child of group.children) {child.geometry.dispose();child.material.dispose();}
  }
});
