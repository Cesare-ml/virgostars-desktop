import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('production Angular desktop build disables CSP-incompatible inline-critical CSS',()=>{
  const angular=JSON.parse(read('angular.json'));
  const build=angular.projects.desktop.architect.build;
  assert.equal(build.builder,'@angular-devkit/build-angular:application');
  assert.equal(build.options.optimization.scripts,true);
  assert.equal(build.options.optimization.styles.minify,true);
  assert.equal(build.options.optimization.styles.inlineCritical,false);
  assert.equal(build.options.optimization.fonts,false);
  assert.equal(build.options.subresourceIntegrity,false);
});

test('native Tauri CSP remains restrictive; no inline script handler allowance',()=>{
  const config=JSON.parse(read('src-tauri/tauri.conf.json'));
  const csp=config.app.security.csp;
  assert.match(csp,/script-src 'self'/);
  assert.doesNotMatch(csp,/script-src[^;]*'unsafe-inline'/);
  assert.match(csp,/style-src 'self' 'unsafe-inline'/);
  assert.deepEqual(config.app.security.capabilities,[]);
  assert.equal(config.app.security.dangerousDisableAssetCspModification,undefined);
});

test('offline verifier rejects print-only and inline event-handler CSS',()=>{
  const checker=read('scripts/verify-bundled-css.mjs');
  const offline=read('scripts/verify-offline-bundle.mjs');
  assert.match(checker,/Inline stylesheet event handler/);
  assert.match(checker,/Deferred or print-only stylesheet/);
  assert.match(offline,/inspectDesktopStyles\(bundle\)/);
});

test('production Desktop does not rely on remote stylesheets or fonts',()=>{
  const index=read('src/index.html');
  const angular=JSON.parse(read('angular.json'));
  const entry=read('src/styles.css');
  assert.doesNotMatch(index,/<link\s+[^>]*https?:\/\//i);
  assert.doesNotMatch(entry,/@import\s+url\(\s*['"]?https?:\/\//i);
  assert.equal(angular.projects.desktop.architect.build.options.optimization.fonts,false);
});
