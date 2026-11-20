import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCiReport} from '../scripts/mac/verify-ci-artifact.mjs';
import {DOWNLOADS,macTarget} from '../scripts/mac/release-common.mjs';

const workflow=readFileSync(new URL('../.github/workflows/build-macos.yml',import.meta.url),'utf8');
const sha='a'.repeat(40);
const build=(overrides={})=>({
  schema:'virgostars.macos.build/1',
  version:'0.0.2',
  sourceCommit:sha,
  platform:'darwin',
  arch:'arm64',
  nativeTarget:macTarget('arm64'),
  artwork:'synthetic',
  signing:'ad-hoc',
  releaseEligible:false,
  datasets:{
    cityArchiveSha256:DOWNLOADS.cities.sha256,
    de441BaseSha256:DOWNLOADS.de441.sha256
  },
  artifacts:[{file:'VirgoStars-Desktop-0.0.2-macos-arm64.dmg',bytes:512,sha256:'b'.repeat(64)}],
  ...overrides
});

test('macOS workflow is ONLY manually triggered, with no write privileges',()=>{
  assert.match(workflow,/^on:\s*\n\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow,/^\s+(?:push|pull_request|schedule|release|workflow_run):/m);
  assert.match(workflow,/permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow,/contents: write/);
  assert.doesNotMatch(workflow,/gh release|--release|APPLE_PASSWORD|secrets\./);
});
test('only GitHub-hosted native macOS runners with unique artifact names',()=>{
  assert.match(workflow,/runner: macos-15\s*$/m);
  assert.match(workflow,/runner: macos-15-intel\s*$/m);
  assert.match(workflow,/arch: arm64/);
  assert.match(workflow,/arch: x64/);
  assert.match(workflow,/npm run build:mac\s*$/m);
  assert.match(workflow,/verify-ci-artifact\.mjs/);
  assert.match(workflow,/uses: actions\/upload-artifact@v4/);
  assert.match(workflow,/include-hidden-files: true/);
  assert.match(workflow,/if-no-files-found: error/);
  assert.match(workflow,/name: virgostars-macos-\$\{\{ matrix\.arch \}\}/);
});
test('only matching ad-hoc, synthetic, read-only artifacts pass the CI report gate',()=>{
  const valid=build();
  assert.equal(validateCiReport(valid,{version:'0.0.2',arch:'arm64',commit:sha}).bytes,512);
  for (const changed of [
    {signing:'apple-developer-notarized'},
    {releaseEligible:true},
    {artwork:'rights-cleared-original'},
    {sourceCommit:'c'.repeat(40)},
    {datasets:{...valid.datasets,de441BaseSha256:'0'.repeat(64)}},
    {artifacts:[{...valid.artifacts[0],file:'../../bad.dmg'}]},
    {arch:'x64'},
    {nativeTarget:'x86_64-apple-darwin'}
  ]) {
    assert.throws(()=>validateCiReport(build(changed),
      {version:'0.0.2',arch:'arm64',commit:sha}));
  }
});
