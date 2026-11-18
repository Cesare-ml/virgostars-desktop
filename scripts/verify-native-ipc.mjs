#!/usr/bin/env node
/** Fail-closed, read-only audit of the small Tauri IPC attack surface. */
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_COMMANDS = Object.freeze(['desktop_runtime_info', 'search_offline_places', 'calculate_chart', 'chart_archive', 'find_returns', 'synod_events']);
const NATIVE_HANDLERS = Object.freeze(['runtime_probe::desktop_runtime_info', 'offline_places::search_offline_places', 'chart_calculation::calculate_chart', 'chart_archive::chart_archive', 'return_search::find_returns', 'synod_events::synod_events']);
const ADAPTERS = Object.freeze(['src/app/native/runtime.ts', 'src/app/native/offline-places.ts', 'src/app/native/chart-calculation.ts', 'src/app/native/chart-archive.ts', 'src/app/native/return-search.ts', 'src/app/native/synod-events.ts']);
const FRONTEND_EXTENSIONS = /\.(?:ts|tsx|js|mjs)$/;

function assert(ok, message) { if (!ok) throw new Error(message); }
function listSources(root, dir, extensionPattern=FRONTEND_EXTENSIONS) {
  const files=[];
  for(const entry of readdirSync(join(root,dir),{withFileTypes:true})) {
    const child=join(dir,entry.name);
    assert(!entry.isSymbolicLink(), 'Unsafe source entry');
    if(entry.isDirectory()) files.push(...listSources(root,child,extensionPattern));
    else if(entry.isFile() && extensionPattern.test(child)) files.push(child.split('\\').join('/'));
    else assert(entry.isFile(), 'Unsafe source entry');
  }
  return files;
}

export function auditNativeIpc(sources) {
  const handlers=[...sources.entry.matchAll(/\.invoke_handler\(\s*tauri::generate_handler!\[([^\]]*)\]\s*\)/gs)];
  assert(handlers.length === 1, 'Expected one explicit native IPC handler registry');
  const tokens=handlers[0][1].split(',').map(x=>x.trim()).filter(Boolean);
  assert(tokens.length === NATIVE_HANDLERS.length, 'Unexpected native command count');
  assert(tokens.every(x=>/^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$/.test(x)), 'Invalid native handler entry');
  const registered=tokens.map(x=>x.split('::')[1]);
  assert(new Set(registered).size===registered.length, 'Duplicate native command');
  assert(JSON.stringify([...tokens].sort())===JSON.stringify([...NATIVE_HANDLERS].sort()),
    'Native command module or allowlist changed');
  // Registered plugins and plugin initializers can widen the native surface
  // without changing the explicit invoke handler list. Require manual review.
  for(const rust of [sources.entry,...Object.values(sources.rustModules)]) {
    assert(!/(?:\.\s*plugins?\s*\(|\btauri_plugin[_:-])/i.test(rust),
      'Unexpected native Tauri plugin registration or reference');
  }
  for(const [name,contents] of Object.entries(sources.rustModules)) {
    const defined=[...contents.matchAll(/#\[tauri::command\]\s*pub\s+(?:async\s+)?fn\s+([a-z_][a-z_0-9]*)\s*\(/g)].map(m=>m[1]);
    const expected=tokens.filter(x=>x.startsWith(name+'::')).map(x=>x.split('::')[1]);
    const annotations=[...contents.matchAll(/#\s*\[\s*tauri::command\b/g)].length;
    assert(annotations===defined.length, 'Unsupported native command attribute syntax');
    assert(defined.length===expected.length && defined.every(x=>expected.includes(x)),
      'Unregistered native command declaration');
  }
  // The presence of one approved call must not mask a second, unreviewed IPC.
  // Bracket notation is also a native invoke call and requires review.
  for(const contract of [sources.runtimeContract,sources.placesContract,sources.chartContract,sources.archiveContract,sources.returnContract,sources.synodContract]) {
    assert(typeof contract==='string', 'Missing reviewed native protocol');
    const calls=[...contract.matchAll(/(?:\.\s*invoke|\[\s*['"]invoke['"]\s*\])\s*(?:\?\.)?\s*\(/g)];
    assert(calls.length===1, 'Unexpected protocol native invocation count');
  }
  assert(/invoke\(['"]desktop_runtime_info['"]\)/.test(sources.runtimeContract), 'Runtime contract command mismatch');
  assert(/invoke\(['"]search_offline_places['"]\s*,/.test(sources.placesContract), 'Places contract command mismatch');
  assert(/invoke\(['"]calculate_chart['"]\s*,/.test(sources.chartContract), 'Chart contract command mismatch');
  assert(/invoke\(['"]chart_archive['"]\s*,/.test(sources.archiveContract), 'Archive contract command mismatch');
  assert(/invoke\(['"]find_returns['"]\s*,/.test(sources.returnContract), 'Return search contract command mismatch');
  assert(/invoke\(['"]synod_events['"]\s*,/.test(sources.synodContract), 'Synod contract command mismatch');
  // Inspect every frontend source, including src/main.ts, not just src/app.
  // Conservative inventory: any additional Tauri package/API usage needs review.
  for(const [path,content] of Object.entries(sources.tsFiles)) {
    const packages=[...content.matchAll(/@tauri-apps\/[a-z0-9][a-z0-9/._-]*/gi)].map(m=>m[0]);
    if(packages.length===0) continue;
    assert(ADAPTERS.includes(path), 'Unexpected Tauri import outside reviewed adapters');
    assert(packages.length===1 && packages[0]==='@tauri-apps/api/core',
      'Unexpected Tauri package or multiple Tauri references');
    const imports=[...content.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"]@tauri-apps\/api\/core['"]/g)];
    assert(imports.length===1, 'Tauri adapter must use one reviewed named import');
    const symbols=imports[0][1].split(',').map(x=>x.trim()).filter(Boolean).sort();
    assert(JSON.stringify(symbols)===JSON.stringify(['invoke','isTauri']),
      'Unreviewed Tauri API import or alias');
    const calls=[...content.matchAll(/\binvoke\s*<unknown>\s*\(/g)];
    assert(calls.length===1 && /\binvoke\s*<unknown>\s*\(\s*command\b/.test(content),
      'Tauri adapter invoke changed or expanded');
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

/** Tauri 2 auto-loads capability files when capabilities is absent OR empty. */
function verifyNoImplicitCapabilities(root) {
  const location=join(root,'src-tauri/capabilities');
  let stats;
  try { stats=lstatSync(location); }
  catch (error) {
    if (error?.code==='ENOENT') return;
    throw error;
  }
  assert(stats.isDirectory() && !stats.isSymbolicLink(),
    'Tauri capabilities path must be a real directory');
  assert(readdirSync(location).length===0,
    'Tauri auto-discovered capability files require explicit review');
}

export function auditCheckout(root=ROOT) {
  const read=path=>readFileSync(join(root,path),'utf8');
  verifyNoImplicitCapabilities(root);
  // Any custom build script could change capability path discovery or the
  // native command manifest. Require an explicit review of such a change.
  assert(/^\s*fn\s+main\s*\(\s*\)\s*\{\s*tauri_build::build\(\);\s*\}\s*$/s.test(read('src-tauri/build.rs')),
    'Tauri build configuration changed; inspect native permissions');
  const tsFiles=Object.fromEntries(listSources(root,'src').map(path=>[path,read(path)]));
  const rustModules={};
  for(const path of listSources(root,'src-tauri/src',/\.rs$/)) {
    const moduleName=path.slice(path.lastIndexOf('/')+1,-3);
    assert(!Object.hasOwn(rustModules,moduleName), 'Ambiguous Rust module filename');
    rustModules[moduleName]=read(path);
  }
  for(const moduleName of ['runtime_probe','offline_places','chart_calculation','chart_archive','return_search','synod_events']) {
    assert(Object.hasOwn(rustModules,moduleName), 'Missing reviewed Rust command module');
  }
  return auditNativeIpc({
    entry:read('src-tauri/src/lib.rs'),
    rustModules,
    runtimeContract:read('src/app/native/runtime-protocol.ts'),
    placesContract:read('src/app/native/offline-places-contract.ts'),
    chartContract:read('src/app/native/chart-calculation-contract.ts'),
    archiveContract:read('src/app/native/chart-archive-contract.ts'),
    returnContract:read('src/app/native/return-search-contract.ts'),
    synodContract:read('src/app/native/synod-events-contract.ts'),
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
