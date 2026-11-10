import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseEnvironment, formatReport, supportsNode } from '../scripts/desktop-doctor.mjs';

const root='/fake/desktop', charts='/fake/astrological-charts';
const baseFiles=new Set([
  charts+'/package.json', root+'/package.json',root+'/angular.json',root+'/src-tauri/tauri.conf.json'
]);
function dependencies({stage='setup', platform='linux', additional=[], versions={}}={}) {
  const files=new Set([...baseFiles,...additional]);
  const map={
    [root+'/package.json']:{ dependencies:{ 'grafici-astrologici':'file:../astrological-charts/dist/grafici-astrologici' } },
    [charts+'/package.json']:{name:'grafici-astrologici'},
    [root+'/angular.json']:{projects:{desktop:{architect:{build:{options:{outputPath:'dist/desktop'}}}}}},
    [root+'/src-tauri/tauri.conf.json']:{build:{frontendDist:'../dist/desktop/browser'},bundle:{active:false}},
  };
  const command=(name,args)=>{
    if(name==='cargo') return 'cargo 1.9';
    if(name==='rustc') return versions.rust || 'rustc 1.9\nhost: x86_64-pc-windows-msvc';
    if(name==='npm' || name==='where.exe') return 'installed';
    if(name.endsWith('vswhere.exe')) return 'VS installed';
    if(name==='reg.exe') return 'registry present';
    return null;
  };
  return diagnoseEnvironment({root,charts,stage,platform,nodeVersion:'v22.16.0',exists:file=>files.has(file),json:file=>map[file]??null,command});
}
const find=(report,key)=>report.checks.find(item=>item.id===key);

test('Node 22.12+ / 24 satisfy the declared Desktop engines',()=>{
  for(const version of ['v22.12.0','v22.16.0','v24.0.0','v24.7.1'])assert.equal(supportsNode(version),true,version);
  for(const version of ['v22.11.0','v20.19.0','v25.0.0','weird','v22.10'])assert.equal(supportsNode(version),false,version);
});

test('setup allows installing missing build outputs after prerequisite checks',()=>{
  const report=dependencies();
  assert.equal(find(report,'renderer-contract').status,'pass');
  assert.equal(find(report,'frontend-target').status,'pass');
  assert.equal(find(report,'charts-library').status,'warning');
  assert.equal(find(report,'synthetic-manifest').status,'warning');
  assert.equal(find(report,'desktop-dependencies').status,'warning');
  assert.equal(report.counts.blocked,0);
});

test('build stage clearly blocks absent renderer and asset pack',()=>{
  const report=dependencies({stage:'build'});
  assert.equal(find(report,'charts-library').status,'blocked');
  assert.equal(find(report,'synthetic-manifest').status,'blocked');
  assert.equal(find(report,'desktop-dependencies').status,'blocked');
});

test('build stage passes with compiled package, synthetic pack and CLI',()=>{
  const report=dependencies({stage:'build',additional:[
    charts+'/dist/grafici-astrologici/package.json',
    charts+'/.local/demo-pack/manifests/approved-assets.json',
    root+'/node_modules/.bin/ng'
  ]});
  assert.equal(report.counts.blocked,0);
  assert.equal(find(report,'charts-library').status,'pass');
});

test('wrong local renderer dependency never silently passes',()=>{
  const report=diagnoseEnvironment({root,charts,nodeVersion:'v22.16.0',
    exists:file=>baseFiles.has(file),command:()=> 'installed',
    json:file=>file===charts+'/package.json' ? {name:'grafici-astrologici'} :
      file===root+'/package.json' ? {dependencies:{'grafici-astrologici':'https://example.org/not-approved'}} :
      file===root+'/angular.json' ? {projects:{desktop:{architect:{build:{options:{outputPath:'dist/desktop'}}}}}} :
      file===root+'/src-tauri/tauri.conf.json' ? {build:{frontendDist:'../dist/desktop/browser'},bundle:{active:false}} : null,
  });
  assert.equal(find(report,'renderer-contract').status,'blocked');
});

test('verify stage requires a compiled frontend, unlike setup',()=>{
  const report=dependencies({stage:'verify'});
  assert.equal(find(report,'angular-bundle').status,'blocked');
});

test('non-Windows host and absence of sensitive path details are explicit',()=>{
  const report=dependencies({platform:'linux'});
  assert.equal(find(report,'host-platform').status,'warning');
  const lines=formatReport(report);
  assert.match(lines,/\[WARN\] host-platform/);
  assert.match(lines,/No credentials, user files or network services/);
  assert.doesNotMatch(lines,/\/fake\/desktop|\/fake\/astrological-charts/);
});

test('Windows MSVC toolchain requires windows-msvc host',()=>{
  const report=dependencies({platform:'win32',versions:{rust:'rustc 1.9\nhost: x86_64-unknown-linux-gnu'}});
  assert.equal(find(report,'rust-target').status,'blocked');
});

test('warning on uncertain WebView2 registry presence is not a false missing report',()=>{
  const report=diagnoseEnvironment({platform:'win32',root,charts,exists:file=>baseFiles.has(file),
    command:(name,args)=>name==='reg.exe'?null:'installed',
    json:file=>file===charts+'/package.json'?{name:'grafici-astrologici'}:
      file===root+'/package.json'?{dependencies:{'grafici-astrologici':'file:../astrological-charts/dist/grafici-astrologici'}}:
      file===root+'/angular.json'?{projects:{desktop:{architect:{build:{options:{outputPath:'dist/desktop'}}}}}}:
      file===root+'/src-tauri/tauri.conf.json'?{build:{frontendDist:'../dist/desktop/browser'},bundle:{active:false}}:null,
  });
  assert.equal(find(report,'webview2').status,'warning');
});
