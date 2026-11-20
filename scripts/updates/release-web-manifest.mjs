import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Update only the reviewed release constant, keeping its validator intact. */
export function updateWebRelease(source, {version, fileName, sha256}) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}\.exe$/.test(fileName) ||
      !/^[a-f0-9]{64}$/.test(sha256) || !fileName.endsWith(`_${version}_x64-setup.exe`)) {
    throw new Error('Dati release non validi.');
  }
  const tag = `v${version}`;
  const origin = 'https://github.com/Cesare-ml/virgostars-desktop/releases';
  const replacement = `export const DESKTOP_RELEASE_MANIFEST: DesktopReleaseManifest = {\n` +
    `  kind: 'published',\n  tag: '${tag}',\n  version: '${version}',\n` +
    `  releaseNotesUrl: '${origin}/tag/${tag}',\n  artifacts: [\n    {\n` +
    `      platform: 'Windows x64',\n      fileName: '${fileName}',\n` +
    `      url: '${origin}/download/${tag}/${fileName}',\n      sha256: '${sha256}'\n` +
    `    }\n  ]\n};`;
  const pattern = /export const DESKTOP_RELEASE_MANIFEST: DesktopReleaseManifest = \{[\s\S]*?\n\};/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Costante release del sito non trovata o ambigua.');
  return source.replace(pattern, replacement).replace(
    /\/\*\* Official public release v\d+\.\d+\.\d+ \(experimental, Windows 10\/11 x64\)\. \*\//,
    '/** Official public release (experimental, Windows 10/11 x64). */');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) throw new Error('Uso: node release-web-manifest.mjs FILE VERSIONE NOME_INSTALLER SHA256');
    const [, , file, version, fileName, sha256] = process.argv;
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, updateWebRelease(original, {version, fileName, sha256}), 'utf8');
    console.log('Manifest del sito aggiornato.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
