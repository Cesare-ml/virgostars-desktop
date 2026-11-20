/** Add the verified archive beside a local --no-bundle release executable. */
import {createHash} from 'node:crypto';
import {constants,copyFileSync,existsSync,lstatSync,mkdirSync,readFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EVENT_ARCHIVE_NAME,EVENT_ARCHIVE_SHA256,prepareEventArchive} from './prepare-local-event-archive.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function stageLocalEventResource(root=ROOT,targetRoot=process.env.CARGO_TARGET_DIR
  ? resolve(root,'src-tauri',process.env.CARGO_TARGET_DIR) : join(root,'src-tauri','target')) {
  await prepareEventArchive(root);
  const executable=join(targetRoot,'release',process.platform==='win32'?'virgostars-desktop-spike.exe':'virgostars-desktop-spike');
  if (!existsSync(executable) || !lstatSync(executable).isFile()) throw new Error('Local release executable is missing.');
  const directory=join(targetRoot,'release','ephemeris','events');
  mkdirSync(directory,{recursive:true});
  const source=join(root,'.local','event-ephemeris',EVENT_ARCHIVE_NAME), destination=join(directory,EVENT_ARCHIVE_NAME);
  if (existsSync(destination)) {
    const stat=lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink() || createHash('sha256').update(readFileSync(destination)).digest('hex')!==EVENT_ARCHIVE_SHA256)
      throw new Error('Existing local event resource differs from the pinned archive; left untouched.');
  } else {
    copyFileSync(source,destination,constants.COPYFILE_EXCL);
    if (createHash('sha256').update(readFileSync(destination)).digest('hex')!==EVENT_ARCHIVE_SHA256)
      throw new Error('Copied local event resource failed verification.');
  }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  stageLocalEventResource().then(()=>console.log('Verified event resource beside the local executable.'))
    .catch(error=>{console.error(`EVENT_RESOURCE_STAGING_FAILED: ${error.message}`);process.exitCode=1;});
}
