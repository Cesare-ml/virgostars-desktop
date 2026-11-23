// VirgoStars Desktop original source, CPAL-1.0. See LICENSE and NOTICE.
// Collect license notices from the resolved Windows Cargo graph. Run after the
// frontend build and before packaging; never include machine paths in output.
import {spawnSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

const fallbackDir = resolve('third-party/cargo-license-fallbacks');
const fallbacks = new Map([
  // block2 0.6.2 declares MIT but its published crate omits a LICENSE file.
  // Original MIT text from https://github.com/madsmtm/objc2/blob/main/LICENSE-MIT.txt
  ['block2@0.6.2', 'block2-MIT.txt'],
  // Approved, exact versions from the same upstream objc2 repository.
  // Their Cargo SPDX declarations include MIT as an allowed license choice.
  ['dispatch2@0.3.1', 'objc2-project-MIT.txt'],
  ['objc2@0.6.5', 'objc2-project-MIT.txt'],
  ['objc2-app-kit@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-core-foundation@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-core-graphics@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-encode@4.1.0', 'objc2-project-MIT.txt'],
  ['objc2-exception-helper@0.1.1', 'objc2-project-MIT.txt'],
  ['objc2-foundation@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-io-surface@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-osa-kit@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-quartz-core@0.3.2', 'objc2-project-MIT.txt'],
  ['objc2-web-kit@0.3.2', 'objc2-project-MIT.txt'],
  ['alloc-stdlib@0.3.0', 'alloc-BSD-3-Clause.txt'],
  ['selectors@0.38.0', 'selectors-MPL-2.0.txt'],
  ['tauri-plugin@2.7.4', 'tauri-plugin-Apache-2.0.txt'],
  ['webview2-com@0.39.1', 'webview2-MIT.txt'],
  ['webview2-com-sys@0.39.1', 'webview2-MIT.txt'],
  ['webview2-com-macros@0.8.1', 'webview2-MIT.txt'],
]);
const namedTarget = process.argv.length === 4 && process.argv[2] === '--target' ? process.argv[3] : null;
if ((process.argv.length !== 2 && namedTarget === null) ||
    (namedTarget !== null && !['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin'].includes(namedTarget)))
  throw Error('Usage: prepare-release-notices.mjs [--target x86_64-pc-windows-msvc|aarch64-apple-darwin|x86_64-apple-darwin]');
const target = namedTarget ?? 'x86_64-pc-windows-msvc';
const platformLabel = target.includes('apple') ? 'macOS' : 'Windows';
const cargo = spawnSync('cargo', ['metadata', '--offline', '--locked', '--format-version', '1',
  '--filter-platform', target, '--manifest-path', 'src-tauri/Cargo.toml'],
  {encoding:'utf8', maxBuffer:32 * 1024 * 1024});
if (cargo.error || cargo.status !== 0) throw Error('Could not resolve the offline, locked Cargo dependency graph for the requested platform.');
const metadata = JSON.parse(cargo.stdout);
const packages = [...metadata.packages].sort((a,b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const filename = name => /^(license|licence|copying|notice)([._-]|$)/i.test(name);
const localLicenseFiles = dir => readdirSync(dir, {withFileTypes:true})
  .filter(entry => entry.isFile() && filename(entry.name)).map(entry => join(dir, entry.name)).sort();
const sections = [platformLabel + ' Cargo dependency notices',
  'This inventory conservatively includes the resolved '+platformLabel+' dependency graph, including build-time dependencies.'];
const missing = [];
for (const pkg of packages) {
  const key = `${pkg.name}@${pkg.version}`;
  let dir = dirname(pkg.manifest_path);
  let files = localLicenseFiles(dir);
  if (!files.length && pkg.name.startsWith('virgostars-')) {
    for (let i=0; i<3 && !files.length; i++) { dir=dirname(dir); files=localLicenseFiles(dir); }
  }
  if (!files.length && fallbacks.has(key)) {
    // Never silently substitute an incompatible license notice.
    if (key === 'block2@0.6.2' && pkg.license !== 'MIT')
      throw Error('block2 declared license changed; review its upstream terms.');
    if (fallbacks.get(key) === 'objc2-project-MIT.txt' &&
        pkg.license !== 'MIT' && pkg.license !== 'Zlib OR Apache-2.0 OR MIT')
      throw Error('objc2 family declared license changed; review upstream before packaging.');
    files = [join(fallbackDir, fallbacks.get(key))];
  }
  if (!files.length) { missing.push(key); continue; }
  sections.push(`\n${'='.repeat(72)}\n${key}\nDeclared license: ${pkg.license || 'project license'}`);
  if (key === 'tauri-plugin@2.7.4') sections.push('Copyright 2019-2024 Tauri Programme within The Commons Conservancy.');
  for (const file of files) {
    if (statSync(file).size > 1024 * 1024) throw Error(`Unexpectedly large license file for ${key}.`);
    sections.push(readFileSync(file, 'utf8').trim());
  }
}
if (missing.length) throw Error('Missing license text for '+missing.length+
  ' Cargo packages: '+missing.join(', ')+'. Review all missing notices before release.');
const gsap = readFileSync('node_modules/gsap/gsap-core.js', 'utf8');
const gsapNotice = gsap.match(/\/\*![\s\S]*?\*\//)?.[0];
if (!gsapNotice?.includes('gsap.com/standard-license') || !gsapNotice.includes('@license'))
  throw Error('GSAP license notice not found; review the resolved frontend dependency.');
// Angular produces the other frontend dependency notices in this file.
if (!statSync('dist/desktop/3rdpartylicenses.txt').size) throw Error('Angular third-party notices are missing.');
const out = resolve('.local/release-licenses');
mkdirSync(out, {recursive:true});
writeFileSync(join(out, 'cargo-notices.txt'), sections.join('\n\n') + '\n');
writeFileSync(join(out, 'gsap-notice.txt'), gsapNotice + '\n');
const resources = {
  '../LICENSE':'licenses/VIRGOSTARS-LICENSE.txt', '../NOTICE':'licenses/VIRGOSTARS-NOTICE.txt',
  '../third-party/tz-lookup/LICENSE':'licenses/tz-lookup-LICENSE.txt',
  '../third-party/leaflet/LICENSE':'licenses/leaflet-LICENSE.txt',
  '../node_modules/three/LICENSE':'licenses/three-LICENSE.txt',
  '../node_modules/tslib/LICENSE.txt':'licenses/tslib-LICENSE.txt',
  '../dist/desktop/3rdpartylicenses.txt':'licenses/frontend-notices.txt',
  '../.local/release-licenses/cargo-notices.txt':'licenses/cargo-notices.txt',
  '../.local/release-licenses/gsap-notice.txt':'licenses/gsap-notice.txt',
};
writeFileSync(join(out, 'tauri-license.conf.json'), JSON.stringify({bundle:{resources}}, null, 2) + '\n');
console.log('Prepared notices for '+packages.length+' '+platformLabel+' Cargo packages and the built frontend.');
