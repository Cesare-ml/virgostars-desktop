import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {auditNativeIpc, auditCheckout} from '../scripts/verify-native-ipc.mjs';

function fixture() {
  return {
    entry:'tauri::Builder::default().invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns, connected_account_ipc::desktop_connected_account_v1])',
    rustModules:{
      runtime_probe:'#[tauri::command]\npub fn desktop_runtime_info() {}',
      offline_places:'#[tauri::command]\npub async fn search_offline_places() {}',
      chart_calculation:'#[tauri::command]\npub fn calculate_chart() {}',
      chart_archive:'#[tauri::command]\npub fn chart_archive() {}',
      return_search:'#[tauri::command]\npub fn find_returns() {}',
      connected_account_ipc:'#[tauri::command]\npub fn desktop_connected_account_v1() {}',
    },
    runtimeContract:"async function run(port) { return port.invoke('desktop_runtime_info'); }",
    placesContract:"async function search(port) { return port.invoke('search_offline_places', {query:'A'}); }",
    chartContract:"async function chart(port) { return port.invoke('calculate_chart', {request:{}}); }",
    archiveContract:"async function archive(port) { return port.invoke('chart_archive', {request:{}}); }",
    returnContract:"async function returns(port) { return port.invoke('find_returns', {request:{}}); }",
    accountContract:"async function account(port) { return port.invoke('desktop_connected_account_v1', {request:{}}); }",
    tsFiles:{
      'src/app/native/runtime.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command)=>invoke<unknown>(command);",
      'src/app/native/offline-places.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command,args)=>invoke<unknown>(command,args);",
      'src/app/native/chart-calculation.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command,args)=>invoke<unknown>(command,args);",
      'src/app/native/chart-archive.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command,args)=>invoke<unknown>(command,args);",
      'src/app/native/return-search.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command,args)=>invoke<unknown>(command,args);",
      'src/app/native/connected-account.ts':"import {invoke, isTauri} from '@tauri-apps/api/core'; const port=(command,args)=>invoke<unknown>(command,args);",
      'src/app/workspace-state.ts':'export const state=1;',
    },
    tauriConfig:{app:{security:{capabilities:[]}}},
  };
}

test('reviewed read-only registry and restricted adapters pass',()=>{
  const checked=auditNativeIpc(fixture());
  assert.deepEqual(checked.commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);
});
test('extra native command cannot enter without a conscious allowlist review',()=>{
  const f=fixture();f.entry=f.entry.replace('connected_account_ipc::desktop_connected_account_v1]', 'connected_account_ipc::desktop_connected_account_v1, account::read_token]');
  assert.throws(()=>auditNativeIpc(f),/command count/);
});
test('duplicate or missing native commands fail',()=>{
  for(const replacement of ['runtime_probe::desktop_runtime_info','other::mismatch']){
    const f=fixture(); f.entry=f.entry.replace('offline_places::search_offline_places', replacement);
    assert.throws(()=>auditNativeIpc(f),/command|allowlist/i);
  }
});
test('unregistered Tauri command function fails',()=>{
  const f=fixture();f.rustModules.offline_places += '\n#[tauri::command]\npub fn delete_catalog() {}';
  assert.throws(()=>auditNativeIpc(f),/Unregistered/);
});
test('missing Rust command function fails',()=>{
  const f=fixture();f.rustModules.runtime_probe='pub fn desktop_runtime_info() {}';
  assert.throws(()=>auditNativeIpc(f),/Unregistered/);
});
test('renamed Angular native commands fail the exact cross-language contract',()=>{
  const commandOf={runtimeContract:'desktop_runtime_info',placesContract:'search_offline_places',chartContract:'calculate_chart',archiveContract:'chart_archive',returnContract:'find_returns',accountContract:'desktop_connected_account_v1'};
  for(const which of Object.keys(commandOf)){
    const f=fixture();f[which]=f[which].replace(commandOf[which],'unreviewed_native_method');
    assert.throws(()=>auditNativeIpc(f),/contract command mismatch/);
  }
});
test('a third direct native IPC import cannot bypass the reviewed adapters',()=>{
  const f=fixture();f.tsFiles['src/app/new-feature.ts']="import {invoke} from '@tauri-apps/api/core';";
  assert.throws(()=>auditNativeIpc(f),/Unexpected Tauri import/);
});
test('dynamic adapter calls or missing adapters require review',()=>{
  const f=fixture();f.tsFiles['src/app/native/runtime.ts']=f.tsFiles['src/app/native/runtime.ts'].replace('invoke<unknown>(command)','invoke<unknown>(userText)');
  assert.throws(()=>auditNativeIpc(f),/adapter invoke changed/);
  const g=fixture();delete g.tsFiles['src/app/native/offline-places.ts'];
  assert.throws(()=>auditNativeIpc(g),/Missing reviewed Tauri adapter/);
});
test('Tauri capabilities and global API cannot be expanded silently',()=>{
  const f=fixture();f.tauriConfig.app.security.capabilities=['fs:default'];
  assert.throws(()=>auditNativeIpc(f),/capabilities changed/);
  const g=fixture();g.tauriConfig.app.withGlobalTauri=true;
  assert.throws(()=>auditNativeIpc(g),/Global Tauri bridge/);
});

test('frontend bootstrap cannot import Tauri directly',()=>{
  const f=fixture();
  f.tsFiles['src/main.ts']="import {invoke} from '@tauri-apps/api/core';";
  assert.throws(()=>auditNativeIpc(f),/Unexpected Tauri import/);
});

test('frontend dynamic imports are reviewed even outside Angular app directory',()=>{
  const f=fixture();
  f.tsFiles['src/features/helper.mjs']="const native = import('@tauri-apps/api/core');";
  assert.throws(()=>auditNativeIpc(f),/Unexpected Tauri import/);
});

test('an approved adapter cannot quietly import a privileged Tauri plugin',()=>{
  const f=fixture();
  f.tsFiles['src/app/native/runtime.ts'] += "\nimport {open} from '@tauri-apps/plugin-shell';";
  assert.throws(()=>auditNativeIpc(f),/Unexpected Tauri package or multiple Tauri references/);
});

test('unreviewed Tauri API exports, namespace imports and aliases are refused',()=>{
  for(const replacement of [
    "import {invoke, isTauri, convertFileSrc} from '@tauri-apps/api/core';",
    "import * as core from '@tauri-apps/api/core';",
    "import {invoke as execute, isTauri} from '@tauri-apps/api/core';",
  ]) {
    const f=fixture();
    f.tsFiles['src/app/native/runtime.ts']=f.tsFiles['src/app/native/runtime.ts'].replace(
      "import {invoke, isTauri} from '@tauri-apps/api/core';", replacement);
    assert.throws(()=>auditNativeIpc(f),/Unreviewed Tauri API import or alias|reviewed named import/);
  }
});

test('an approved adapter cannot issue a second direct native command',()=>{
  const f=fixture();
  f.tsFiles['src/app/native/runtime.ts'] += "\nconst extra = invoke<unknown>('get_secret');";
  assert.throws(()=>auditNativeIpc(f),/adapter invoke changed/);
});


test('checkout audit scans entrypoint and nested JavaScript/TypeScript sources',()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-ipc-audit-fixture-'));
  try {
    const f=fixture();
    const write=(path,content)=>{
      const target=join(root,path);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,content);
    };
    for(const [path,content] of Object.entries({
      'src-tauri/src/lib.rs':f.entry,
      'src-tauri/src/runtime_probe.rs':f.rustModules.runtime_probe,
      'src-tauri/src/offline_places.rs':f.rustModules.offline_places,
      'src-tauri/src/chart_calculation.rs':f.rustModules.chart_calculation,
      'src-tauri/src/chart_archive.rs':f.rustModules.chart_archive,
      'src-tauri/src/return_search.rs':f.rustModules.return_search,
      'src-tauri/src/connected_account_ipc.rs':f.rustModules.connected_account_ipc,
      'src-tauri/tauri.conf.json':JSON.stringify(f.tauriConfig),
      'src-tauri/build.rs':'fn main() { tauri_build::build(); }',
      'src/app/native/runtime-protocol.ts':f.runtimeContract,
      'src/app/native/offline-places-contract.ts':f.placesContract,
      'src/app/native/chart-calculation-contract.ts':f.chartContract,
      'src/app/native/chart-archive-contract.ts':f.archiveContract,
      'src/app/native/return-search-contract.ts':f.returnContract,
      'src/app/native/connected-account-contract.ts':f.accountContract,
      ...f.tsFiles,
      'src/main.ts':'export const demo = true;',
    })) write(path,content);
    assert.deepEqual(auditCheckout(root).commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);
    for(const [path,content] of [
      ['src/main.ts',"import('@tauri-apps/api/core');"],
      ['src/app/misc/native.tsx',"import {invoke} from '@tauri-apps/api/core';"],
      ['src/features/helpers.mjs',"import('@tauri-apps/plugin-fs');"],
      ['src/features/helpers.js',"import('@tauri-apps/api/core');"],
    ]) {
      write(path,content);
      assert.throws(()=>auditCheckout(root),/Unexpected Tauri import/,path);
      write(path,'export const ok = true;');
    }
    assert.deepEqual(auditCheckout(root).commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);
    // In Tauri 2 an empty capabilities array still auto-loads capability files.
    // An unexpected JSON/TOML permission file must fail closed.
    for(const name of ['unexpected.json','unexpected.toml','readme.txt']) {
      write('src-tauri/capabilities/'+name, 'unsafe capability');
      assert.throws(()=>auditCheckout(root),/auto-discovered capability files/,name);
      rmSync(join(root,'src-tauri/capabilities',name));
    }
    // An unknown nested capabilities directory can also introduce a new
    // capability later and must be reviewed rather than silently accepted.
    mkdirSync(join(root,'src-tauri/capabilities','nested'));
    assert.throws(()=>auditCheckout(root),/auto-discovered capability files/);
    rmSync(join(root,'src-tauri/capabilities','nested'),{recursive:true});
    assert.deepEqual(auditCheckout(root).commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);
    // A command in a newly added nested Rust file must not evade the audit.
    write('src-tauri/src/features/new_command.rs',
      '#[tauri::command]\npub fn reveal_secret() {}');
    assert.throws(()=>auditCheckout(root),/Unregistered native command/);
    write('src-tauri/src/features/new_command.rs','pub fn helper() {}');
    assert.deepEqual(auditCheckout(root).commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);

    // Distinct Rust files with identical basenames are ambiguous in the flat
    // module-name inventory and must be reviewed rather than silently merged.
    write('src-tauri/src/features/runtime_probe.rs','pub fn unrelated() {}');
    assert.throws(()=>auditCheckout(root),/Ambiguous Rust module filename/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('registered Rust module identity must match the reviewed exact handler path',()=>{
  const f=fixture();
  f.entry=f.entry.replace('runtime_probe::desktop_runtime_info','other::desktop_runtime_info');
  assert.throws(()=>auditNativeIpc(f),/module or allowlist changed/);
});

test('new Rust command declarations in another module are rejected',()=>{
  const f=fixture();
  f.rustModules.new_module='#[tauri::command]\npub fn exfiltrate() {}';
  assert.throws(()=>auditNativeIpc(f),/Unregistered native command/);
});

test('unrecognized Rust command attribute forms cannot hide command declarations',()=>{
  const f=fixture();
  f.rustModules.runtime_probe=f.rustModules.runtime_probe.replace(
    '#[tauri::command]', '#[tauri::command(rename_all = "snake_case")]');
  assert.throws(()=>auditNativeIpc(f),/Unsupported native command attribute syntax/);
});

test('changing Tauri build.rs from its reviewed build-only form fails closed',()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-ipc-build-fixture-'));
  try {
    const f=fixture();
    const write=(path,content)=>{
      const target=join(root,path);
      mkdirSync(dirname(target),{recursive:true});
      writeFileSync(target,content);
    };
    for(const [path,content] of Object.entries({
      'src-tauri/src/lib.rs':f.entry,
      'src-tauri/src/runtime_probe.rs':f.rustModules.runtime_probe,
      'src-tauri/src/offline_places.rs':f.rustModules.offline_places,
      'src-tauri/src/chart_calculation.rs':f.rustModules.chart_calculation,
      'src-tauri/src/chart_archive.rs':f.rustModules.chart_archive,
      'src-tauri/src/return_search.rs':f.rustModules.return_search,
      'src-tauri/src/connected_account_ipc.rs':f.rustModules.connected_account_ipc,
      'src-tauri/tauri.conf.json':JSON.stringify(f.tauriConfig),
      'src-tauri/build.rs':'fn main() { tauri_build::build(); }',
      'src/app/native/runtime-protocol.ts':f.runtimeContract,
      'src/app/native/offline-places-contract.ts':f.placesContract,
      'src/app/native/chart-calculation-contract.ts':f.chartContract,
      'src/app/native/chart-archive-contract.ts':f.archiveContract,
      'src/app/native/return-search-contract.ts':f.returnContract,
      'src/app/native/connected-account-contract.ts':f.accountContract,
      ...f.tsFiles,
    })) write(path,content);
    assert.deepEqual(auditCheckout(root).commands,['desktop_runtime_info','search_offline_places','calculate_chart','chart_archive','find_returns','desktop_connected_account_v1']);
    write('src-tauri/build.rs','fn main() { tauri_build::try_build(custom_attributes()); }');
    assert.throws(()=>auditCheckout(root),/build configuration changed/);
  } finally {rmSync(root,{recursive:true,force:true});}
});


test('another native invocation in a reviewed protocol cannot hide behind a valid one',()=>{
  const f=fixture();
  f.runtimeContract += "\nasync function unexpected(port) { return port.invoke('delete_all'); }";
  assert.throws(()=>auditNativeIpc(f),/Unexpected protocol native invocation count/);
  const g=fixture();
  g.placesContract += "\nasync function unexpected(port) { return port['invoke']('delete_all',{}); }";
  assert.throws(()=>auditNativeIpc(g),/Unexpected protocol native invocation count/);
});

test('Rust Tauri plugins require explicit review even without a new invoke handler',()=>{
  const f=fixture();
  f.entry=f.entry.replace('.invoke_handler(','.plugin(tauri_plugin_shell::init()).invoke_handler(');
  assert.throws(()=>auditNativeIpc(f),/Unexpected native Tauri plugin/);
  const g=fixture();
  g.rustModules.extra_module='fn install() { let _ = tauri_plugin_fs::init(); }';
  assert.throws(()=>auditNativeIpc(g),/Unexpected native Tauri plugin/);
});
