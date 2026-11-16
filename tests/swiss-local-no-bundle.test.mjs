import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

for (const name of [
  'tauri:build:swiss:local',
  'tauri:build:swiss:private:local',
  'tauri:build:places:swiss:private:local',
]) {
  test(name + ' builds the Swiss feature without creating a distributable bundle', () => {
    const command = pkg.scripts[name];
    assert.equal(typeof command, 'string');
    assert.match(command, /(?:^|&&\s*)tauri build --no-bundle(?:\s|$)/);
    assert.match(command, /--features swiss-ephemeris(?:\s|$)/);
  });
}

test('the normal non-Swiss build remains a separate entrypoint', () => {
  assert.doesNotMatch(pkg.scripts['tauri:build'], /--features swiss-ephemeris/);
});
