#!/usr/bin/env node
// Read-only preflight of Git's tracked filenames for Windows checkout safety.
// Does not check bundle contents, symlink targets, real runtime or signers.
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const MAX_BYTES=4*1024*1024;
const MAX_FILES=20000;
const INVALID=/[<>:"\\|?*\x00-\x1f\x7f]/u;
// Windows reserves CONIN$/CONOUT$ and the historic superscript device digits.
const RESERVED=/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu;
function fail(reason){throw new Error('WINDOWS TRACKED PATHS: '+reason);}

/** Validate a set of Git paths, without revealing filenames in errors. */
export function checkTrackedPaths(paths){
  if(!Array.isArray(paths)||paths.length===0||paths.length>MAX_FILES)
    fail('invalid tracked-file count');
  const seenFiles=new Set();
  const seenDirectoryParts=new Set();
  for(const path of paths){
    if(typeof path!=='string'||!path||path.length>16384||path.startsWith('/')||path.endsWith('/'))
      fail('invalid tracked path');
    const segments=path.split('/');
    for(const segment of segments){
      if(!segment||segment==='.'||segment==='..'||segment.length>255||
        INVALID.test(segment)||/[. ]$/u.test(segment)||RESERVED.test(segment))
        fail('nonportable Windows path component');
    }
    const normalized=segments.map(segment=>segment.normalize('NFC').toLowerCase());
    const key=normalized.join('/');
    if(seenFiles.has(key))fail('case-insensitive or Unicode duplicate tracked path');
    seenFiles.add(key);
    for(let i=1;i<normalized.length;i++)
      seenDirectoryParts.add(normalized.slice(0,i).join('/'));
  }
  for(const key of seenFiles){
    if(seenDirectoryParts.has(key))fail('tracked file/directory path collision');
  }
  return {files:seenFiles.size,windowsPortableNames:true};
}

/** Fatal UTF-8 decode and explicit NUL records; never silently skip a path. */
export function parseTrackedGitPaths(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length===0||bytes.length>MAX_BYTES||bytes.at(-1)!==0)
    fail('incomplete Git tracked-path output');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const paths=[];
  let start=0;
  for(let i=0;i<bytes.length;i++){
    if(bytes[i]!==0)continue;
    if(i===start)fail('empty tracked path record');
    try{paths.push(decoder.decode(bytes.subarray(start,i)));}
    catch{fail('invalid UTF-8 tracked path');}
    if(paths.length>MAX_FILES)fail('invalid tracked-file count');
    start=i+1;
  }
  return checkTrackedPaths(paths);
}

export function inspectTrackedPaths(root=ROOT){
  const base=resolve(root);
  const head=spawnSync('git',['rev-parse','--show-toplevel'],{
    cwd:base,encoding:'utf8',maxBuffer:8192,windowsHide:true});
  if(head.error||head.signal||head.status!==0||typeof head.stdout!=='string')
    fail('Git repository root unavailable');
  const actual=head.stdout.trim();
  const canonical=path=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
  if(!actual||canonical(actual)!==canonical(base))
    fail('Git checkout root mismatch');
  const result=spawnSync('git',['ls-files','--cached','-z','--full-name','--'],{
    cwd:base,encoding:null,maxBuffer:MAX_BYTES,windowsHide:true});
  if(result.error||result.signal||result.status!==0)
    fail('Git tracked-file listing failed');
  return parseTrackedGitPaths(result.stdout);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==2)fail('unexpected CLI arguments');
    const result=inspectTrackedPaths();
    console.log('WINDOWS TRACKED PATHS: '+result.files+' tracked filenames checked.');
    console.log('Path-name portability only; no build, network, merge or file writes.');
  }catch(error){
    const msg=error instanceof Error&&error.message.startsWith('WINDOWS TRACKED PATHS:')
      ?error.message:'WINDOWS TRACKED PATHS: inspection failed';
    console.error(msg);
    process.exitCode=1;
  }
}
