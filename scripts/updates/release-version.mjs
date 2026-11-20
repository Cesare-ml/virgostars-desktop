import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyDesktopVersions} from '../verify-desktop-version.mjs';

export function nextPatch(version) {
  const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!m || !Number.isSafeInteger(Number(m[3])) || Number(m[3]) >= 999999) throw Error('Versione stabile non valida.');
  return `${m[1]}.${m[2]}.${Number(m[3])+1}`;
}

export function versionChanges(root, current, next) {
  if (next !== nextPatch(current)) throw Error('La versione deve essere il prossimo incremento patch.');
  const files = ['package.json','package-lock.json','src-tauri/Cargo.toml','src-tauri/Cargo.lock',
    'src-tauri/tauri.conf.json','scripts/verify-tauri-security-config.mjs'];
  const values = new Map(files.map(f=>[f,readFileSync(join(root,f),'utf8')]));
  const replace = (file, old, newValue, count=1) => {
    const source=values.get(file), parts=source.split(old);
    if (parts.length-1 !== count) throw Error(`Identità release inattesa: ${file}`);
    values.set(file,parts.join(newValue));
  };
  replace('package.json',`"version": "${current}"`,`"version": "${next}"`);
  replace('package-lock.json',`"version": "${current}"`,`"version": "${next}"`,2);
  replace('src-tauri/Cargo.toml',`version = "${current}"`,`version = "${next}"`);
  replace('src-tauri/Cargo.lock',`name = "virgostars-desktop-spike"\nversion = "${current}"`,
    `name = "virgostars-desktop-spike"\nversion = "${next}"`);
  replace('src-tauri/tauri.conf.json',`"version": "${current}"`,`"version": "${next}"`);
  replace('src-tauri/tauri.conf.json',`VirgoStarsDesktop/${current} `,`VirgoStarsDesktop/${next} `);
  replace('scripts/verify-tauri-security-config.mjs',`VirgoStarsDesktop/${current} `,`VirgoStarsDesktop/${next} `);
  return values;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
    const current=verifyDesktopVersions({root}).version, next=nextPatch(current);
    if (process.argv[2] === '--next' && process.argv.length === 3) console.log(next);
    else if (process.argv[2] === '--bump' && process.argv.length === 4 && process.argv[3] === next) {
      const changes=versionChanges(root,current,next);
      for (const [file,contents] of changes) writeFileSync(join(root,file),contents,'utf8');
      verifyDesktopVersions({root});
      console.log(`Versione preparata: ${next}`);
    } else throw Error('Uso: release-version.mjs --next oppure --bump VERSIONE');
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
