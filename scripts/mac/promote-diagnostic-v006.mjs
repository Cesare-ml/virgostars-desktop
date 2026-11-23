#!/usr/bin/env node
/**
 * Promote only the known successful macOS v0.0.6 diagnostic build into a
 * clearly-labelled, non-notarized test prerelease. NEVER touches v0.0.6.
 * This is an artifact integrity check, not signing or artwork-rights clearance.
 */
import {createHash} from 'node:crypto';
import {createReadStream, copyFileSync, lstatSync, mkdirSync, readFileSync,
  readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DOWNLOADS, PINNED, macTarget} from './release-common.mjs';
import {EVENT_ARCHIVE_SHA256} from '../prepare-local-event-archive.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION='0.0.6';
const BUILT_COMMIT='40c8f9055c9035eb10472d8c4b07bc613d8c9b51';
const RUN_ID='45271186416';
const ARCHS=['arm64','x64'];
const fail=message=>{throw Error('MAC TEST PUBLISH CHECK: '+message);};

function findReports(root) {
  const reports=[];
  let entries=0;
  const visit=(dir,depth)=>{
    if(depth>5)fail('Artifact directory nesting is excessive');
    for(const entry of readdirSync(dir,{withFileTypes:true})) {
      if(++entries>60)fail('Artifact has too many files');
      const path=join(dir,entry.name);
      const stat=lstatSync(path);
      if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))fail('Artifact contains an unsafe entry');
      if(stat.isDirectory())visit(path,depth+1);
      else if(entry.name==='build-report.json')reports.push(path);
    }
  };
  visit(root,0);
  if(reports.length!==1)fail('Expected exactly one verified build report per architecture');
  return reports[0];
}

async function sha256(path) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path))hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  if(process.argv.length!==2)fail('No arguments permitted');
  if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!=='Cesare-ml/virgostars-desktop')
    fail('This publisher may run only in its repository GitHub Actions context');
  const output=join(ROOT,'.local','mac','publish-v006');
  mkdirSync(output,{recursive:true});
  const checksums=[];
  for(const arch of ARCHS) {
    const input=join(ROOT,'.local','mac','publish-in',arch);
    const reportPath=findReports(input);
    const report=JSON.parse(readFileSync(reportPath,'utf8'));
    const filename='VirgoStars-Desktop-'+VERSION+'-macos-'+arch+'.dmg';
    if(report.schema!=='virgostars.macos.build/1'||report.version!==VERSION||
       report.sourceCommit!==BUILT_COMMIT||report.platform!=='darwin'||report.arch!==arch||
       report.nativeTarget!==macTarget(arch)||report.artwork!=='original-uncleared'||
       report.signing!=='ad-hoc'||report.releaseEligible!==false||
       JSON.stringify(report.dependencyCommits)!==JSON.stringify(PINNED)||
       report.datasets?.cityArchiveSha256!==DOWNLOADS.cities.sha256||
       report.datasets?.de441BaseSha256!==DOWNLOADS.de441.sha256||
       report.datasets?.eventArchiveSha256!==EVENT_ARCHIVE_SHA256||
       !Array.isArray(report.artifacts)||report.artifacts.length!==1||
       report.artifacts[0].file!==filename) {
      fail('Artifact provenance, signing or source policy mismatch for '+arch);
    }
    const dmg=join(dirname(reportPath),filename);
    const stat=lstatSync(dmg);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==report.artifacts[0].bytes||
       stat.size<100_000_000||stat.size>900_000_000)fail('Invalid disk image size/type for '+arch);
    const digest=await sha256(dmg);
    if(!/^[a-f0-9]{64}$/.test(digest)||digest!==report.artifacts[0].sha256)
      fail('DMG checksum mismatch for '+arch);
    if(readFileSync(join(dirname(reportPath),'SHA256SUMS.txt'),'utf8')!==digest+'  '+filename+'\n')
      fail('Signed-off artifact checksum manifest mismatch for '+arch);
    copyFileSync(dmg,join(output,filename));
    copyFileSync(reportPath,join(output,arch+'-build-report.json'));
    checksums.push(digest+'  '+filename);
    console.log('Verified '+arch+' test DMG against successful run '+RUN_ID+': '+digest);
  }
  writeFileSync(join(output,'SHA256SUMS-macos.txt'),checksums.join('\n')+'\n');
  writeFileSync(join(output,'RELEASE-NOTES.md'),[
    '# VirgoStars Desktop 0.0.6 — macOS test builds',
    '',
    'This is an **experimental macOS prerelease**, NOT the signed or notarized stable release.',
    '',
    '- Apple Silicon (arm64) and Intel (x64) DMG files.',
    '- Built from the v0.0.6 source snapshot plus isolated compatibility fixes.',
    '- Source commit: `'+BUILT_COMMIT+'`.',
    '- Successful GitHub Actions build: https://github.com/Cesare-ml/virgostars-desktop/actions/runs/'+RUN_ID,
    '- Both build reports, SHA-256 sums and the full test provenance are attached.',
    '',
    '**Important limitations:** ad-hoc code signing only; **not notarized by Apple**.',
    'macOS Gatekeeper may block normal installation. Real-Mac application acceptance has',
    'not been performed; native features and the updater are not verified on real hardware.',
    'The original artwork is flagged as not separately cleared for a stable public release',
    'in the build report. Do not treat this diagnostic prerelease as a vetted stable package.',
    'Use only for testing; do not assume it can automatically update itself.',
    '',
    'The original [v0.0.6 Windows release](https://github.com/Cesare-ml/virgostars-desktop/releases/tag/v0.0.6)',
    'is unchanged.',
    ''
  ].join('\n'));
  console.log('Validated both DMGs, reports, checksums, and release-notes for prerelease promotion.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
