#!/usr/bin/env node
/** Fail early if the pinned sibling libraries no longer implement the APIs
 * imported or called by VirgoStars Desktop. Static AST check, no eval/network.
 * Angular and native smoke tests remain mandatory.
 */
import ts from 'typescript';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fail=message=>{throw new Error('MAC UPSTREAM API: '+message);};
function sourceFile(name,content,scriptKind=ts.ScriptKind.TS) {
  const parsed=ts.createSourceFile(name,content,ts.ScriptTarget.Latest,true,scriptKind);
  if(parsed.parseDiagnostics.length)fail('Cannot parse '+name);
  return parsed;
}
function isThisRenderer(node) {
  return ts.isPropertyAccessExpression(node) &&
    node.expression.kind===ts.SyntaxKind.ThisKeyword &&
    node.name.text==='renderer';
}
export function compareRendererCalls(desktopSource,chartsSource) {
  const desktop=sourceFile('desktop-app.component.ts',desktopSource);
  const charts=sourceFile('grafico-render.service.ts',chartsSource);
  const requested=new Set();
  function scan(node) {
    if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
       isThisRenderer(node.expression.expression)) requested.add(node.expression.name.text);
    ts.forEachChild(node,scan);
  }
  scan(desktop);
  const renderer=charts.statements.find(node=>ts.isClassDeclaration(node) &&
    node.name?.text==='GraficoRenderService');
  if(!renderer)fail('GraficoRenderService class is absent');
  const supported=new Set(renderer.members.filter(ts.isMethodDeclaration)
    .map(node=>node.name).filter(ts.isIdentifier).map(node=>node.text));
  const missing=[...requested].filter(name=>!supported.has(name)).sort();
  return {requested:[...requested].sort(),missing};
}
export function hasNamedExport(moduleSource,symbol) {
  const parsed=sourceFile('module.mjs',moduleSource,ts.ScriptKind.JS);
  return parsed.statements.some(node=>
    ((ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)) &&
      node.name?.text===symbol && node.modifiers?.some(mod=>mod.kind===ts.SyntaxKind.ExportKeyword)) ||
    (ts.isExportDeclaration(node) && node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(item=>item.name.text===symbol)));
}
function safeFile(path) {
  try {
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_000_000)
      fail('Missing, unsafe or oversized pinned source file');
    return readFileSync(path,'utf8');
  } catch {
    // Never include a local filesystem path in CI diagnostics.
    fail('Missing, unsafe or unreadable pinned source file');
  }
}
export function verifyMacApiContracts(root=ROOT) {
  const desktop=safeFile(join(root,'src/app/desktop-app.component.ts'));
  const charts=safeFile(resolve(root,'../astrological-charts/src/lib/services/grafico-render.service.ts'));
  const renderer=compareRendererCalls(desktop,charts);
  if(renderer.missing.length)fail('Charts renderer lacks: '+renderer.missing.join(', '));
  if(!renderer.requested.length)fail('Desktop renderer call-site inspection was empty');

  const functionsRoot=resolve(root,'../astrological-functions');
  const pkg=JSON.parse(safeFile(join(functionsRoot,'package.json')));
  if(pkg.name!=='astrological-functions'||!pkg.exports)
    fail('Pinned Functions package metadata is incompatible');
  const required={
    './astro-com-house-provider':['calculateAstroComHouseFromProvider'],
    './regolo-arabic-parts':['calculateRegoloArabicParts'],
    './virgostars-star-contacts':['calculateVirgoStarsStarContacts'],
    './planetary-hours':['buildPlanetaryHours']
  };
  let modules=0;
  for(const [subpath,names] of Object.entries(required)) {
    const entry=pkg.exports[subpath];
    const importPath=entry?.import;
    if(typeof importPath!=='string'||!/^\.\/src\/[a-z-]+\.mjs$/.test(importPath))
      fail('Functions export missing or unsafe: '+subpath);
    const body=safeFile(join(functionsRoot,importPath.slice(2)));
    for(const name of names)if(!hasNamedExport(body,name))
      fail('Functions '+subpath+' does not export '+name);
    modules++;
  }
  const rootEntry=pkg.exports['.'];
  if(rootEntry!=='./src/index.mjs'&&rootEntry?.import!=='./src/index.mjs')
    fail('Functions public root entry changed unexpectedly');
  if(!hasNamedExport(safeFile(join(functionsRoot,'src/index.mjs')),'buildPlanetaryHours'))
    fail('Functions root is missing buildPlanetaryHours');
  return {rendererCalls:renderer.requested.length,astroModules:modules};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try{
    if(process.argv.length!==2)fail('No arguments supported');
    const result=verifyMacApiContracts();
    console.log('Pinned Desktop APIs verified: '+result.rendererCalls+
      ' renderer calls and '+result.astroModules+' typed astrology modules.');
  }catch(error){
    console.error(error instanceof Error?error.message:'MAC UPSTREAM API: unknown error');
    process.exitCode=1;
  }
}
