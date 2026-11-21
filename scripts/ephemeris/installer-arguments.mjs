import {lstatSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Accept only the updater overlay prepared by the signing wrapper. */
export function installerArguments(args,root=process.cwd(),env=process.env) {
  if (args.length===0) return [];
  const path='.local/updater/tauri-release.conf.json';
  if (args.length!==2 || args[0]!=='--config' || args[1]!==path) throw Error('Unrecognized installer arguments.');
  const file=join(root,path), stat=lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size>8192) throw Error('Invalid updater configuration.');
  const json=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const keys=(value,names)=>value && typeof value==='object' && !Array.isArray(value) &&
    Object.keys(value).length===names.length && names.every(name=>Object.hasOwn(value,name));
  if (!keys(json,['bundle','plugins']) || !keys(json.bundle,['createUpdaterArtifacts']) ||
      json.bundle.createUpdaterArtifacts!==true || !keys(json.plugins,['updater']) ||
      !keys(json.plugins.updater,['pubkey']) || typeof env.VIRGOSTARS_UPDATER_PUBLIC_KEY!=='string' ||
      !env.VIRGOSTARS_UPDATER_PUBLIC_KEY || json.plugins.updater.pubkey!==env.VIRGOSTARS_UPDATER_PUBLIC_KEY)
    throw Error('Updater configuration does not match the reviewed signing key.');
  return ['--config',path];
}
