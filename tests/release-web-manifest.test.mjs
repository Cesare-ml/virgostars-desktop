import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {updateWebRelease} from '../scripts/updates/release-web-manifest.mjs';

test('website manifest is updated with the exact release and checksum while preserving validation', () => {
  const source = "before\nexport const DESKTOP_RELEASE_MANIFEST: DesktopReleaseManifest = {\n  kind: 'unavailable'\n};\nafter";
  const updated = updateWebRelease(source, {version:'1.2.3',fileName:'VirgoStars.Desktop_1.2.3_x64-setup.exe',sha256:'a'.repeat(64)});
  assert.match(updated, /\/download\/v1\.2\.3\/VirgoStars\.Desktop_1\.2\.3_x64-setup\.exe/);
  assert.match(updated, /version: '1\.2\.3'/);
  assert.ok(updated.startsWith('before\n') && updated.endsWith('\nafter'));
});

test('website manifest rejects unsafe or mismatched release data and ambiguous source', () => {
  const source = "export const DESKTOP_RELEASE_MANIFEST: DesktopReleaseManifest = {\n};";
  const valid = {version:'1.2.3',fileName:'VirgoStars_1.2.3_x64-setup.exe',sha256:'a'.repeat(64)};
  for (const patch of [{version:'1.2.3;bad'},{fileName:'../bad.exe'},{fileName:'VirgoStars_1.2.4_x64-setup.exe'},{sha256:'bad'}])
    assert.throws(() => updateWebRelease(source, {...valid,...patch}));
  assert.throws(() => updateWebRelease(source+'\n'+source, valid));
});
