#!/usr/bin/env node
/** Fail-closed, read-only audit of the small Tauri IPC attack surface. */
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NATIVE_COMMANDS = Object.freeze(['desktop_runtime_info', 'search_offline_places', 'calculate_chart', 'calculate_sky_dome', 'chart_archive', 'find_returns', 'synod_events', 'calculate_historical_planet', 'calculate_historical_planet_calendar', 'calculate_historical_chart', 'open_star_page', 'desktop_connected_account_v1', 'desktop_group_conflicts_v1', 'desktop_chart_sync_v1', 'de441_packages']);
const NATIVE_HANDLERS = Object.freeze(['runtime_probe::desktop_runtime_info', 'offline_places::search_offline_places', 'chart_calculation::calculate_chart', 'sky_dome::calculate_sky_dome', 'chart_archive::chart_archive', 'return_search::find_returns', 'synod_events::synod_events', 'historical_planets::calculate_historical_planet', 'historical_planets::calculate_historical_planet_calendar', 'historical_chart::calculate_historical_chart', 'star_link::open_star_page', 'connected_account_ipc::desktop_connected_account_v1', 'connected_account_ipc::desktop_group_conflicts_v1', 'connected_account_ipc::desktop_chart_sync_v1', 'de441_operations::de441_packages']);
const ADAPTERS = Object.freeze(['src/app/native/runtime.ts', 'src/app/native/offline-places.ts', 'src/app/native/chart-calculation.ts', 'src/app/native/sky-dome.ts', 'src/app/native/chart-archive.ts', 'src/app/native/return-search.ts', 'src/app/native/synod-events.ts', 'src/app/native/historical-planets.ts', 'src/app/native/historical-calendar.ts', 'src/app/native/historical-chart.ts', 'src/app/native/star-link.ts', 'src/app/native/connected-account.ts', 'src/app/native/group-conflicts.ts', 'src/app/native/chart-sync.ts', 'src/app/native/de441-packages.ts']);
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
  const updaterEnabled = tokens.includes('updater::check_updates') || tokens.includes('updater::install_update');
  const handlersExpected = updaterEnabled ? [...NATIVE_HANDLERS,'updater::check_updates','updater::install_update'] : NATIVE_HANDLERS;
  const commandsExpected = updaterEnabled ? [...NATIVE_COMMANDS,'check_updates','install_update'] : NATIVE_COMMANDS;
  const adaptersExpected = updaterEnabled ? [...ADAPTERS,'src/app/native/update.ts'] : ADAPTERS;
  assert(tokens.length === handlersExpected.length, 'Unexpected native command count');
  assert(tokens.every(x=>/^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$/.test(x)), 'Invalid native handler entry');
  const registered=tokens.map(x=>x.split('::')[1]);
  assert(new Set(registered).size===registered.length, 'Duplicate native command');
  assert(JSON.stringify([...tokens].sort())===JSON.stringify([...handlersExpected].sort()),
    'Native command module or allowlist changed');
  // Registered plugins and plugin initializers can widen the native surface
  // without changing the explicit invoke handler list. Require manual review.
  const plugin = '.plugin(tauri_plugin_updater::Builder::new().pubkey(option_env!("VIRGOSTARS_UPDATER_PUBLIC_KEY").unwrap_or("")).build())';
  if (updaterEnabled) assert(sources.entry.split(plugin).length===2, 'Updater plugin registration changed');
  for(const [name,rust] of [['entry',sources.entry],...Object.entries(sources.rustModules)]) {
    const reviewed = updaterEnabled && (name==='entry' || name==='lib') ? rust.replace(plugin,'') :
      updaterEnabled && name==='updater' ? rust.replace('use tauri_plugin_updater::{Update, UpdaterExt};','') : rust;
    assert(!/(?:\.\s*plugins?\s*\(|\btauri_plugin[_:-])/i.test(reviewed),
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
  for(const contract of [sources.runtimeContract,sources.placesContract,sources.chartContract,sources.skyContract,sources.archiveContract,sources.returnContract,sources.synodContract,sources.historicalContract,sources.historicalCalendarContract,sources.historicalChartContract,sources.starLinkContract,sources.accountContract,sources.conflictsContract,sources.syncContract,sources.packageContract]) {
    assert(typeof contract==='string', 'Missing reviewed native protocol');
    const calls=[...contract.matchAll(/(?:\.\s*invoke|\[\s*['"]invoke['"]\s*\])\s*(?:\?\.)?\s*\(/g)];
    assert(calls.length===1, 'Unexpected protocol native invocation count');
  }
  assert(/invoke\(['"]desktop_runtime_info['"]\)/.test(sources.runtimeContract), 'Runtime contract command mismatch');
  assert(/invoke\(['"]search_offline_places['"]\s*,/.test(sources.placesContract), 'Places contract command mismatch');
  assert(/invoke\(['"]calculate_chart['"]\s*,/.test(sources.chartContract), 'Chart contract command mismatch');
  assert(/invoke\(['"]calculate_sky_dome['"]\s*,/.test(sources.skyContract), 'Sky dome contract command mismatch');
  assert(/invoke\(['"]chart_archive['"]\s*,/.test(sources.archiveContract), 'Archive contract command mismatch');
  assert(/invoke\(['"]find_returns['"]\s*,/.test(sources.returnContract), 'Return search contract command mismatch');
  assert(/invoke\(['"]synod_events['"]\s*,/.test(sources.synodContract), 'Synod contract command mismatch');
  assert(/invoke\(['"]calculate_historical_planet['"]\s*,/.test(sources.historicalContract), 'Historical contract command mismatch');
  assert(/invoke\(['"]calculate_historical_planet_calendar['"]\s*,/.test(sources.historicalCalendarContract), 'Historical calendar contract command mismatch');
  assert(/invoke\(['"]calculate_historical_chart['"]\s*,/.test(sources.historicalChartContract), 'Historical chart contract command mismatch');
  assert(/invoke\(['"]open_star_page['"]\s*,/.test(sources.starLinkContract), 'Star link contract command mismatch');
  assert(/invoke\(['"]desktop_connected_account_v1['"]\s*,/.test(sources.accountContract), 'Account contract command mismatch');
  assert(/invoke\(['"]desktop_group_conflicts_v1['"]\s*,/.test(sources.conflictsContract), 'Conflicts contract command mismatch');
  assert(/invoke\(['"]desktop_chart_sync_v1['"]\s*,/.test(sources.syncContract), 'Chart sync contract command mismatch');
  assert(/invoke\(['"]de441_packages['"]\s*,/.test(sources.packageContract), 'DE441 package contract command mismatch');
  // Inspect every frontend source, including src/main.ts, not just src/app.
  // Conservative inventory: any additional Tauri package/API usage needs review.
  for(const [path,content] of Object.entries(sources.tsFiles)) {
    const packages=[...content.matchAll(/@tauri-apps\/[a-z0-9][a-z0-9/._-]*/gi)].map(m=>m[0]);
    if(packages.length===0) continue;
    assert(adaptersExpected.includes(path), 'Unexpected Tauri import outside reviewed adapters');
    assert(packages.length===1 && packages[0]==='@tauri-apps/api/core',
      'Unexpected Tauri package or multiple Tauri references');
    const imports=[...content.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"]@tauri-apps\/api\/core['"]/g)];
    assert(imports.length===1, 'Tauri adapter must use one reviewed named import');
    const symbols=imports[0][1].split(',').map(x=>x.trim()).filter(Boolean).sort();
    assert(JSON.stringify(symbols)===JSON.stringify(path==='src/app/native/update.ts' ? ['Channel','invoke','isTauri'] : ['invoke','isTauri']),
      'Unreviewed Tauri API import or alias');
    const calls=[...content.matchAll(/\binvoke\s*<unknown>\s*\(/g)];
    assert(calls.length===1 && /\binvoke\s*<unknown>\s*\(\s*command\b/.test(content),
      'Tauri adapter invoke changed or expanded');
  }
  for(const adapter of adaptersExpected) assert(sources.tsFiles[adapter] !== undefined &&
    /from\s*['"]@tauri-apps\/api\/core['"]/.test(sources.tsFiles[adapter]), 'Missing reviewed Tauri adapter');
  if (updaterEnabled) {
    assert(typeof sources.updateContract==='string' && /'check_updates'/.test(sources.updateContract) && /'install_update'/.test(sources.updateContract) && [...sources.updateContract.matchAll(/\.invoke\s*\(/g)].length===1, 'Updater contract changed');
  }
  const cfg=sources.tauriConfig;
  assert(cfg && typeof cfg==='object' && !Array.isArray(cfg), 'Invalid Tauri configuration');
  assert(Array.isArray(cfg.app?.security?.capabilities) && cfg.app.security.capabilities.length===0,
    'Tauri capabilities changed; require explicit review');
  assert(cfg.app?.withGlobalTauri !== true, 'Global Tauri bridge must stay disabled');
  return Object.freeze({commands:Object.freeze([...commandsExpected]), adapters:Object.freeze([...adaptersExpected])});
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
  // The reviewed private-catalog build script only reads a fixed local file,
  // writes OUT_DIR and calls tauri_build::build. Pin its exact bytes: any
  // change requires a fresh capability/security review, not a broad allowlist.
  const buildScript=read('src-tauri/build.rs');
  const plainBuild=/^\s*fn\s+main\s*\(\s*\)\s*\{\s*tauri_build::build\(\);\s*\}\s*$/s.test(buildScript);
  const reviewedHash='5b5317f84fdde87bbea8a2e2f7719e1453c195ea386d17643806bf9f3d626565';
  assert(plainBuild || createHash('sha256').update(buildScript).digest('hex')===reviewedHash,
    'Tauri build configuration changed; inspect native permissions');
  const tsFiles=Object.fromEntries(listSources(root,'src').map(path=>[path,read(path)]));
  const rustModules={};
  for(const path of listSources(root,'src-tauri/src',/\.rs$/)) {
    const moduleName=path.slice(path.lastIndexOf('/')+1,-3);
    assert(!Object.hasOwn(rustModules,moduleName), 'Ambiguous Rust module filename');
    rustModules[moduleName]=read(path);
  }
  for(const moduleName of ['runtime_probe','offline_places','chart_calculation','sky_dome','chart_archive','return_search','synod_events','historical_planets','historical_chart','star_link','connected_account_ipc','de441_operations']) {
    assert(Object.hasOwn(rustModules,moduleName), 'Missing reviewed Rust command module');
  }
  return auditNativeIpc({
    entry:read('src-tauri/src/lib.rs'),
    rustModules,
    runtimeContract:read('src/app/native/runtime-protocol.ts'),
    placesContract:read('src/app/native/offline-places-contract.ts'),
    chartContract:read('src/app/native/chart-calculation-contract.ts'),
    skyContract:read('src/app/native/sky-dome-contract.ts'),
    archiveContract:read('src/app/native/chart-archive-contract.ts'),
    returnContract:read('src/app/native/return-search-contract.ts'),
    synodContract:read('src/app/native/synod-events-contract.ts'),
    historicalContract:read('src/app/native/historical-planets-contract.ts'),
    historicalCalendarContract:read('src/app/native/historical-calendar-contract.ts'),
    historicalChartContract:read('src/app/native/historical-chart-contract.ts'),
    updateContract:Object.hasOwn(rustModules,'updater') ? read('src/app/native/update-contract.ts') : undefined,
    starLinkContract:read('src/app/native/star-link-contract.ts'),
    accountContract:read('src/app/native/connected-account-contract.ts'),
    conflictsContract:read('src/app/native/group-conflicts-contract.ts'),
    syncContract:read('src/app/native/chart-sync-contract.ts'),
    packageContract:read('src/app/native/de441-packages-contract.ts'),
    tsFiles,
    tauriConfig:JSON.parse(read('src-tauri/tauri.conf.json')),
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===2, 'No CLI arguments are supported');
    const result=auditCheckout();
    console.log('Verified '+result.commands.length+' reviewed native IPC commands and '+result.adapters.length+' Tauri adapters.');
  } catch (error) {
    console.error('NATIVE IPC CONTRACT AUDIT FAILED. Review the command registry, adapters and Tauri capabilities.');
    // Expose the failed *guard*, never source material or secrets. The gate
    // remains fail-closed, including on diagnostic builds.
    if (process.env.VIRGOSTARS_MAC_SNAPSHOT_TEST_ONLY === '1')
      console.error('Snapshot diagnosis: ' + String(error?.message ?? error));
    process.exitCode=1;
  }
}
