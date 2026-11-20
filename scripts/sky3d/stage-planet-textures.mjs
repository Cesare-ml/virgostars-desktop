#!/usr/bin/env node
/** Build a self-contained, offline private-artwork TS module from the user's
 * opt-in Solar System Scope image cache. The JS bundle carries the images;
 * no unmanifested files enter the protected browser assets directory.
 */
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TEXTURES,TEXTURE_SOURCE,TEXTURE_LICENSE,TEXTURE_CREDIT} from './texture-sources.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const CACHE=resolve(ROOT,'.local/sky3d/textures');
const OUT=resolve(ROOT,'.local/sky3d-real-textures.private.ts');
function assert(ok,message){if(!ok)throw Error(message);}
function safeFile(path) {
  const stat=lstatSync(path);
  assert(stat.isFile()&&!stat.isSymbolicLink(),'Unsafe texture cache file');
  return readFileSync(path);
}
function dataFromCache() {
  const manifestPath=join(CACHE,'manifest.json');
  if(!existsSync(manifestPath))return {};
  const manifest=JSON.parse(safeFile(manifestPath).toString('utf8'));
  assert(manifest.schemaVersion===1&&manifest.source==='Solar System Scope'&&
    manifest.baseUrl===TEXTURE_SOURCE&&manifest.license===TEXTURE_LICENSE&&
    manifest.credit===TEXTURE_CREDIT&&Array.isArray(manifest.images) &&
    manifest.images.length===TEXTURES.length,'Invalid texture attribution manifest');
  const out={};
  for(const [id,name] of TEXTURES){
    const entry=manifest.images.find(item=>item.id===id&&item.name===name);
    assert(entry&&Number.isSafeInteger(entry.bytes)&&entry.bytes>5000&&entry.bytes<3_000_000&&
      /^[a-f0-9]{64}$/.test(entry.sha256),'Missing or invalid texture manifest entry');
    const bytes=safeFile(join(CACHE,name));
    assert(bytes.length===entry.bytes&&
      createHash('sha256').update(bytes).digest('hex')===entry.sha256,
      'Texture cache checksum mismatch: '+id);
    assert(bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217,
      'Corrupted cached JPEG: '+id);
    out[id]='data:image/jpeg;base64,'+bytes.toString('base64');
  }
  return out;
}
export function stagePlanetTextures(root=ROOT) {
  assert(root===ROOT,'Unexpected staging destination');
  mkdirSync(dirname(OUT),{recursive:true});
  const textures=dataFromCache();
  const content='/** Solar System Scope; CC BY 4.0; credit in Cielo 3D and docs. '+TEXTURE_SOURCE+' */\n'
    +'export const REAL_PLANET_TEXTURES:Readonly<Record<string,string>>=Object.freeze('
    +JSON.stringify(textures)+');\n';
  const tmp=OUT+'.part';
  try{writeFileSync(tmp,content,'utf8');renameSync(tmp,OUT);}
  finally{if(existsSync(tmp))rmSync(tmp);}
  return Object.keys(textures).length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    assert(process.argv.length===2,'Unexpected arguments');
    const total=stagePlanetTextures();
    console.log(total?('Staged '+total+' credited real planet maps for the offline private build.'):
      'No opt-in planet texture cache: keeping locally generated portraits.');
  }catch(error){console.error('Planet texture stage failed:',error.message);process.exitCode=1;}
}
