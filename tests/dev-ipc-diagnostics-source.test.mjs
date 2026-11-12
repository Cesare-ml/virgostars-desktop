import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('synthetic IPC panel appears only behind Angular development-mode guard',()=>{
  const shell=read('src/app/desktop-app.component.ts');
  const template=read('src/app/desktop-app.component.html');
  assert.match(shell,/showDevDiagnostics\s*=\s*isDevMode\(\)/);
  assert.match(template,/vs-dev-ipc-diagnostics\s+\*ngIf="showDevDiagnostics"/);
  assert.match(template,/\[locale\]="locale"/);
});
test('production Rust explicitly rejects synthetic CPU probes',()=>{
  const rust=read('src-tauri/src/synthetic_calculation_probe.rs');
  assert.match(rust,/if !cfg!\(debug_assertions\)/);
  assert.match(rust,/SYNTHETIC_DISABLED/);
  assert.match(rust,/MAX_ACTIVE: usize = 2/);
  assert.match(rust,/MAX_ITERATIONS: u32 = 200_000/);
});
test('development diagnostics do not access birth data or render chart positions',()=>{
  const ui=read('src/app/dev-ipc-diagnostics.component.ts');
  const benchmark=read('src/app/native/synthetic-ipc-benchmark.ts');
  assert.match(ui,/samples:24,iterations:10000,seed:17/);
  assert.match(ui,/ngOnDestroy\(\)/);
  assert.match(ui,/benchmark\.dispose\(\)/);
  assert.doesNotMatch(ui+benchmark,/natalDraft|setPlace\(|chartArguments|disegnaScena|localStorage|fetch\(/);
});
test('synthetic diagnostic texts are available in Italian and English',()=>{
  const text=read('src/app/translations.ts');
  const keys=['dev.ipc.title','dev.ipc.warning','dev.ipc.start','dev.ipc.stop',
    'dev.ipc.roundTrip','dev.ipc.worker','dev.ipc.failed','dev.ipc.disclaimer'];
  for(const key of keys)assert.equal(text.split('"'+key+'"').length,3,key);
});
test('synthetic diagnostics never require new global Tauri scripting',()=>{
  const port=read('src/app/native/synthetic-calculation-tauri.ts');
  const view=read('src/app/dev-ipc-diagnostics.component.html');
  assert.match(port,/@tauri-apps\/api\/core/);
  assert.doesNotMatch(port+view,/__TAURI__|withGlobalTauri|https?:\/\//);
  assert.match(view,/p99/);
});
