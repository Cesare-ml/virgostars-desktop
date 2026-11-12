import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');

test('standalone Tauri command and bounded native gate are registered',()=>{
  const lib=read('src-tauri/src/lib.rs');
  const calc=read('src-tauri/src/calculation_probe.rs');
  assert.match(lib,/mod calculation_probe;/);
  assert.match(lib,/\.manage\(calculation_probe::CalculationProbeGate::default\(\)\)/);
  assert.match(lib,/calculation_probe::desktop_calculation_probe/);
  assert.match(lib,/runtime_probe::desktop_runtime_info/);
  assert.match(calc,/const MAX_ACTIVE_PROBES: usize = 1;/);
  assert.match(calc,/spawn_blocking\(move \|\|/);
  assert.match(calc,/fn drop\(&mut self\)/);
});

test('native response remains unavailable with no astronomical data or network access',()=>{
  const calc=read('src-tauri/src/calculation_probe.rs');
  assert.match(calc,/status: "unavailable"/);
  assert.match(calc,/EPHEMERIS_NOT_INTEGRATED/);
  assert.doesNotMatch(calc.split('#[cfg(test)]')[0],/https?:\/\/|reqwest|ureq|std::net/);
  assert.doesNotMatch(calc,/pub\s+.*\s+snapshot\s*:/);
});

test('frontend adapter is opt-in, and native RPC is separate from the runtime capability probe',()=>{
  const adapter=read('src/app/native/calculation-probe.ts');
  const port=read('src/app/native/calculation-port.ts');
  assert.match(adapter,/isNative: isTauri/);
  assert.match(adapter,/validCalculationDraft/);
  assert.match(port,/desktop_calculation_probe/);
  assert.match(port,/signal\.aborted/);
  assert.match(port,/password|unintended fields/);
  assert.doesNotMatch(read('src-tauri/src/runtime_probe.rs'),/desktop_calculation_probe/);
});
