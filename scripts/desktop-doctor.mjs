#!/usr/bin/env node
/** Read-only, non-sensitive diagnostics for a VirgoStars Desktop development checkout. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectDesktopStyles } from './verify-bundled-css.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS = Object.freeze({pass:'pass', warning:'warning', blocked:'blocked'});
const STAGES = new Set(['setup', 'build', 'verify']);

function commandOutput(binary, args, timeout = 4000) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout, windowsHide: true, shell: false });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout ?? '').trim().slice(0, 180);
}

function safeJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Compare required ranges without network access or third-party semver packages. */
export function supportsNode(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version ?? '');
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return (major === 22 && minor >= 12) || major === 24;
}

/** The resolved Tauri 2.12.x dependency graph requires a stable Rust compiler >= 1.90.0. */
export function supportsRustVersion(versionOutput) {
  const match = /^rustc\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(versionOutput ?? '');
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  return major > 1 || (major === 1 && (minor > 90 || (minor === 90 && patch >= 0)));
}

/** Deliberately small, injectable interface for deterministic tests. */
export function diagnoseEnvironment({
  root = ROOT, charts = resolve(ROOT, '../astrological-charts'),
  stage = 'setup', platform = process.platform, nodeVersion = process.version,
  exists = existsSync, json = safeJson, command = commandOutput,
  cssInspector = inspectDesktopStyles,
} = {}) {
  if (!STAGES.has(stage)) throw new Error('stage must be setup, build, or verify');
  const results = [];
  const add = (id, status, message, remedy) => results.push({ id, status, message, remedy });
  const checkedFile = (id, file, needed, message, remedy) => {
    add(id, exists(file) ? STATUS.pass : needed ? STATUS.blocked : STATUS.warning, message, remedy);
  };
  add('host-platform', platform === 'win32' ? STATUS.pass : STATUS.warning,
    platform === 'win32' ? 'Windows target detected' : 'Non-Windows host: native Windows build cannot be validated here',
    'Run the final build and WebView2 tests on Windows 11 x64.');
  add('node-version', supportsNode(nodeVersion) ? STATUS.pass : STATUS.blocked,
    supportsNode(nodeVersion) ? 'Node version satisfies Angular 20.3' : 'Node version incompatible with Angular 20.3',
    'Install Node.js 22.12+ LTS or 24.x.');
  const npm = command(platform === 'win32' ? 'where.exe' : 'npm', platform === 'win32' ? ['npm.cmd'] : ['--version']);
  add('npm-cli', npm ? STATUS.pass : STATUS.blocked,
    npm ? 'npm command available' : 'npm command not found',
    'Install Node.js/npm; on Windows use npm.cmd to avoid PowerShell execution policy failures.');

  const cargo = command('cargo', ['--version']);
  const rust = command('rustc', ['-vV']);
  add('cargo', cargo ? STATUS.pass : STATUS.blocked,
    cargo ? 'Cargo command available' : 'Cargo not installed or inaccessible', 'Install Rust via rustup with stable MSVC on Windows.');
  add('rust-target', rust && (platform !== 'win32' || /host:\s*\S+-pc-windows-msvc/.test(rust)) ? STATUS.pass : STATUS.blocked,
    rust ? 'Rust toolchain detected' : 'rustc not found',
    'For Windows use rustup default stable-msvc, then restart the terminal.');
  const rustSupported = supportsRustVersion(rust);
  add('rust-version', rustSupported ? STATUS.pass : STATUS.blocked,
    rustSupported ? 'Rust compiler satisfies the current Tauri dependency minimum (>= 1.90.0)' :
      'Rust compiler is too old or not detected; current Tauri dependencies require rustc >= 1.90.0',
    'Run rustup update stable, then rustup default stable and rustc --version. If a directory override is active, check rustup show.');

  if (platform === 'win32') {
    const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
    const msvc = command('where.exe', ['cl.exe']) || (exists(vswhere) && command(vswhere, ['-latest', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath']));
    add('msvc-tools', msvc ? STATUS.pass : STATUS.blocked,
      msvc ? 'MSVC build tools detectable' : 'Visual Studio C++ build tools not detected',
      'Install Visual Studio Build Tools with Desktop development with C++ workload.');
    const client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
    const webview = ['HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\' + client,
      'HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\' + client,
      'HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\' + client]
      .some(key => !!command('reg.exe', ['query', key, '/v', 'pv']));
    add('webview2', webview ? STATUS.pass : STATUS.warning,
      webview ? 'WebView2 runtime registry entry detected' : 'WebView2 runtime registry entry not confirmed',
      'Verify WebView2 Evergreen Runtime is present; an absent registry key alone is not proof it is missing.');
  }

  checkedFile('charts-checkout', join(charts, 'package.json'), true,
    'Sibling astrological-charts package.json available', 'Clone authorized astrological-charts beside virgostars-desktop.');
  const desktopPkg = json(join(root, 'package.json'));
  const chartsPkg = json(join(charts, 'package.json'));
  const declaredRenderer = desktopPkg?.dependencies?.['grafici-astrologici'];
  add('renderer-contract', chartsPkg?.name === 'grafici-astrologici' &&
      declaredRenderer === 'file:../astrological-charts/dist/grafici-astrologici' ? STATUS.pass : STATUS.blocked,
    'Desktop should use the separately built grafici-astrologici npm library',
    'Check sibling library package name and desktop package.json file dependency.');
  const angular = json(join(root, 'angular.json'));
  const tauri = json(join(root, 'src-tauri', 'tauri.conf.json'));
  const coherent = angular?.projects?.desktop?.architect?.build?.options?.outputPath === 'dist/desktop' &&
    tauri?.build?.frontendDist === '../dist/desktop/browser' && tauri?.bundle?.active === false;
  add('frontend-target', coherent ? STATUS.pass : STATUS.blocked,
    'Angular output directory and Tauri frontendDist should match (prototype without installer)',
    'Align angular.json desktop build output with src-tauri/tauri.conf.json.');

  const requireBuild = stage !== 'setup';
  checkedFile('charts-library', join(charts, 'dist', 'grafici-astrologici', 'package.json'), requireBuild,
    'Built renderer package available', 'In astrological-charts run npm ci and npm run build:library.');
  checkedFile('synthetic-manifest', join(charts, '.local', 'demo-pack', 'manifests', 'approved-assets.json'), requireBuild,
    'Synthetic-only asset manifest available', 'In astrological-charts run npm run demo:pack, once.');
  const deps = exists(join(root, 'node_modules', '.bin', platform === 'win32' ? 'ng.cmd' : 'ng'));
  add('desktop-dependencies', deps ? STATUS.pass : requireBuild ? STATUS.blocked : STATUS.warning,
    'Desktop Angular CLI installed locally', 'After building sibling library, run npm install in desktop.');
  checkedFile('npm-lock', join(root, 'package-lock.json'), false,
    'npm lockfile available', 'After real installation, review and commit package-lock.json.');
  checkedFile('cargo-lock', join(root, 'src-tauri', 'Cargo.lock'), false,
    'Cargo lockfile available', 'After real Rust build, review and commit Cargo.lock.');
  if (stage === 'verify') {
    const browserBundle = join(root, 'dist', 'desktop', 'browser');
    const indexPath = join(browserBundle, 'index.html');
    const hasIndex = exists(indexPath);
    checkedFile('angular-bundle', indexPath, true,
      'Desktop Angular build output present', 'Run npm run build:ui and npm run verify:bundle.');

    // A present index.html does not guarantee that the CSS used by WebView2
    // exists or is compatible with the restrictive Tauri CSP.
    let cssReady = false;
    if (hasIndex) {
      try {
        const inspected = cssInspector(browserBundle);
        cssReady = Number.isSafeInteger(inspected?.stylesheets) && inspected.stylesheets > 0;
      } catch {
        // Deliberately suppress filesystem and parser details in diagnostics.
      }
    }
    add('angular-css', cssReady ? STATUS.pass : STATUS.blocked,
      cssReady ? 'Local Angular stylesheet artifacts verified' :
        'Angular stylesheet artifacts missing, invalid or incompatible with desktop CSP',
      'Run npm run verify:css after npm run build:ui; rebuild if the styles are missing or deferred.');
    if (platform === 'win32') {
      checkedFile('windows-executable', join(root, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe'), true,
        'Windows prototype executable present', 'Run npm run tauri:build, then inspect src-tauri/target/release.');
    }
  }
  return { schemaVersion: 1, stage, platform, checks: results,
    counts: { passed: results.filter(x=>x.status==='pass').length,
      warning: results.filter(x=>x.status==='warning').length,
      blocked: results.filter(x=>x.status==='blocked').length },
  };
}

export function formatReport(report) {
  const lines = ['VirgoStars Desktop | read-only build doctor | ' + report.stage];
  for (const item of report.checks) {
    const marker = item.status === 'pass' ? '[OK]' : item.status === 'warning' ? '[WARN]' : '[BLOCK]';
    lines.push(marker + ' ' + item.id + ': ' + item.message);
    if (item.status !== 'pass') lines.push('        ' + item.remedy);
  }
  lines.push('Summary: ' + report.counts.passed + ' pass, ' + report.counts.warning + ' warn, ' + report.counts.blocked + ' block');
  lines.push('No credentials, user files or network services were accessed.');
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = process.argv.slice(2);
  if (options.some(x => !['--json','--strict','--stage=setup','--stage=build','--stage=verify'].includes(x)) ||
      options.filter(x=>x.startsWith('--stage=')).length > 1) {
    console.error('Usage: node scripts/desktop-doctor.mjs [--stage=setup|build|verify] [--json] [--strict]');
    process.exitCode = 2;
  } else {
    const selected=options.find(x=>x.startsWith('--stage='));
    const report=diagnoseEnvironment({stage:selected ? selected.slice('--stage='.length) : 'setup'});
    console.log(options.includes('--json') ? JSON.stringify(report,null,2) : formatReport(report));
    if (options.includes('--strict') && report.counts.blocked > 0) process.exitCode=1;
  }
}
