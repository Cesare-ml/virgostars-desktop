import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = relativePath => readFileSync(new URL('../' + relativePath, import.meta.url), 'utf8');

test('native calculation transport quarantines experimental snapshots after strict shape guard', () => {
  const native = read('src/app/native/calculation-probe.ts');
  assert.match(native, /import \{\s*quarantineUnverifiedSkyPort\s*\} from '\.\/scientific-readiness-gate'/);
  assert.match(native, /quarantineUnverifiedSkyPort\(guardExperimentalSkyPort\(createNativeCalculationPort\(/);
  assert.match(native, /validCalculationDraft/);
  assert.match(native, /isNative: isTauri/);
});
