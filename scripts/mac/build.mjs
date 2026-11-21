#!/usr/bin/env node
// Run from an ordinary macOS Terminal: node scripts/mac/build.mjs [--original] [--release]
// Clones pinned, public sibling source, checks packages/data, builds Tauri .app and .dmg.
// Also used by the manually dispatched, read-only macOS GitHub Action. Never automatically publishes or exports credentials.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, copyFileSync, existsSync, lstatSync, mkdirSync,
  readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {macTarget, parseBuildOptions, PINNED, releaseCredentialsPresent, DOWNLOADS} from './release-common.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PARENT=dirname(ROOT);
const OPTIONS=parseBuildOptions(process.argv.slice(2));
const TARGET=macTarget(process.arch);
const log=message=>console.log('[VirgoStars macOS] '+message);
function check(ok,message) {if(!ok) throw new Error(message);}
function command(binary,args,cwd=ROOT,env=process.env,quiet=false) {
  const r=spawnSync(binary,args,{cwd,env,encoding:'utf8',stdio:quiet?['ignore','pipe','pipe']:'inherit',shell:false});
  if(r.error || r.status!==0) throw new Error(binary+' failed ('+args.slice(0,3).join(' ')+')'+
    (quiet?': '+String(r.stderr).slice(0,1500):''));
  return quiet?r.stdout.trim():'';
}
function git(...args) {return command('git',args,ROOT,process.env,true);}
function checkTools() {
  check(process.platform==='darwin','This command must be run natively on macOS');
  check(['arm64','x64'].includes(process.arch),'Use Apple Silicon or Intel x64 Node.js');
  const v=process.versions.node.split('.').map(Number);
  check((v[0]===22 && v[1]>=12) || v[0]===24,
    'Install Node.js 22.12+ or Node.js 24 (supported majors only)');
  for(const [name,args] of [
    ['git',['--version']],['npm',['--version']],['cargo',['--version']],
    ['rustc',['--version']],['python3',['--version']],['curl',['--version']],
    ['xcode-select',['-p']],['xcrun',['--find','clang']],
    ['hdiutil',['help']],['codesign',['--help']]
  ]) {
    const r=spawnSync(name,args,{stdio:'ignore',shell:false});
    // hdiutil help / codesign help often return nonzero on successful usage text.
    check(!r.error && (['hdiutil','codesign'].includes(name) || r.status===0),
      'Missing '+name+'. Install Xcode Command Line Tools, Node 22/24, Rust 1.90+, Python 3 and curl first.');
  }
  const rust=command('rustc',['--version'],ROOT,process.env,true);
  const match=/^rustc (\d+)\.(\d+)\./.exec(rust);
  check(match && (Number(match[1])>1 || Number(match[2])>=90),
    'Rust 1.90 or newer is required');
  const host=command('rustc',['-vV'],ROOT,process.env,true);
  check(host.includes('host: '+TARGET),'Native Rust/Node architecture mismatch: expected '+TARGET);
  check(!git('status','--porcelain'),'Commit or stash source changes before preparing an identifiable Mac build');
}
function clonePinned(name) {
  const path=join(PARENT,name), sha=PINNED[name];
  check(Boolean(sha), 'No fixed source revision for '+name);
  if(!existsSync(path)) {
    log('Cloning '+name+' at approved source revision');
    command('git',['clone','--quiet','https://github.com/Cesare-ml/'+name+'.git',path]);
    command('git',['-C',path,'checkout','--detach','--quiet',sha]);
  }
  check(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(),
    'Invalid sibling checkout: '+name);
  const actual=command('git',['-C',path,'rev-parse','HEAD'],ROOT,process.env,true);
  check(actual===sha, 'Existing sibling checkout '+name+' has a different revision. Use a clean sibling checkout at '+sha);
  check(!command('git',['-C',path,'status','--porcelain'],ROOT,process.env,true),
    'Uncommitted edits in sibling '+name+'; use a clean checkout');
  return path;
}
async function digest(path) {
  const hash=createHash('sha256');
  for await(const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function main() {
  checkTools();
  if(OPTIONS.release) {
    check(releaseCredentialsPresent(process.env),
      'Release requires APPLE_SIGNING_IDENTITY (Developer ID), APPLE_TEAM_ID, APPLE_ID and APPLE_PASSWORD in this terminal; do not send them to anyone');
  }
  log('Target: '+TARGET+'; artwork: '+(OPTIONS.original?'original':'synthetic')+
    '; mode: '+(OPTIONS.release?'signed and notarized':'local test'));
  const charts=clonePinned('astrological-charts');
  clonePinned('astrological-functions');
  if(OPTIONS.original) {
    const assets=clonePinned('astrological-assets');
    if(OPTIONS.release) {
      // A published repository is not the same thing as public artwork clearance.
      command('npm',['run','check:public-release'],assets);
    }
  }
  log('Installing exact JS dependencies and building charts renderer');
  command('npm',['ci'],charts);
  command('npm',['run','build:library'],charts);
  command('npm',['run','demo:pack'],charts);
  command('npm',['ci']);
  command('npm',['run','verify:version']);
  command('npm',['test']);
  command('npm',['run','verify:ipc']);
  log('Staging independently hashed city data and public DE441 base');
  command(process.execPath,['scripts/mac/prepare-public-data.mjs']);
  command('npm',['run',OPTIONS.original?'build:ui:private':'build:ui']);
  if(OPTIONS.original) {
    // The manifest verifier checks checksums, this gate additionally requires
    // every core zodiac/planetary glyph the desktop actually renders.
    log('Checking real planet and zodiac glyphs in the built offline frontend');
    command(process.execPath,['scripts/mac/verify-glyph-bundle.mjs']);
  }
  command('npm',['run','prepare:icon']);
  log('Fetching locked Rust dependencies before the offline license inventory');
  command('cargo',['fetch','--locked','--target',TARGET,'--manifest-path','src-tauri/Cargo.toml']);
  log('Auditing platform-specific native and frontend license notices');
  command(process.execPath,['scripts/ephemeris/prepare-release-notices.mjs','--target',TARGET]);
  log('Building native macOS application and DMG');
  const tauriArgs=OPTIONS.original?
    ['scripts/run-tauri-with-local-stars.mjs','build']:
    [join(ROOT,'node_modules','@tauri-apps','cli','tauri.js'),'build'];
  tauriArgs.push('--bundles','app,dmg','--config','src-tauri/tauri.macos.conf.json',
    '--config','.local/places/tauri-places.conf.json',
    '--config','.local/ephemeris/tauri-ephemeris.conf.json',
    '--config','.local/release-licenses/tauri-license.conf.json');
  const environment={...process.env,VIRGOSTARS_DE441_CATALOG_SHA256:DOWNLOADS.catalog.sha256};
  if(!OPTIONS.release) {
    environment.APPLE_SIGNING_IDENTITY='-'; // ad-hoc for local test, not a notarized release.
    delete environment.APPLE_ID;
    delete environment.APPLE_PASSWORD;
    delete environment.APPLE_TEAM_ID;
  }
  command(process.execPath,tauriArgs,ROOT,environment);
  const version=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version;
  const dmgDir=join(ROOT,'src-tauri','target','release','bundle','dmg');
  const appDir=join(ROOT,'src-tauri','target','release','bundle','macos');
  const dmgs=readdirSync(dmgDir).filter(file=>file.endsWith('.dmg') && file.includes(version));
  const apps=readdirSync(appDir).filter(file=>file.endsWith('.app'));
  check(dmgs.length===1 && apps.length===1,
    'Expected exactly one DMG for this version and one .app; inspect stale bundle outputs');
  const dmg=join(dmgDir,dmgs[0]), app=join(appDir,apps[0]);
  command('hdiutil',['verify',dmg]);
  if(OPTIONS.release) {
    command('codesign',['--verify','--deep','--strict','--verbose=2',app]);
    command('xcrun',['stapler','validate',dmg]);
  }
  const sourceCommit=git('rev-parse','HEAD');
  const output=join(ROOT,'.local','mac','output',version,process.arch);
  mkdirSync(output,{recursive:true});
  const filename='VirgoStars-Desktop-'+version+'-macos-'+process.arch+'.dmg';
  const finalPath=join(output,filename);
  check(!existsSync(finalPath),'Output exists already; do not silently replace a previous build');
  copyFileSync(dmg,finalPath);
  const sum=await digest(finalPath);
  const report={
    schema:'virgostars.macos.build/1',
    version,sourceCommit,platform:'darwin',arch:process.arch,
    nativeTarget:TARGET,
    dependencyCommits:PINNED,
    artwork:OPTIONS.original?(OPTIONS.release?'rights-cleared-original':'original-uncleared'):'synthetic',
    datasets:{cityArchiveSha256:DOWNLOADS.cities.sha256,de441BaseSha256:DOWNLOADS.de441.sha256},
    signing:OPTIONS.release?'apple-developer-notarized':'ad-hoc',
    releaseEligible:OPTIONS.release,
    artifacts:[{file:filename,sha256:sum,bytes:statSync(finalPath).size}],
    limitations:['No USNO Delta-T tables, Chiron SPK or optional private stellar catalog in public data stage',
      'macOS account, archive, graphics and updater behavior require a real-device acceptance test',
      'No updater macOS archive/manifest is produced by this first DMG pipeline']
  };
  writeFileSync(join(output,'build-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  writeFileSync(join(output,'SHA256SUMS.txt'),sum+'  '+filename+'\n',{flag:'wx'});
  log('DMG ready: '+finalPath);
  log(OPTIONS.release?'Developer-signed/notarized package; run macOS acceptance before publishing.':
    'Local test package only. Not notarized: do NOT publish as an ordinary public release.');
  log('Report and SHA256SUMS.txt are in the same output directory.');
}
main().catch(error=>{console.error('MAC_BUILD_FAILED:',error.message);process.exitCode=1;});
