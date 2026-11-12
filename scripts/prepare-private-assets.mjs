/** Stage the owner's approved private artwork separately from synthetic fixtures. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Hash the Git-normalized UTF-8 manifest, so Windows CRLF checkouts match Unix LF.
export const PRIVATE_MANIFEST_SHA256 = 'a94d7a30f812f5e20e1cec716413b54e0a3c5d1bae8fb7ece1fe0cb40b3b8fbc';
export const PRIVATE_MANIFEST_FILE = 'approved-assets.json';
const MAX_FILES = 2000, MAX_FILE_BYTES = 20_000_000, MAX_TOTAL_BYTES = 200_000_000;
const IMAGE_PATH = /^img\/[a-zA-Z0-9_.@ /-]+\.(png|jpg|jpeg|webp)$/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestHash = bytes => hash(Buffer.from(bytes.toString('utf8').replace(/\r\n/g,'\n'),'utf8'));
function check(ok, message) { if (!ok) throw new Error(message); }
function regular(path, dir=false) {
  const s=lstatSync(path);
  check(!s.isSymbolicLink() && (dir?s.isDirectory():s.isFile()), 'Unsafe file or directory: '+path);
}
function safeParts(path) {
  check(typeof path==='string' && IMAGE_PATH.test(path) &&
    path.split('/').every(p=>p && p!=='.' && p!=='..' && p.length<200), 'Invalid image path');
  return path.split('/');
}
function readSafe(root, parts) {
  let file=root;
  for(let i=0;i<parts.length;i++) { file=join(file,parts[i]); regular(file,i<parts.length-1); }
  return readFileSync(file);
}
function filesIn(dir, rel='') {
  const result=[];
  for(const item of readdirSync(join(dir,rel),{withFileTypes:true})) {
    check(!item.isSymbolicLink(),'Symbolic link in private asset stage');
    const path=rel?rel+'/'+item.name:item.name;
    if(item.isDirectory()) result.push(...filesIn(dir,path));
    else { check(item.isFile(),'Unexpected asset stage entry'); result.push(path); }
  }
  return result;
}

/** The expected hash is fixed in production; tests can inject synthetic manifests. */
export function validatePrivateManifest(bytes, expectedHash=PRIVATE_MANIFEST_SHA256) {
  check(manifestHash(bytes)===expectedHash,'Private asset manifest checksum mismatch');
  const manifest=JSON.parse(bytes.toString('utf8'));
  check(manifest.schemaVersion===1 && manifest.source?.repository==='Cesare-ml/virgo-stars' &&
    manifest.source?.assetRoot==='public/assets' && /^[0-9a-f]{40}$/.test(manifest.source?.commit ?? '') &&
    Array.isArray(manifest.assets) && manifest.assets.length>0 && manifest.assets.length<=MAX_FILES,
    'Invalid approved private asset manifest');
  let total=0; const seen=new Set();
  for(const item of manifest.assets) {
    safeParts(item.path);
    const key=item.path.normalize('NFC').toLowerCase();
    check(!seen.has(key),'Duplicate private asset path'); seen.add(key);
    check(item.status===undefined || item.status==='approved','Private asset is not approved');
    check(Number.isSafeInteger(item.bytes) && item.bytes>=0 && item.bytes<=MAX_FILE_BYTES &&
      typeof item.sha256==='string' && /^[0-9a-f]{64}$/.test(item.sha256), 'Invalid private asset metadata');
    for(const field of ['rightsHolder','permissionBasis','approvalEvidence'])
      check(typeof item[field]==='string' && item[field].trim().length>0,'Missing private asset approval metadata');
    total+=item.bytes; check(total<=MAX_TOTAL_BYTES,'Private assets exceed size limit');
  }
  return manifest;
}

export function preparePrivateAssets(sourcePath, destinationPath, expectedHash=PRIVATE_MANIFEST_SHA256) {
  const source=resolve(sourcePath), destination=resolve(destinationPath);
  regular(source,true);
  for(const dir of ['manifests','catalog','public','public/assets']) regular(join(source,dir),true);
  const manifestBytes=readSafe(source,['manifests',PRIVATE_MANIFEST_FILE]);
  const manifest=validatePrivateManifest(manifestBytes,expectedHash);
  const approval=JSON.parse(readSafe(source,['catalog','approvals.json']).toString('utf8'));
  check(approval.schemaVersion===1 && Array.isArray(approval.assets),'Invalid approval catalog');
  const reviewed=new Map();
  for(const item of approval.assets) {
    check(typeof item.path==='string' && !reviewed.has(item.path),'Duplicate approval record');
    reviewed.set(item.path,item);
  }
  const sourceAssets=join(source,'public/assets');
  const files=manifest.assets.map(item=>{
    const approved=reviewed.get(item.path);
    check(approved?.status==='approved' && ['rightsHolder','permissionBasis','approvalEvidence']
      .every(field=>approved[field]===item[field]), 'Asset approval does not match manifest: '+item.path);
    const parts=safeParts(item.path), bytes=readSafe(sourceAssets,parts);
    check(bytes.length===item.bytes && hash(bytes)===item.sha256,'Private asset checksum mismatch: '+item.path);
    return {path:item.path,parts,bytes,sha256:item.sha256};
  });
  if(existsSync(destination)) {
    regular(destination,true);regular(join(destination,'assets'),true);
    check(manifestHash(readSafe(destination,[PRIVATE_MANIFEST_FILE]))===expectedHash,'Existing private stage differs');
    check(JSON.stringify(readdirSync(destination).sort())===JSON.stringify(['assets',PRIVATE_MANIFEST_FILE].sort()),
      'Unexpected content in private asset stage');
    check(JSON.stringify(filesIn(join(destination,'assets')).sort())===JSON.stringify(files.map(x=>x.path).sort()),
      'Existing private stage has unexpected or missing files');
    for(const file of files) {
      const bytes=readSafe(join(destination,'assets'),file.parts);
      check(bytes.length===file.bytes.length && hash(bytes)===file.sha256,'Existing private asset stage is modified');
    }
    return {count:files.length,reused:true};
  }
  const staging=destination+'.staging-'+process.pid;
  check(!existsSync(staging),'Private staging directory already exists');
  try {
    mkdirSync(join(staging,'assets'),{recursive:true});
    for(const file of files) {
      const out=join(staging,'assets',...file.parts); mkdirSync(dirname(out),{recursive:true});
      writeFileSync(out,file.bytes,{flag:'wx'});
    }
    writeFileSync(join(staging,PRIVATE_MANIFEST_FILE),manifestBytes,{flag:'wx'});
    renameSync(staging,destination);
    return {count:files.length,reused:false};
  } catch(error) { rmSync(staging,{recursive:true,force:true}); throw error; }
}

if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try {
    check(process.argv.length===2,'No command-line options are supported');
    const result=preparePrivateAssets(resolve(ROOT,'../astrological-assets'),resolve(ROOT,'.local/frontend-private'));
    console.log((result.reused?'Reused ':'Staged ')+result.count+' verified, owner-approved private images.');
  } catch(error) { console.error('PRIVATE ASSET STAGING FAILED:',error.message); process.exitCode=1; }
}
