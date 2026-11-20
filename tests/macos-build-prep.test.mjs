import test from 'node:test';
import assert from 'node:assert/strict';
import {macTarget, parseBuildOptions, releaseCredentialsPresent, validatedTag,
  verifyReport, DOWNLOADS} from '../scripts/mac/release-common.mjs';

test('macOS architecture and options are deliberately bounded', () => {
  assert.equal(macTarget('arm64'), 'aarch64-apple-darwin');
  assert.equal(macTarget('x64'), 'x86_64-apple-darwin');
  assert.throws(() => macTarget('ia32'));
  assert.deepEqual(parseBuildOptions([]), {original:false, release:false});
  assert.deepEqual(parseBuildOptions(['--release','--original']), {original:true, release:true});
  assert.throws(() => parseBuildOptions(['--release','--release']));
  assert.throws(() => parseBuildOptions(['--publish']));
});
test('a public release requires Apple credentials and exact tag', () => {
  const env = {APPLE_SIGNING_IDENTITY:'Developer ID Application: Example',
    APPLE_TEAM_ID:'TEAM', APPLE_ID:'example@example.invalid', APPLE_PASSWORD:'dummy'};
  assert.equal(releaseCredentialsPresent(env), true);
  assert.equal(releaseCredentialsPresent({...env, APPLE_SIGNING_IDENTITY:'-'}), false);
  assert.equal(releaseCredentialsPresent({...env, APPLE_PASSWORD:''}), false);
  assert.equal(validatedTag('v0.0.2','0.0.2'), 'v0.0.2');
  assert.throws(() => validatedTag('v0.0.3','0.0.2'));
  assert.throws(() => validatedTag('v0.0.2-beta','0.0.2'));
});
test('publish verification is fail-closed, including artifact names', () => {
  const sha='0'.repeat(64), commit='a'.repeat(40);
  const report={schema:'virgostars.macos.build/1',version:'0.0.2',sourceCommit:commit,
    platform:'darwin',arch:'arm64',releaseEligible:true,signing:'apple-developer-notarized',
    artwork:'synthetic',artifacts:[{file:'VirgoStars-Desktop-0.0.2-macos-arm64.dmg',sha256:sha,bytes:4096}]};
  assert.equal(verifyReport(report,'0.0.2',commit).sha256,sha);
  for(const value of [
    {...report,releaseEligible:false}, {...report,signing:'ad-hoc'},
    {...report,version:'0.0.3'}, {...report,artwork:'original-uncleared'},
    {...report,artifacts:[{...report.artifacts[0],file:'../../other.dmg'}]},
  ]) assert.throws(() => verifyReport(value,'0.0.2',commit));
  assert.throws(() => verifyReport(report,'0.0.2','b'.repeat(40)));
});
test('the download inputs are pinned to fixed HTTPS release assets', () => {
  for(const entry of [DOWNLOADS.cities, DOWNLOADS.de441]) {
    assert.match(entry.url,/^https:\/\/github\.com\/Cesare-ml\//);
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);
  }
});
