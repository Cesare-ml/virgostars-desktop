/** Fail closed when the Desktop source loses its mandatory CPAL launch attribution. */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEVELOPER = 'Cesare-ml (VirgoStars project)';
const PHRASE = 'Powered by VirgoStars';
const URL = 'https://www.virgostars.it/';
function requireNotice(condition, detail) {
  if (!condition) throw new Error(`DESKTOP ATTRIBUTION: ${detail}`);
}

/** Source preflight, not proof that an installed WebView2 window displays the footer. */
export function verifyDesktopAttribution(template, notice, license) {
  requireNotice([template, notice, license].every(value => typeof value === 'string'),
    'expected source text');
  const visibleSource = template.replace(/<!--[\s\S]*?-->/g, '');
  const footers = [...visibleSource.matchAll(/<footer>([\s\S]*?)<\/footer>/g)];
  requireNotice(footers.length === 1, 'expected exactly one static footer');
  const attributions = [...footers[0][1].matchAll(/<span class="copyright-attribution">([^<]*)<\/span>/g)];
  requireNotice(attributions.length === 1, 'expected one static attribution span in the footer');
  const text = attributions[0][1];
  for (const required of [`© 2026 ${DEVELOPER}`, PHRASE, URL]) {
    requireNotice(text.includes(required), 'required footer text is missing');
  }
  const exhibit = license.slice(license.lastIndexOf('EXHIBIT B. Attribution Information'));
  requireNotice(exhibit.startsWith('EXHIBIT B. Attribution Information'), 'CPAL Exhibit B missing');
  requireNotice(exhibit.includes(`Attribution Copyright Notice: Copyright (c) 2026 ${DEVELOPER}.`),
    'CPAL developer notice mismatch');
  requireNotice(exhibit.includes(`Attribution Phrase (not exceeding 10 words): ${PHRASE}`),
    'CPAL attribution phrase mismatch');
  requireNotice(exhibit.includes(`Attribution URL: ${URL}`), 'CPAL attribution URL mismatch');
  for (const required of [`Copyright (c) 2026 ${DEVELOPER}.`, PHRASE, URL]) {
    requireNotice(notice.includes(required), 'NOTICE is inconsistent with CPAL attribution');
  }
  return {verified: true};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    requireNotice(process.argv.length === 2, 'unexpected CLI argument');
    verifyDesktopAttribution(
      readFileSync(resolve(ROOT, 'src/app/desktop-app.component.html'), 'utf8'),
      readFileSync(resolve(ROOT, 'NOTICE'), 'utf8'),
      readFileSync(resolve(ROOT, 'LICENSE'), 'utf8'),
    );
    console.log('Verified Desktop source attribution against CPAL Exhibit B and NOTICE.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'DESKTOP ATTRIBUTION: verification failed');
    process.exitCode = 1;
  }
}
