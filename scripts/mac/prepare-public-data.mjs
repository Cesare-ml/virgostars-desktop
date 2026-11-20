// Prepare only publicly published, pinned datasets for a macOS test build.
// No third-party artwork, user information, credentials or mutable network manifests.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, copyFileSync, existsSync, lstatSync, mkdirSync,
  readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DOWNLOADS} from './release-common.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCAL=join(ROOT,'.local');
const DOWNLOAD_DIR=join(LOCAL,'mac','downloads');
const STAGE=join(LOCAL,'ephemeris');

function check(ok,message) {if(!ok) throw new Error(message);}
function exec(command,args) {
  const result=spawnSync(command,args,{cwd:ROOT,stdio:'inherit',shell:false});
  if(result.error || result.status!==0) throw new Error(command+' failed: '+args[0]);
}
async function digest(path) {
  const hash=createHash('sha256');
  for await(const block of createReadStream(path)) hash.update(block);
  return hash.digest('hex');
}
async function exactFile(path,expected,size) {
  check(existsSync(path), 'Expected file is missing');
  const stat=lstatSync(path);
  check(stat.isFile() && !stat.isSymbolicLink(), 'Unexpected file type or symlink');
  if(size !== undefined) check(stat.size===size, 'File size differs from pinned data');
  check(await digest(path)===expected, 'SHA-256 does not match pinned data');
}
async function download(url,destination,expected,size) {
  if(existsSync(destination)) {
    await exactFile(destination,expected,size);
    return;
  }
  mkdirSync(dirname(destination),{recursive:true});
  const partial=destination+'.partial-'+process.pid;
  check(!existsSync(partial),'Previous incomplete download: investigate before retrying');
  try {
    exec('curl',['--fail','--show-error','--silent','--location','--retry','3',
      '--proto','=https','--proto-redir','=https','--output',partial,url]);
    await exactFile(partial,expected,size);
    renameSync(partial,destination);
  } finally {
    if(existsSync(partial)) rmSync(partial);
  }
}
async function putVerified(source,destination,expected,size) {
  await exactFile(source,expected,size);
  mkdirSync(dirname(destination),{recursive:true});
  if(!existsSync(destination)) copyFileSync(source,destination);
  await exactFile(destination,expected,size);
}
function stableText(path,content) {
  if(existsSync(path)) {
    const stat=lstatSync(path);
    check(stat.isFile() && !stat.isSymbolicLink() && readFileSync(path,'utf8')===content,
      'Previously staged Mac configuration differs; investigate before retrying');
    return;
  }
  writeFileSync(path,content,{flag:'wx'});
}
async function main() {
  check(process.argv.length===2,'No parameters are supported');
  mkdirSync(DOWNLOAD_DIR,{recursive:true});
  const citiesArchive=join(DOWNLOAD_DIR,'world-cities.zip');
  await download(DOWNLOADS.cities.url,citiesArchive,DOWNLOADS.cities.sha256);
  check(statSync(citiesArchive).size <= DOWNLOADS.cities.maxBytes,
    'The downloaded city archive exceeds its maximum permitted size');
  exec('python3',['scripts/places/fetch_catalog.py','--archive',citiesArchive]);
  exec('python3',['scripts/places/prepare_tauri_bundle.py']);
  exec(process.execPath,['scripts/verify-places-tauri-override.mjs']);

  const baseArchive=join(DOWNLOAD_DIR,'de441-v2-desktop-core-1000-2200.eph');
  await download(DOWNLOADS.de441.url,baseArchive,DOWNLOADS.de441.sha256,DOWNLOADS.de441.bytes);
  const sourceCatalog=join(ROOT,'src-tauri','de441-release-catalog-v1.json');
  await exactFile(sourceCatalog,DOWNLOADS.catalog.sha256);
  const catalog=JSON.parse(readFileSync(sourceCatalog,'utf8'));
  const required=catalog.packs?.filter(pack=>pack.required);
  check(catalog.schema==='virgostars.de441.release-catalog.v1' &&
    catalog.releaseTag==='de441-desktop-v1.0.0' &&
    required?.length===1 &&
    required[0].sha256===DOWNLOADS.de441.sha256 &&
    required[0].bytes===DOWNLOADS.de441.bytes &&
    required[0].firstYear===1000 && required[0].lastYear===2200,
    'The pinned astronomical catalog no longer matches the packaged DE441 base');
  const bundledBase=join(STAGE,'de441-slice.eph');
  const bundledCatalog=join(STAGE,'de441-release-catalog-v1.json');
  await putVerified(baseArchive,bundledBase,DOWNLOADS.de441.sha256,DOWNLOADS.de441.bytes);
  await putVerified(sourceCatalog,bundledCatalog,DOWNLOADS.catalog.sha256);
  const manifest={
    schema:'virgostars.desktop.macos-public-data.v1',
    note:'Base DE441 only: no bundled USNO Delta-T, Chiron SPK or private star catalog.',
    coverage:{firstYear:1000,lastYear:2200},
    files:[
      {name:'de441-slice.eph',bytes:DOWNLOADS.de441.bytes,sha256:DOWNLOADS.de441.sha256},
      {name:'de441-release-catalog-v1.json',sha256:DOWNLOADS.catalog.sha256}
    ]
  };
  stableText(join(STAGE,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const config={
    bundle:{
      active:true,
      resources:{
        '../.local/ephemeris/de441-slice.eph':'ephemeris/de441-slice.eph',
        '../.local/ephemeris/de441-release-catalog-v1.json':'ephemeris/de441-release-catalog-v1.json',
        '../.local/ephemeris/manifest.json':'ephemeris/manifest.json'
      }
    }
  };
  stableText(join(STAGE,'tauri-ephemeris.conf.json'),JSON.stringify(config,null,2)+'\n');
  console.log('Verified and staged public city catalog and DE441 1000–2200 base.');
}
main().catch(error=>{console.error('MAC_PUBLIC_DATA_FAILED:',error.message);process.exitCode=1;});
