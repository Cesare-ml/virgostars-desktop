/**
 * Inspect emitted Angular ESM import edges without executing bundled code.
 * TypeScript is an existing Desktop devDependency used here only as a JS parser.
 * Static verification is not a WebView2 execution or dependency-integrity proof.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

const MODULE_NAME = /^(?:(?:main|polyfills)(?:-[A-Za-z0-9_-]+)?|chunk-[A-Za-z0-9_-]+)\.js$/;
const CHUNK_NAME = /^chunk-[A-Za-z0-9_-]+\.js$/;
const MAX_MODULES = 512;
const MAX_MODULE_BYTES = 64 * 1024 * 1024;
const MAX_GRAPH_BYTES = 256 * 1024 * 1024;
const fail = reason => { throw new Error('DESKTOP JS CHUNKS: ' + reason); };

/** Resolve only a direct root-level, relative Angular-generated import path. */
function localModuleName(specifier) {
  if (typeof specifier !== 'string' || !specifier.startsWith('./')) fail('Nonlocal or invalid JavaScript import');
  const name = specifier.slice(2);
  if (!MODULE_NAME.test(name)) fail('Unexpected JavaScript import filename');
  return name;
}

function importNames(name, text) {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (source.parseDiagnostics.length) fail('Invalid emitted JavaScript syntax');
  const imports = [];
  function record(specifier) {
    imports.push(localModuleName(specifier));
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        if (!ts.isStringLiteral(node.moduleSpecifier)) fail('Nonliteral static JavaScript import');
        record(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments.length < 1 || node.arguments.length > 2 ||
        !(ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
        fail('Nonliteral dynamic JavaScript import');
      }
      record(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

/** Verify every root-level emitted *.js file is an import-reachable ESM module.
 * Reject partial dynamic-import packaging and orphan chunks; no JS is executed.
 * @param {string} bundleDir Angular dist/desktop/browser directory
 * @param {readonly string[]} entrypointFiles Real src files from inspectDesktopScripts
 */
export function inspectAngularChunkGraph(bundleDir, entrypointFiles) {
  const dir = resolve(bundleDir);
  if (!Array.isArray(entrypointFiles) || !entrypointFiles.length ||
      entrypointFiles.length > 2 || new Set(entrypointFiles).size !== entrypointFiles.length ||
      entrypointFiles.some(name => typeof name !== 'string' || !MODULE_NAME.test(name))) {
    fail('Invalid Angular module entrypoint list');
  }
  const diskModules = readdirSync(dir, { withFileTypes: true })
    .filter(item => /\.js$/i.test(item.name));
  if (diskModules.length > MAX_MODULES) fail('Too many Angular JavaScript modules');
  for (const item of diskModules) {
    if (!MODULE_NAME.test(item.name) || !item.isFile() || item.isSymbolicLink()) {
      fail('Unexpected or unsafe root JavaScript file');
    }
  }
  const available = new Set(diskModules.map(item => item.name));
  const visited = new Set();
  const pending = [...entrypointFiles];
  let dependencies = 0;
  let bytes = 0;
  while (pending.length) {
    const name = pending.pop();
    if (visited.has(name)) continue;
    if (!available.has(name)) fail('Local Angular JavaScript module missing');
    const path = join(dir, name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) {
      fail('Missing or unsafe Angular JavaScript module');
    }
    if (stat.size > MAX_MODULE_BYTES || (bytes += stat.size) > MAX_GRAPH_BYTES) {
      fail('Angular JavaScript graph exceeds size limits');
    }
    const body = readFileSync(path, 'utf8');
    visited.add(name);
    for (const target of importNames(name, body)) {
      dependencies++;
      if (!available.has(target)) fail('Imported Angular JavaScript chunk missing');
      if (!visited.has(target)) pending.push(target);
    }
  }
  if (visited.size !== available.size) fail('Unreferenced Angular JavaScript chunk in bundle');
  return {
    modules: visited.size,
    chunks: [...visited].filter(name => CHUNK_NAME.test(name)).length,
    dependencies
  };
}
