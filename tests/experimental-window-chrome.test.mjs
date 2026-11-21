import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CHROME_PERMISSIONS, verifyWindowsChromeOverride, verifyWindowsChromeCheckout,
} from '../scripts/verify-experimental-window-chrome.mjs';

const base = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const override = JSON.parse(readFileSync(new URL('../src-tauri/tauri.windows.conf.json', import.meta.url), 'utf8'));

test('Windows experiment is isolated and has exactly one explicitly reviewed capability', () => {
  assert.deepEqual(verifyWindowsChromeCheckout(), {windows:1, platform:'windows'});
  assert.equal(base.app.security.capabilities.length, 0);
  assert.equal(base.app.windows[0].decorations, undefined);
  assert.deepEqual(override.app.security.capabilities[0].permissions, CHROME_PERMISSIONS);
  assert.deepEqual(override.app.security.capabilities[0].platforms, ['windows']);
});

test('an unreviewed Windows window or native command fails closed', () => {
  for (const update of [
    config => { config.app.windows[0].url = 'https://example.invalid'; },
    config => { config.app.windows[0].additionalBrowserArgs = '--disable-web-security'; },
    config => { config.app.windows[0].windowEffects.effects.push('acrylic'); },
    config => { config.app.windows[0].transparent = false; },
    config => { config.app.windows[0].width = 100; },
    config => { config.app.security.capabilities[0].permissions.push('fs:default'); },
    config => { config.app.security.capabilities[0].platforms.push('macOS'); },
    config => { config.app.security.capabilities[0].windows.push('*'); },
    config => { config.app.security.csp = null; },
    config => { config.build = {frontendDist:'https://example.invalid'}; },
  ]) {
    const changed = structuredClone(override);
    update(changed);
    assert.throws(() => verifyWindowsChromeOverride(base, changed));
  }
});
