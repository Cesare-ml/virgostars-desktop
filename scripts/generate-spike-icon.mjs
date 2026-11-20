import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons');
const crcTable = Uint32Array.from({length:256}, (_,i) => {
  let c=i;
  for(let k=0;k<8;k++) c=(c&1)?0xedb88320^(c>>>1):c>>>1;
  return c>>>0;
});
function chunk(name, body) {
  const type=Buffer.from(name,'ascii');
  const n=Buffer.alloc(4); n.writeUInt32BE(body.length);
  let c=0xffffffff;
  for(const b of Buffer.concat([type,body])) c=crcTable[(c^b)&255]^(c>>>8);
  const tail=Buffer.alloc(4);tail.writeUInt32BE((c^0xffffffff)>>>0);
  return Buffer.concat([n,type,body,tail]);
}
export function temporaryIconPng(size=64) {
  if(![32,64,128].includes(size))throw new Error('Unsupported icon size');
  const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc((size*4+1)*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const p=y*(size*4+1)+1+x*4;
    const dx=x-(size-1)/2,dy=y-(size-1)/2, r=Math.hypot(dx,dy)/(size/2);
    const ring=(r>.57&&r<.64)||(r>.78&&r<.84), cross=(Math.abs(dx)<size*.025||Math.abs(dy)<size*.025)&&r<.55;
    const rgb=ring||cross?[194,164,112]:[19,30,49];
    pixels[p]=rgb[0]; pixels[p+1]=rgb[1]; pixels[p+2]=rgb[2];pixels[p+3]=255;
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
export function temporaryIconIco(png=temporaryIconPng()) {
  // The ICO directory's dimensions must match the embedded PNG; Windows may
  // otherwise misread icons at different UI scaling factors. Check only the
  // minimal generator-owned PNG header/trailer contract, not all IDAT pixels.
  if (!Buffer.isBuffer(png) || png.length < 45 || png.length > 1_048_576 ||
      !png.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
      png.readUInt32BE(8) !== 13 || png.toString('ascii',12,16) !== 'IHDR' ||
      !png.subarray(-12).equals(Buffer.from('0000000049454e44ae426082','hex'))) {
    throw new Error('Unsupported temporary icon PNG');
  }
  const size = png.readUInt32BE(16);
  if (![32,64,128].includes(size) || png.readUInt32BE(20) !== size ||
      png[24] !== 8 || png[25] !== 6 || png[26] !== 0 || png[27] !== 0 || png[28] !== 0 ||
      png.readUInt32BE(29) !== chunk('IHDR',png.subarray(16,29)).readUInt32BE(21)) {
    throw new Error('Unsupported temporary icon PNG');
  }
  const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);
  head[6]=size;head[7]=size;head[8]=0;head[9]=0;head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);
  head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);
  return Buffer.concat([head,png]);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  mkdirSync(output,{recursive:true});
  for(const size of [32,64,128]) {
    const file=join(output,size===64?'icon.png':size+'x'+size+'.png');
    if(!existsSync(file))writeFileSync(file,temporaryIconPng(size),{flag:'wx'});
  }
  const ico=join(output,'icon.ico');
  if(!existsSync(ico))writeFileSync(ico,temporaryIconIco(),{flag:'wx'});
  console.log('Generated temporary synthetic build icons (not release branding).');
}
