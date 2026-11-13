#!/usr/bin/env node
/** Fail-closed, read-only audit of the small Tauri IPC attack surface. */
import {readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_COMMANDS = Object.freeze(['desktop_runtime_info', 'search_offline_places']);
const ADAPTERS = Object.freeze(['src/app/native/runtime.ts', 'src/app/native/offline-places.ts']);

function assert(ok, message) { if (!ok) throw new Error(message); }
function listSources(root, dir) {
  const files=[];
  for(const entry of readdirSync(join(root,dir),{withFileTypes:true})) {
    const child=join(dir,entry.name);
    assert(!entry.isSymbolicLink(), 'Unsafe source entry');
    if(entry.isDirectory()) files.push(...listSources(root,child));
    else if(entry.isFile() && child.endsWith('.ts')) files.push(child.split('\\').join('/'));
    else assert(entry.isFile(), 'Unsafe source entry');
  }
  return files;
}

export function auditNativeIpc(sources) {
  const handlers=[...sources.entry.matchAll(/\.invoke_handler\(\s*tauri::generate_handler!\[([^\]]*)\]\s*\)/gs)];
  assert(handlers.length === 1, 'Expected one explicit native IPC handler registry');
  const tokens=handlers[0][1].split(',').map(x=>x.trim()).filter(Boolean);
  assert(tokens.length === NATIVE_COMMANDS.length, 'Unexpected native command count');
  assert(tokens.every(x=>/^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$/.test(x)), 'Invalid native handler entry');
  const registered=tokens.map(x=>x.split('::')[1]);
  assert(new Set(registered).size===registered.length, 'Duplicate native command');
  assert(JSON.stringify([...registered].sort())===JSON.stringify([...NATIVE_COMMANDS].sort()), 'Native command allowlist changed');
  for(const [name,contents] of Object.entries(sources.rustModules)) {
    const defined=[...contents.matchAll(/#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+([a-z_][a-z_0-9]*)\s*\(/g)].map(m=>m[1]);
    const expected=tokens.filter(x=>x.startsWith(name+'::')).map(x=>x.split('::')[1]);
    assert(defined.length===expected.length && defined.every(x=>expected.includes(x)), 'Unregistered native command declaration');
  }
  assert(/invoke\(['"]desktop_runtime_info['"]\)/.test(sources.runtimeContract), 'Runtime contract command mismatch');
  assert(/invoke\(['"]search_offline_places['"]\s*,/.test(sources.placesContract), 'Places contract command mismatch');
  for(const [path,content] of Object.entries(sources.tsFiles)) {
    if(/from\s*['"]@tauri-apps\/api\/core['"]/.test(content)) {
      assert(ADAPTERS.includes(path), 'Unexpected Tauri import outside reviewed adapters');
      assert(/\binvoke\s*[,}]/.test(content), 'Tauri adapter lacks expected invoke import');
      assert(/invoke<unknown>\(command/.test(content), 'Tauri adapter invoke changed');
    }
  }
  for(const adapter of ADAPTERS) assert(sources.tsFiles[adapter] !== undefined &&
    /from\s*['"]@tauri-apps\/api\/core['"]/.test(sources.tsFiles[adapter]), 'Missing reviewed Tauri adapter');
  const cfg=sources.tauriConfig;
  assert(cfg && typeof cfg==='object' && !Array.isArray(cfg), 'Invalid Tauri configuration');
  assert(Array.isArray(cfg.app?.security?.capabilities) && cfg.app.security.capabilities.length===0,
    'Tauri capabilities changed; require explicit review');
  assert(cfg.app?.withGlobalTauri !== true, 'Global Tauri bridge must stay disabled');
  return Object.freeze({commands:Object.freeze([...NATIVE_COMMANDS]), adapters:Object.freeze([...ADAPTERS])});
}

export function auditCheckout(root=ROOT) {
  const read=path=>readFileSync(join(root,path),'utf8');
  const tsFiles=Object.fromEntries(listSources(root,'src/app').map(path=>[path,read(path)]));
  return auditNativeIpc({
    entry:read('src-tauri/src/lib.rs'),
    rustModules:{runtime_probe:read('src-tauri/src/runtime_probe.rs'),offline_places:read('src-tauri/src/offline_places.rs')},
    runtimeContract:read('src/app/native/runtime-protocol.ts'),
    placesContract:read('src/app/native/offline-places-contract.ts'),
    tsFiles,
    tauriConfig:JSON.parse(read('src-tauri/tauri.conf.json')),
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===2, 'No CLI arguments are supported');
    const result=auditCheckout();
    console.log('Verified '+result.commands.length+' reviewed native IPC commands and '+result.adapters.length+' Tauri adapters.');
  } catch {
    console.error('NATIVE IPC CONTRACT AUDIT FAILED. Review the command registry, adapters and Tauri capabilities.');
    process.exitCode=1;
  }
}
