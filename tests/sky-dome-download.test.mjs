import test from 'node:test';
import assert from 'node:assert/strict';
import {download} from '../scripts/sky3d/download-planet-textures.mjs';
import {TEXTURE_SOURCE} from '../scripts/sky3d/texture-sources.mjs';

function jpeg(size=6001){
  const bytes=Buffer.alloc(size,26);
  bytes[0]=255;bytes[1]=216;
  bytes[bytes.length-2]=255;bytes[bytes.length-1]=217;
  return bytes;
}
function fromBytes(bytes,headers={}){
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0,Math.floor(bytes.length/2)));
      controller.enqueue(bytes.subarray(Math.floor(bytes.length/2)));
      controller.close();
    },
  }),{status:200,headers:{'content-type':'image/jpeg',...headers}});
}

test('explicit image downloader uses the allowlisted official URL and validates streamed JPEG bytes',async()=>{
  const recorded=[];
  const original=jpeg();
  const record=await download('Mars','2k_mars.jpg',async (url,options)=>{
    recorded.push({url,options});
    return fromBytes(original);
  });
  assert.equal(record.id,'Mars');
  assert.equal(record.name,'2k_mars.jpg');
  assert.equal(record.bytes.length,original.length);
  assert.match(record.sha256,/^[a-f0-9]{64}$/);
  assert.equal(recorded[0].url,TEXTURE_SOURCE+'2k_mars.jpg');
  assert.equal(recorded[0].options.redirect,'error');
  assert.equal(recorded[0].options.headers.Accept,'image/jpeg');
});

test('oversized declared and actual image responses fail closed without buffering indefinitely',async()=>{
  await assert.rejects(download('Mars','2k_mars.jpg',async()=>fromBytes(jpeg(),{
    'content-length':'6000000',
  })),/Oversized declared image/);
  await assert.rejects(download('Mars','2k_mars.jpg',async()=>fromBytes(jpeg(3_000_001))),
    /Oversized downloaded image/);
});

test('invalid image bytes and non-image responses are rejected',async()=>{
  await assert.rejects(download('Moon','2k_moon.jpg',async()=>fromBytes(Buffer.alloc(6100,1))),
    /Incomplete or invalid JPEG/);
  await assert.rejects(download('Moon','2k_moon.jpg',async()=>new Response('Not found',{
    status:404,headers:{'content-type':'text/plain'},
  })),/Download failed/);
  await assert.rejects(download('Moon','2k_moon.jpg',async()=>new Response('Error',{
    status:200,headers:{'content-type':'text/html'},
  })),/Unexpected media type/);
});
