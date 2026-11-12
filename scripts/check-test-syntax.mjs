/**
 * Dependency-free syntax preflight for every Node .test.mjs file in this repo.
 * Avoids a single malformed test preventing unrelated tests from being reported.
 * No GitHub Actions, network or user files are accessed.
 */
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const directory=fileURLToPath(new URL('../tests/',import.meta.url));
const names=readdirSync(directory,{withFileTypes:true})
  .filter(item=>item.isFile() && item.name.endsWith('.test.mjs'))
  .map(item=>item.name).sort();

if(names.length===0){
  process.stderr.write('No Node .test.mjs suites found; refusing false pass.\n');
  process.exitCode=1;
}else{
  let failed=0;
  for(const name of names){
    const file=join(directory,name);
    const result=spawnSync(process.execPath,['--check',file],{
      encoding:'utf8',timeout:15000,maxBuffer:256*1024,
    });
    if(result.error || result.status!==0){
      failed++;
      process.stderr.write('[test syntax] FAIL '+name+'\n');
      // Never emit the developer's absolute local workspace path.
      const stderr=String(result.stderr||result.error?.message||'syntax check failed');
      process.stderr.write(stderr.replaceAll(file,name).slice(0,3000)+'\n');
    }
  }
  if(failed){
    process.stderr.write('[test syntax] '+failed+'/'+names.length+' suites failed.\n');
    process.exitCode=1;
  }else{
    process.stdout.write('[test syntax] '+names.length+' suites parse successfully.\n');
  }
}
