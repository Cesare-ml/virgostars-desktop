import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {stagePlanetTextures} from '../scripts/sky3d/stage-planet-textures.mjs';
import {TEXTURES,TEXTURE_SOURCE,TEXTURE_LICENSE,TEXTURE_CREDIT} from '../scripts/sky3d/texture-sources.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'sky3d-textures-'));
  const cache=join(root,'.local','sky3d','textures');
  mkdirSync(cache,{recursive:true});
  const images=TEXTURES.map(([id,name],i)=>{
    // Structural test image only: JPEG signature/size, not a real image.
    const bytes=Buffer.alloc(6001,(i+3)%240);
    bytes[0]=255;bytes[1]=216;
    bytes[bytes.length-2]=255;bytes[bytes.length-1]=217;
    writeFileSync(join(cache,name),bytes);
    return {id,name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  writeFileSync(join(cache,'manifest.json'),JSON.stringify({
    schemaVersion:1,source:'Solar System Scope',baseUrl:TEXTURE_SOURCE,
    license:TEXTURE_LICENSE,credit:TEXTURE_CREDIT,images,
  }));
  return {root,cache,images};
}
const output=root=>join(root,'.local','sky3d-real-textures.private.ts');

test('private planet map staging is deterministic, offline and exact-sha-verified',()=>{
  const f=fixture();
  try{
    assert.equal(stagePlanetTextures(f.root),TEXTURES.length);
    const text=readFileSync(output(f.root),'utf8');
    for(const [id] of TEXTURES)assert.ok(text.includes('"'+id+'":"data:image/jpeg;base64,'),id);
    assert.match(text,/Readonly<Record<string,string>>=Object.freeze/);
    assert.match(text,/Solar System Scope; CC BY 4\.0/);
    assert.equal(stagePlanetTextures(f.root),TEXTURES.length);
    assert.equal(readFileSync(output(f.root),'utf8'),text);
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('without an opt-in cache the private build creates a safe empty module',()=>{
  const root=mkdtempSync(join(tmpdir(),'sky3d-empty-'));
  try{
    assert.equal(stagePlanetTextures(root),0);
    assert.match(readFileSync(output(root),'utf8'),/Object\.freeze\(\{\}\)/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('manipulated texture bytes and incomplete manifests fail closed',()=>{
  const f=fixture();
  try{
    const [id,name]=TEXTURES[0];
    writeFileSync(join(f.cache,name),Buffer.alloc(6001,8));
    assert.throws(()=>stagePlanetTextures(f.root),/checksum mismatch/);
    assert.equal(id,'Sun');
  }finally{rmSync(f.root,{recursive:true,force:true});}
});

test('private package uses the explicit, credited texture opt-in; public build stays unchanged',()=>{
  const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const angular=JSON.parse(read('angular.json'));
  const scripts=JSON.parse(read('package.json')).scripts;
  const replacements=angular.projects.desktop.architect.build.configurations['private-artwork'].fileReplacements;
  assert.ok(replacements.some(item=>item.replace==='src/app/sky-dome-real-textures.ts'&&
    item.with==='.local/sky3d-real-textures.private.ts'));
  assert.match(scripts['prepare:frontend:private'],/sky3d:textures:stage/);
  assert.equal(scripts['sky3d:textures:download'],'node scripts/sky3d/download-planet-textures.mjs');
  assert.match(read('src/app/sky-dome-real-textures.ts'),/Object\.freeze\(\{\}\)/);
  assert.match(read('src/app/sky-dome.component.ts'),/REAL_PLANET_TEXTURES\[point\.id\]/);
  assert.doesNotMatch(read('src/app/sky-dome-real-textures.ts'),/https?:\/\/|data:image/);
});
