import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const ACCEPTED_ARTWORK = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const ACCEPTED_BUILD = new Set(['.html', '.js', '.css', '.map', '.json', '.txt']);
const SAFE_PART = /^[a-zA-Z0-9_.@ -]+$/;

function assert(condition, message) { if (!condition) throw new Error(message); }
function assertSafePath(p) {
  assert(typeof p === 'string' && p.startsWith('img/') && !p.includes('\\'), 'Invalid synthetic asset path');
  const parts = p.split('/');
  assert(parts.length >= 2 && parts.every(x => x !== '.' && x !== '..' && SAFE_PART.test(x)), 'Unsafe synthetic asset path');
  assert(ACCEPTED_ARTWORK.has(extname(p).toLowerCase()), 'Unsupported synthetic asset type');
  return parts;
}
function assertRegularWithoutLinks(root, parts) {
  let cur = root;
  for (const part of parts) {
    cur = join(cur, part);
    const stat = lstatSync(cur);
    assert(!stat.isSymbolicLink(), 'Symlink forbidden: ' + cur);
  }
  assert(lstatSync(cur).isFile(), 'Not a regular file: ' + cur);
  return cur;
}
function copyBuildFolder(src, dest) {
  for (const item of readdirSync(src, { withFileTypes: true })) {
    assert(!item.isSymbolicLink(), 'Build symlink forbidden: ' + item.name);
    const from = join(src, item.name), to = join(dest, item.name);
    if (item.isDirectory()) { mkdirSync(to, { recursive: true }); copyBuildFolder(from, to); }
    else {
      assert(item.isFile() && ACCEPTED_BUILD.has(extname(item.name).toLowerCase()), 'Unexpected built file: ' + item.name);
      copyFileSync(from, to);
    }
  }
}

export function prepareSyntheticFrontend(chartsPath, destinationPath) {
  const charts = resolve(chartsPath), destination = resolve(destinationPath);
  assert(existsSync(charts) && lstatSync(charts).isDirectory(), 'Missing sibling astrological-charts checkout');
  assert(!lstatSync(charts).isSymbolicLink(), 'Charts checkout must not be a symlink');
  const build = join(charts, 'dist/demo/browser');
  const pack = join(charts, '.local/demo-pack');
  const assetRoot = join(pack, 'public/assets');
  const manifestPath = join(pack, 'manifests/approved-assets.json');
  assert(existsSync(build) && existsSync(manifestPath) && existsSync(assetRoot), 'Build the charts demo and generate the synthetic pack first (see docs/SPIKE-001.md)');
  assert(!lstatSync(build).isSymbolicLink() && !lstatSync(assetRoot).isSymbolicLink(), 'No symlinked input folders');
  assert(!existsSync(destination), 'Destination exists; delete only the generated directory explicitly to rebuild: ' + destination);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert(manifest.schemaVersion === 1 && manifest.source?.repository === 'synthetic-local-fixtures' && manifest.source?.commit === 'none', 'Only the generated synthetic pack is permitted');
  assert(Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length <= 2000, 'Invalid synthetic asset list');
  const items = [];
  const caseFold = new Set();
  for (const record of manifest.assets) {
    const parts = assertSafePath(record.path);
    const folded = record.path.toLowerCase();
    assert(!caseFold.has(folded), 'Duplicate asset path (case insensitive): ' + record.path);
    caseFold.add(folded);
    assert(record.rightsHolder === 'Astrological Charts synthetic test fixture', 'Non-synthetic file in manifest');
    assert(Number.isSafeInteger(record.bytes) && record.bytes >= 0 && record.bytes <= 10_000_000, 'Invalid synthetic asset size');
    assert(typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256), 'Invalid synthetic asset digest');
    const source = assertRegularWithoutLinks(assetRoot, parts);
    const bytes = readFileSync(source);
    assert(bytes.length === record.bytes && createHash('sha256').update(bytes).digest('hex') === record.sha256, 'Tampered synthetic asset: ' + record.path);
    items.push({ parts, bytes });
  }
  const staging = destination + '.staging-' + process.pid;
  assert(!existsSync(staging), 'Staging destination already exists');
  try {
    mkdirSync(staging, { recursive: true });
    copyBuildFolder(build, staging);
    const htmlPath = join(staging, 'index.html');
    let html = readFileSync(htmlPath, 'utf8');
    assert(html.includes('</head>') && html.includes('<base href="/">'), 'Unexpected Angular demo index.html format');
    assert(!html.includes('desktop-assets-bootstrap.js'), 'Already prepared desktop assets');
    html = html.replace('</head>', '<script src="/desktop-assets-bootstrap.js"></script></head>');
    writeFileSync(htmlPath, html);
    copyFileSync(join(ROOT, 'scripts/desktop-assets-bootstrap.js'), join(staging, 'desktop-assets-bootstrap.js'));
    for (const entry of items) {
      const out = join(staging, 'assets', ...entry.parts);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, entry.bytes, { flag: 'wx' });
    }
    writeFileSync(join(staging, 'synthetic-assets-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    renameSync(staging, destination);
    return { destination, count: items.length };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    const chartFlag = args.indexOf('--charts');
    const outFlag = args.indexOf('--out');
    assert(args.length % 2 === 0 && args.every((x, i) => i % 2 ? !!x : ['--charts', '--out'].includes(x)) &&
      (chartFlag === -1 || outFlag === -1 || chartFlag !== outFlag), 'Usage: node scripts/prepare-synthetic-frontend.mjs [--charts DIR] [--out DIR]');
    const charts = chartFlag >= 0 ? args[chartFlag+1] : resolve(ROOT, '../astrological-charts');
    const out = outFlag >= 0 ? args[outFlag+1] : resolve(ROOT, '.local/frontend');
    const result = prepareSyntheticFrontend(charts, out);
    console.log('Prepared offline synthetic renderer: ' + result.count + ' verified assets in ' + result.destination);
  } catch (error) { console.error('PREPARE FAILED:', error.message); process.exitCode = 1; }
}
