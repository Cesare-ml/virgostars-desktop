#!/usr/bin/env node
/** Explicit opt-in only: obtain original CC BY 4.0 planetary maps once.
 * No runtime browser network requests, credentials or redirects.
 */
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TEXTURES,TEXTURE_SOURCE,TEXTURE_CREDIT,TEXTURE_LICENSE} from './texture-sources.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const DIRECTORY=resolve(ROOT,'.local/sky3d/textures');
function sha256(bytes){return createHash('sha256').update(bytes).digest('hex');}
function assert(ok,message){if(!ok)throw Error(message);}
async function download(id,name) {
  const response=await fetch(TEXTURE_SOURCE+name,{
    redirect:'error',
    signal:AbortSignal.timeout(30000),
    headers:{Accept:'image/jpeg'},
  });
  assert(response.ok,'Download failed for '+id+' ('+response.status+')');
  const mime=response.headers.get('content-type')||'';
  assert(mime.startsWith('image/jpeg')||mime.startsWith('image/jpg'),'Unexpected media type: '+id);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert(bytes.length>5000&&bytes.length<3_000_000,'Unsafe or unsupported JPEG size: '+id);
  assert(bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217,
    'Incomplete or invalid JPEG: '+id);
  return {id,name,bytes,sha256:sha256(bytes)};
}
async function main(){
  assert(process.argv.length===2,'Unexpected CLI arguments');
  mkdirSync(DIRECTORY,{recursive:true});
  const downloaded=[];
  for(const [id,name] of TEXTURES){
    const record=await download(id,name);
    const path=join(DIRECTORY,name),tmp=path+'.part';
    try{writeFileSync(tmp,record.bytes);renameSync(tmp,path);}
    finally{if(existsSync(tmp))rmSync(tmp);}
    downloaded.push({id,name,bytes:record.bytes.length,sha256:record.sha256});
    console.log('Verified '+id+' texture ('+Math.round(record.bytes.length/1024)+' KiB)');
  }
  const manifest={
    schemaVersion:1,
    source:'Solar System Scope',
    baseUrl:TEXTURE_SOURCE,
    credit:TEXTURE_CREDIT,
    license:TEXTURE_LICENSE,
    images:downloaded,
  };
  const tmp=join(DIRECTORY,'manifest.json.part');
  const dest=join(DIRECTORY,'manifest.json');
  try{writeFileSync(tmp,JSON.stringify(manifest,null,2)+'\n','utf8');renameSync(tmp,dest);}
  finally{if(existsSync(tmp))rmSync(tmp);}
  console.log('Planet maps ready in the ignored local texture cache. Run the private Desktop build.');
}
main().catch(error=>{console.error('Planet texture download failed:',error.message);process.exitCode=1;});
