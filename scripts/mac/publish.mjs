#!/usr/bin/env node
// Optional maintainer-only upload. Requires an existing release and a notarized Mac build.
// Does not create tags/releases, overwrite assets, publish drafts or expose credentials.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream, readFileSync, statSync, lstatSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {REPO, validatedTag, verifyReport} from './release-common.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function run(name,args,quiet=false) {
  const r=spawnSync(name,args,{cwd:ROOT,encoding:'utf8',shell:false,
    stdio:quiet?['ignore','pipe','pipe']:'inherit'});
  if(r.error || r.status!==0) throw Error(name+' failed ('+args.slice(0,3).join(' ')+')'+
    (quiet?': '+String(r.stderr).slice(0,750):''));
  return quiet?r.stdout.trim():'';
}
async function hash(path) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
async function main() {
  if(process.platform!=='darwin' || process.argv.length!==3)
    throw Error('Usage on the same Mac: node scripts/mac/publish.mjs vX.Y.Z');
  const version=JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).version;
  const tag=validatedTag(process.argv[2],version);
  const current=run('git',['rev-parse','HEAD'],true);
  const output=join(ROOT,'.local','mac','output',version,process.arch);
  const reportFile=join(output,'build-report.json');
  const report=JSON.parse(readFileSync(reportFile,'utf8'));
  const artifact=verifyReport(report,version,current);
  const dmg=join(output,artifact.file);
  const status=lstatSync(dmg);
  if(!status.isFile() || status.isSymbolicLink() || status.size!==artifact.bytes ||
    await hash(dmg)!==artifact.sha256) throw Error('DMG checksum/size differs from notarized build report');
  const checksums=join(output,'SHA256SUMS.txt');
  const expected=artifact.sha256+'  '+artifact.file+'\n';
  if(readFileSync(checksums,'utf8')!==expected) throw Error('Release checksums differ from build report');
  run('xcrun',['stapler','validate',dmg]);
  run('git',['fetch','--tags','--quiet','origin']);
  const tagged=run('git',['rev-parse',tag+'^{commit}'],true);
  if(tagged!==current) throw Error('Release tag does not reference the build source commit: '+tag);
  const release=JSON.parse(run('gh',['release','view',tag,'--repo',REPO,'--json','tagName,url'],true));
  if(release.tagName!==tag) throw Error('Release tag mismatch; aborting upload');
  console.log('Uploading verified, notarized DMG and checksums to '+release.url);
  run('gh',['release','upload',tag,dmg,checksums,reportFile,'--repo',REPO]);
  console.log('Mac assets uploaded. Review the existing release notes and Mac acceptance results before announcing it.');
}
main().catch(error=>{console.error('MAC_PUBLISH_FAILED:',error.message);process.exitCode=1;});
