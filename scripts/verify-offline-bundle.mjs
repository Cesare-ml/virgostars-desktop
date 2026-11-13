/** Fail-closed check of synthetic assets emitted by the Angular desktop builder. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectDesktopStyles } from './verify-bundled-css.mjs';
import { inspectDesktopScripts } from './verify-bundled-scripts.mjs';
import { inspectAngularChunkGraph } from './verify-angular-chunks.mjs';
import { verifyDesktopBaseHref } from './verify-document-base.mjs';
import { verifyDesktopAppRoot } from './verify-desktop-app-root.mjs';
import { PRIVATE_MANIFEST_FILE, validatePrivateManifest } from './prepare-private-assets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function check(ok, message) { if (!ok) throw new Error(message); }
function safeRegular(path, dir=false) {
  const s=lstatSync(path);
  check(!s.isSymbolicLink() && (dir?s.isDirectory():s.isFile()), 'Unsafe ' + (dir?'directory':'file') + ': ' + path);
}
function filesIn(dir, rel='') {
  const files=[];
  for(const entry of readdirSync(join(dir,rel),{withFileTypes:true})) {
    check(!entry.isSymbolicLink(), 'Symlink inside build: ' + entry.name);
    const child=rel?rel+'/'+entry.name:entry.name;
    if(entry.isDirectory()) files.push(...filesIn(dir,child));
    else {check(entry.isFile(),'Non-file in build: ' + child);files.push(child);}
  }
  return files;
}
export function verifyOfflineBundle(bundlePath, stagingPath, options={}) {
  const bundle=resolve(bundlePath), staging=resolve(stagingPath);
  safeRegular(bundle,true);safeRegular(staging,true);
  const privateMode=options.privateMode===true;
  const manifestFile=join(staging,privateMode?PRIVATE_MANIFEST_FILE:'synthetic-assets-manifest.json');
  safeRegular(manifestFile);
  const raw=readFileSync(manifestFile);
  const manifest=privateMode?validatePrivateManifest(raw,options.expectedPrivateHash):JSON.parse(raw.toString('utf8'));
  if(!privateMode) check(manifest.schemaVersion===1 && manifest.source?.repository==='synthetic-local-fixtures' &&
      manifest.source?.commit==='none' && Array.isArray(manifest.files) && manifest.files.length>0,
      'Only an approved synthetic staged manifest can be verified');
  const assetFiles=privateMode?manifest.assets:manifest.files;
  const htmlPath=join(bundle,'index.html');safeRegular(htmlPath);
  const html=readFileSync(htmlPath,'utf8');
  check(!/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](?:https?:)?\/\//i.test(html),
    'Angular bundle references an external script or stylesheet');
  check(!html.includes('desktop-assets-bootstrap.js'), 'Legacy demo bootstrap must not be packaged');
  // Reject a tag present only in a comment/template or script string.
  verifyDesktopAppRoot(html);
  // Resolve all relative assets against the packaged Tauri origin before accepting CSS/JS.
  verifyDesktopBaseHref(html);
  // The original verifier checked images and Angular root but not CSS: an
  // unstyled app could pass verification and yield a tiny chart on Windows.
  const css = inspectDesktopStyles(bundle);
  const js = inspectDesktopScripts(bundle);
  // A main module alone is not sufficient: every transitive Angular split
  // chunk must be present and referenced by a verified local ESM import.
  const graph = inspectAngularChunkGraph(bundle,js.files);
  const assets=join(bundle,'assets');safeRegular(assets,true);
  const expected=[];
  for(const f of assetFiles) {
    check(typeof f.path==='string' && /^img\/[a-zA-Z0-9_.@ /-]+\.(png|jpg|jpeg|webp)$/.test(f.path) &&
      !f.path.split('/').some(x=>x==='.'||x==='..') &&
      Number.isSafeInteger(f.bytes) && /^[a-f0-9]{64}$/.test(f.sha256), 'Invalid generated manifest entry');
    let current=assets;
    const parts=f.path.split('/');
    for(let i=0;i<parts.length;i++) { current=join(current,parts[i]);safeRegular(current,i<parts.length-1); }
    const body=readFileSync(current);
    check(body.length===f.bytes && createHash('sha256').update(body).digest('hex')===f.sha256,
      'Offline bundle missing or modified asset: ' + f.path);
    expected.push(f.path);
  }
  const actual=filesIn(assets).sort();expected.sort();
  check(JSON.stringify(actual)===JSON.stringify(expected), 'Offline bundle contains unexpected or missing assets');
  return {count:expected.length,bundle,stylesheets:css.stylesheets,scripts:js.scripts,
    modules:graph.modules,chunks:graph.chunks,dependencies:graph.dependencies};
}
if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try {
    check(process.argv.length===2 || (process.argv.length===3 && process.argv[2]==='--private'), 'Invalid verifier option');
    const privateMode=process.argv[2]==='--private';
    const out=verifyOfflineBundle(resolve(ROOT,'dist/desktop/browser'),
      resolve(ROOT,privateMode?'.local/frontend-private':'.local/frontend'),{privateMode});
    console.log('Verified '+out.count+(privateMode?' approved private':' synthetic')+
      ' files, '+out.stylesheets+' local CSS link(s), '+out.scripts+' JS entrypoint(s), '+
      out.chunks+' imported chunk(s). No demo bootstrap.');
  }catch(error){ console.error('OFFLINE BUNDLE VERIFICATION FAILED:',error.message);process.exitCode=1; }
}
