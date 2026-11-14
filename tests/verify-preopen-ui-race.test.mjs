import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('opened descriptor rejects an appended file between initial lstat and open', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vs-preopen-race-'));
  try {
    const path = join(dir, 'index.html');
    writeFileSync(path, '<head></head>');
    const moduleUri = new URL('../scripts/read-bounded-ui-text.mjs', import.meta.url).href;
    const script = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      import {readBoundedUiText} from ${JSON.stringify(moduleUri)};
      const original = fs.lstatSync;
      const target = ${JSON.stringify(path)};
      let changed = false;
      fs.lstatSync = (p, ...args) => {
        const before = original(p, ...args);
        if (!changed && p === target) {
          changed = true;
          fs.appendFileSync(target, '!');
        }
        return before;
      };
      syncBuiltinESMExports();
      try {
        readBoundedUiText(target, 'HTML');
        console.error('Unexpectedly accepted pre-open rewrite');
        process.exitCode = 1;
      } catch (error) {
        if (error?.message !== 'DESKTOP CSS BUNDLE: HTML changed before read') {
          console.error(error?.message ?? error);
          process.exitCode = 2;
        }
      } finally {
        fs.lstatSync = original;
        syncBuiltinESMExports();
      }
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {encoding: 'utf8', timeout: 5000});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
