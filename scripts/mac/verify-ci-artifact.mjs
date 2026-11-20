#!/usr/bin/env node
// Read-only acceptance gate for a manual GitHub Actions macOS test artifact.
// This test build is deliberately not an official, signed/notarized release.
import {createHash} from 'node:crypto';
import {createReadStream, lstatSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DOWNLOADS, macTarget} from './release-common.mjs';
import {EVENT_ARCHIVE_SHA256} from '../prepare-local-event-archive.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function validateCiReport(report, {version, arch, commit}) {
  const expected='VirgoStars-Desktop-'+version+'-macos-'+arch+'.dmg';
  if (!report || report.schema!=='virgostars.macos.build/1' ||
      report.version!==version || report.sourceCommit!==commit ||
      report.platform!=='darwin' || report.arch!==arch ||
      report.nativeTarget!==macTarget(arch) ||
      report.artwork!=='synthetic' || report.signing!=='ad-hoc' ||
      report.releaseEligible!==false ||
      report.datasets?.cityArchiveSha256!==DOWNLOADS.cities.sha256 ||
      report.datasets?.de441BaseSha256!==DOWNLOADS.de441.sha256 ||
      report.datasets?.eventArchiveSha256!==EVENT_ARCHIVE_SHA256 ||
      !Array.isArray(report.artifacts) || report.artifacts.length!==1 ||
      report.artifacts[0]?.file!==expected ||
      !/^[a-f0-9]{64}$/.test(report.artifacts[0]?.sha256??'') ||
      !Number.isSafeInteger(report.artifacts[0]?.bytes) ||
      report.artifacts[0].bytes<=0)
    throw Error('The build report does not describe this exact unsigned, synthetic macOS test artifact');
  return report.artifacts[0];
}

async function sha256(path) {
  const hash=createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

async function main() {
  if (process.argv.length!==2) throw Error('No command-line options are supported');
  const arch=process.env.EXPECTED_MAC_ARCH;
  if (!['arm64','x64'].includes(arch) || arch!==process.arch || process.platform!=='darwin')
    throw Error('Runner architecture and Node must match the expected native macOS target');
  const version=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version;
  const commit=process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(commit??'')) throw Error('Missing checked-out GitHub commit');
  const dir=join(ROOT,'.local','mac','output',version,arch);
  const report=JSON.parse(readFileSync(join(dir,'build-report.json'),'utf8'));
  const artifact=validateCiReport(report,{version,arch,commit});
  const dmg=join(dir,artifact.file);
  const stat=lstatSync(dmg);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size!==artifact.bytes)
    throw Error('DMG is not a regular file with the reported size');
  const actual=await sha256(dmg);
  if (actual!==artifact.sha256) throw Error('DMG SHA-256 does not match build report');
  const sums=readFileSync(join(dir,'SHA256SUMS.txt'),'utf8');
  if (sums!==artifact.sha256+'  '+artifact.file+'\n')
    throw Error('Checksum manifest does not match build report');
  console.log('Verified unsigned macOS test DMG, checksum and build report for '+arch+' at '+commit);
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error('MAC_CI_VERIFICATION_FAILED:',error.message);process.exitCode=1;});
}
