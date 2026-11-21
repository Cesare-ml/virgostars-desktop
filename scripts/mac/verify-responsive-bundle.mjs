#!/usr/bin/env node
// Check the COMPILED Angular desktop CSS. A valid source file is not enough:
// WKWebView once showed only the bottom half of the Mac window.
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDesktopStyles} from '../verify-bundled-css.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT_NAME=/^(?:(?:main|polyfills)(?:-[A-Za-z0-9_-]+)?|chunk-[A-Za-z0-9_-]+)\.js$/;
const CSS_NAME=/^styles(?:-[A-Za-z0-9_-]+)?\.css$/;
const MAX_BYTES=64*1024*1024;
const MAX_TOTAL_BYTES=256*1024*1024;
const fail=reason=>{throw Error('MAC RESPONSIVE BUNDLE: '+reason);};

const declaration=(body,name,value)=>{
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return new RegExp('(?:^|;)\\s*'+escaped+'\\s*:\\s*'+value+'\\s*(?:;|$)','i').test(body);
};
function includesDeclarations(body, rules) {
  return rules.every(([key,pattern])=>declaration(body,key,pattern));
}
export function hasFixedDesktopHost(css) {
  if(typeof css!=='string')return false;
  // Comments can precede the host selector in source CSS. Ignore them, never
  // accept a disabled declaration embedded only inside a comment.
  const source=css.replace(/\/\*[\s\S]*?\*\//g,'');
  const rules=[...source.matchAll(/(?:^|\})\s*vs-desktop-app\s*\{([^{}]{1,1200})\}/g)];
  return rules.some(([,body])=>includesDeclarations(body,[
    ['display','block'],['position','fixed'],['inset','0(?:px)?']
  ]));
}
export function hasPinnedWorkspace(cssOrJs) {
  if(typeof cssOrJs!=='string')return false;
  const rules=[...cssOrJs.matchAll(/\.workspace(?:\[[^\]{}]{1,160}\])?\s*\{([^{}]{1,1800})\}/g)];
  return rules.some(([,body])=>includesDeclarations(body,[
    ['position','absolute'],['inset','0(?:px)?'],
    ['width','100%'],['height','100%'],['display','grid']
  ]));
}
export function verifyMacResponsiveBundle(bundleDir) {
  const dir=resolve(bundleDir);
  const styles=inspectDesktopStyles(dir);
  if(styles.files.length!==1)fail('one global CSS stylesheet is required');
  const cssPath=join(dir,styles.files[0]);
  const css=readFileSync(cssPath,'utf8');
  if(!hasFixedDesktopHost(css))fail('compiled global stylesheet has no fixed viewport host');

  // Check all outputs even if we find an early match: no unsafe later JS chunk
  // may hide under the successful candidate.
  const entries=readdirSync(dir,{withFileTypes:true})
    .filter(entry=>SCRIPT_NAME.test(entry.name)||CSS_NAME.test(entry.name));
  if(!entries.length||entries.length>514)fail('unexpected number of script and style candidates');
  let bytes=0;
  const candidates=[];
  for(const entry of entries) {
    const path=join(dir,entry.name),stat=lstatSync(path);
    if(!entry.isFile()||entry.isSymbolicLink()||!stat.isFile()||stat.isSymbolicLink()||
       !Number.isSafeInteger(stat.size)||stat.size>MAX_BYTES||(bytes+=stat.size)>MAX_TOTAL_BYTES)
      fail('unsafe or oversized CSS/JS candidate');
    candidates.push(path);
  }
  if(!candidates.some(path=>hasPinnedWorkspace(readFileSync(path,'utf8'))))
    fail('compiled Angular workspace lost full-viewport geometry');
  return {stylesheets:styles.files.length,checked:candidates.length};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try {
    if(process.argv.length!==2)fail('unexpected CLI arguments');
    const result=verifyMacResponsiveBundle(join(ROOT,'dist','desktop','browser'));
    console.log('Verified fixed macOS viewport host and full-window Angular workspace in '+
      result.checked+' compiled CSS/JS candidates (static test; native visual QA remains required).');
  } catch(error) {
    console.error(error instanceof Error?error.message:'MAC RESPONSIVE BUNDLE: failed');
    process.exitCode=1;
  }
}
