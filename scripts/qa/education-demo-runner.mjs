/**
 * VirgoStars educational pilot QA: runnable LOCAL matrix, NOT a release certificate.
 * Execute only existing tests from sibling checkouts. No downloads or GitHub Actions.
 * Usage: node scripts/qa/education-demo-runner.mjs --run [--only QA-02,QA-03] [--out report.json]
 */
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve, join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = Object.freeze({
  ephemeris: 'virgostars-ephemeris', functions: 'astrological-functions',
  charts: 'astrological-charts', desktop: 'virgostars-desktop',
});
const rust = file => ({repo:'ephemeris', file:`crates/ephemeris-core/tests/${file}.rs`, kind:'rust', args:['test','--offline','--locked','-p','virgostars-ephemeris-core','--test',file]});
const js = (repo,file) => ({repo, file, kind:'node', args:repo==='desktop'?['--experimental-strip-types','--test',file]:['--test',file]});
const CASES = Object.freeze([
  {id:'QA-01', title:'Tema natale, angoli, case, aspetti', checks:[rust('house_angles'),rust('mvp_planets'),js('functions','test/house-set.test.mjs'),js('charts','tests/axis-markers.test.mjs'),js('desktop','tests/chart-calculation-contract.test.mjs')], gate:'Confronto DE441/Swiss + grafico Desktop con input sintetico reale'},
  {id:'QA-02', title:'Oraria, Regiomontanus, ore planetarie, lotti', checks:[js('functions','test/regiomontanus-houses.test.mjs'),js('functions','test/planetary-hours.test.mjs'),js('functions','test/classical-lots.test.mjs'),js('desktop','tests/planetary-hour.test.mjs')],gate:'Verificare alba effettiva, settori giorno/notte, sect e interpretazione oraria'},
  {id:'QA-03', title:'Stelle fisse, lotti e aspetti tradizionali', checks:[rust('fixed_star_provider'),js('functions','test/classical-lots.test.mjs'),js('desktop','tests/star-link.test.mjs')],gate:'Catalogo stellare reale + formula lotti/scuola + conversione di epoca'},
  {id:'QA-04', title:'Sinastria, transiti e progressioni', checks:[js('charts','tests/aspect-endpoints.test.mjs'),js('desktop','tests/chart-sync-contract.test.mjs'),js('functions','test/aspect-trend.test.mjs')],gate:'Due carte + transiti visualizzati in Desktop; progressioni non presumibilmente disponibili'},
  {id:'QA-05', title:'Grafico nato, font, collisioni e posizioni', checks:[rust('mvp_planets'),js('charts','tests/planet-symbol-layout.test.mjs'),js('charts','tests/axis-markers.test.mjs'),js('desktop','tests/chart-calculation-contract.test.mjs')],gate:'Screenshot di un tema reale sintetico senza collisioni, verifica posizioni Swiss'},
  {id:'QA-06', title:'Rivoluzioni, ritorni, punti medi', checks:[js('functions','test/zodiac-midpoint-pipeline-integration.test.mjs'),js('desktop','tests/return-search-contract.test.mjs')],gate:'Istante astronomico di ritorno e punto medio confrontati con riferimento indipendente'},
  {id:'QA-07', title:'Confronto esterno con software astrologico', checks:[js('charts','tests/virgostars-skin.test.mjs'),js('charts','tests/planet-renderer-geometry.test.mjs')],gate:'Confronto autorizzato e manuale con software terzo a parametri identici'},
  {id:'QA-08', title:'Località, archivio offline, privacy', checks:[js('desktop','tests/offline-place-search.test.mjs'),js('desktop','tests/encrypted-archive-ui.test.mjs'),js('desktop','tests/chart-archive-contract.test.mjs')],gate:'Prova nativa Windows con archivio cifrato, immagini solo locali, niente rete'},
  {id:'QA-09', title:'Lezione base: elementi, aspetti, assi', checks:[js('desktop','tests/elements-view-ui.test.mjs'),js('desktop','tests/element-distribution.test.mjs'),js('charts','tests/axis-markers.test.mjs')],gate:'Verifica manuale leggibilità/interazioni e simboli dagli asset approvati'},
  {id:'QA-10', title:'Transiti e rivoluzioni con calcoli esatti', checks:[js('desktop','tests/return-search-contract.test.mjs'),js('functions','test/aspect-trend.test.mjs'),js('desktop','tests/aspects.test.mjs')],gate:'Validazione dei ritorni veri DE441 e progressioni; nessuna data inventata da IA'},
  {id:'QA-11', title:'Profezioni e firdarie', checks:[],blockedCapability:true,gate:'Algoritmi, fixture indipendenti e test specifici non convalidati: NON dimostrare'},
  {id:'QA-12', title:'Oraria Cina: fuso, case, localizzazione', checks:[rust('calendar_contract'),js('desktop','tests/civil-time.test.mjs'),js('desktop','tests/selected-city-clock.test.mjs')],gate:'Conversione Asia/Shanghai e UI ZH testata; oraria non certificata'},
  {id:'QA-13', title:'Cielo di adesso, orologio, grafici', checks:[js('desktop','tests/device-clock.test.mjs'),js('desktop','tests/sky-live.test.mjs'),js('charts','tests/default-chart-options.test.mjs')],gate:'Verifica nativa aggiornamento tempo, cambio città e glifi reali'},
  {id:'QA-14', title:'Case, aspetti, calendario di una scuola', checks:[js('functions','test/house-set.test.mjs'),js('charts','tests/axis-markers.test.mjs'),js('desktop','tests/civil-time.test.mjs')],gate:'Disponibilità del corso 2026–27, metodo scolastico e localizzazione ZH'},
]);
function options(argv){
  const o={run:false, root:DEFAULT_ROOT, out:null, only:null};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a==='--run')o.run=true;
    else if(a==='--dry-run')o.run=false;
    else if(a==='--help'||a==='-h')o.help=true;
    else if(a==='--only'){
      const value=argv[++i];
      if(!value || value.startsWith('--') || !/^(?:QA-\d{2})(?:,QA-\d{2})*$/.test(value))throw Error('--only needs one or more comma-separated QA-XX IDs');
      o.only=[...new Set(value.split(','))];
    }
    else if(a==='--root'){
      const value=argv[++i];
      if(!value || value.startsWith('--'))throw Error('--root needs a directory');
      o.root=resolve(value);
    }
    else if(a==='--out'){
      const value=argv[++i];
      if(!value || value.startsWith('--'))throw Error('--out needs a file path');
      o.out=resolve(value);
    }
    else throw Error(`Unknown option: ${a}`);
  }
  if(o.only?.some(id=>!CASES.some(c=>c.id===id)))throw Error('Unknown QA case in --only');
  return o;
}
function rootFor(root,repo){return repo==='desktop'?root:resolve(root,'..',REPO[repo]);}
function probeCommand(c,root){
  const dir=rootFor(root,c.repo), file=join(dir,c.file);
  if(!existsSync(join(dir,'package.json')) && c.kind==='node')return 'Repository/package.json absent';
  if(!existsSync(join(dir,'Cargo.toml')) && c.kind==='rust')return 'Repository/Cargo.toml absent';
  if(!existsSync(file))return `Missing test: ${c.file}`;
  if(c.repo==='charts'&&!existsSync(join(dir,'node_modules')))return 'Charts node_modules absent: npm ci required';
  if(c.repo==='desktop'&&!existsSync(join(dir,'node_modules')))return 'Desktop node_modules absent: npm ci + sibling build required';
  return null;
}
function runCheck(c,root){
  const dir=rootFor(root,c.repo),command=c.kind==='rust'?'cargo':process.execPath;
  // Nested node:test can silently skip all child tests while exiting 0: fail closed.
  const env={...process.env,CI:'1',NO_COLOR:'1',NODE_OPTIONS:'',CARGO_NET_OFFLINE:'true',CARGO_NET_GIT_FETCH_WITH_CLI:'false'};
  delete env.NODE_TEST_CONTEXT;
  const args=c.kind==='node'?[...c.args.slice(0,-1),'--test-reporter=tap',c.args.at(-1)]:c.args;
  const p=spawnSync(command,args,{cwd:dir,encoding:'utf8',timeout:c.kind==='rust'?300000:120000,windowsHide:true,env,maxBuffer:1024*1024*2});
  if(p.error?.code==='ENOENT')return {status:'BLOCKED_ENV',note:`${command} not installed`};
  if(p.error?.code==='ETIMEDOUT')return {status:'FAILED_AUTOMATED',note:'Targeted test command timed out'};
  if(p.error)return {status:'FAILED_AUTOMATED',note:`Test subprocess failure: ${p.error.code||'UNKNOWN'}`};
  // An offline Cargo cache/lockfile failure is an environment blocker, not a failed feature test.
  // Inspect stderr only transiently for classification; never save raw subprocess output.
  if(c.kind==='rust' && p.status!==0 &&
     /failed to download|no matching package named|attempting to make an HTTP request|offline mode|--locked was passed|lock file needs to be updated|lockfile needs to be updated/i.test(p.stderr||'')) {
    return {status:'BLOCKED_ENV',exitCode:p.status,note:'Rust dependency cache or Cargo.lock not ready for offline locked test; prepare prerequisites explicitly'};
  }
  const stdout=p.stdout||'';
  const nodeStats=c.kind==='node'?{
    tests:Number(stdout.match(/^# tests (\d+)\s*$/m)?.[1]??0),
    passed:Number(stdout.match(/^# pass (\d+)\s*$/m)?.[1]??0),
    failed:Number(stdout.match(/^# fail (\d+)\s*$/m)?.[1]??-1),
    skipped:Number(stdout.match(/^# skipped (\d+)\s*$/m)?.[1]??-1),
    cancelled:Number(stdout.match(/^# cancelled (\d+)\s*$/m)?.[1]??-1),
    todo:Number(stdout.match(/^# todo (\d+)\s*$/m)?.[1]??-1),
  }:null;
  // Node can report '# tests 1' for a file containing no test() declarations:
  // successful file evaluation is wrapped as a test. Require a named subtest.
  const names=c.kind==='node'?[...stdout.matchAll(/^# Subtest: (.+)\s*$/gm)].map(m=>m[1].trim()):[];
  const fileBasename=basename(c.file);
  const namedCount=names.filter(n=>{
    const normalized=n.replaceAll('\\','/');
    return !(normalized===fileBasename || normalized===c.file || normalized.endsWith('/'+fileBasename));
  }).length;
  const rustStats=c.kind==='rust'?stdout.match(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/):null;
  const rustPassCount=Number(rustStats?.[1]??0);
  const completeNode=c.kind==='node' && nodeStats.tests>0 && nodeStats.passed>0 &&
    nodeStats.failed===0 && nodeStats.skipped===0 && nodeStats.cancelled===0 && nodeStats.todo===0 &&
    namedCount>0 && nodeStats.tests===nodeStats.passed;
  const completeRust=c.kind==='rust' && rustPassCount>0 && Number(rustStats[2])===0 && Number(rustStats[3])===0;
  const validPass=p.status===0 && (completeNode || completeRust);
  const completedCount=c.kind==='node'?nodeStats.passed:rustPassCount;
  const reason=p.status!==0?`Targeted test command failed (exit ${p.status})`:
    !validPass?'INCOMPLETE_TEST_EVIDENCE: no named, completed, non-skipped tests with a recognized success summary':
      'Targeted tests executed and passed; manual integration gate remains';
  // Do not persist raw stdout/stderr: they can contain paths, usernames,
  // credentials or private chart data even when a test fails.
  return {status:validPass?'PASS_AUTOMATED':'FAILED_AUTOMATED',exitCode:p.status,testCount:completedCount,note:reason};
}
function main(){
  const o=options(process.argv.slice(2));
  if(o.help){console.log('Usage: node scripts/qa/education-demo-runner.mjs [--run] [--only QA-02,QA-03] [--root PATH] [--out PATH]\nDefault is dry-run. Never marks a demo release-ready.');return;}
  const selected=CASES.filter(c=>!o.only||o.only.includes(c.id));
  const cache=new Map();
  const results=selected.map(c=>{
    if(c.blockedCapability)return {id:c.id,title:c.title,status:'BLOCKED_CAPABILITY',checks:[],manualGate:c.gate};
    const checks=c.checks.map(ch=>{
      const key=`${ch.repo}:${ch.kind}:${ch.file}`;
      if(!cache.has(key)){
        const blocked=probeCommand(ch,o.root);
        const outcome=blocked?{status:'BLOCKED_ENV',note:blocked}:o.run?runCheck(ch,o.root):{status:'NOT_RUN',note:'Dry-run; use --run on complete local checkouts'};
        cache.set(key,outcome);
      }
      return {repo:ch.repo,file:ch.file,command:[ch.kind==='rust'?'cargo':'node',...ch.args].join(' '),...cache.get(key)};
    });
    const status=checks.some(v=>v.status==='FAILED_AUTOMATED')?'FAILED_AUTOMATED':checks.some(v=>v.status==='BLOCKED_ENV')?'BLOCKED_ENV':o.run?'AUTOMATED_PARTIAL_MANUAL_REQUIRED':'NOT_RUN';
    return {id:c.id,title:c.title,status,checks,manualGate:c.gate};
  });
  const report={schemaVersion:1,observedAtUtc:new Date().toISOString(),execution:o.run?'local-targeted-tests':'dry-run',caution:'Passing unit tests never certifies a 14-case end-to-end demo or permission to contact schools.',cases:results};
  console.log(`VirgoStars educational QA — ${o.run?'RUN':'DRY-RUN'} | ${results.length} scenarios`);
  for(const x of results)console.log(`${x.id} ${x.status} (${x.checks.filter(v=>v.status==='PASS_AUTOMATED').length}/${x.checks.length} targeted checks passed)`);
  if(o.out){mkdirSync(dirname(o.out),{recursive:true});writeFileSync(o.out,JSON.stringify(report,null,2)+'\n','utf8');console.log(`JSON report: ${basename(o.out)}`);}
  if(results.some(x=>x.status==='FAILED_AUTOMATED'))process.exitCode=1;
  else if(o.run&&results.some(x=>x.status==='BLOCKED_ENV'||x.status==='BLOCKED_CAPABILITY'))process.exitCode=2;
}
main();