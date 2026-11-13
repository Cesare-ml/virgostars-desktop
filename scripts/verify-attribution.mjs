/** Static source gate for CPAL Exhibit B and the Desktop session footer.
 * This is not a substitute for a visual WebView2 acceptance test.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const EXPECTED_PHRASE = 'Powered by VirgoStars';
const EXPECTED_URL = 'https://www.virgostars.it/';
const COPYRIGHT_NOTICE = 'Copyright (c) 2026 Cesare-ml (VirgoStars project)';

function requireText(source, value, where) {
  if (!source.includes(value)) throw new Error('Attribution gate: missing ' + where);
}

/** Verify only the literal launch/session notice, not comments or metadata. */
export function verifyAttribution({license, notice, template, styles}) {
  for (const [key, value] of Object.entries({license, notice, template, styles})) {
    if (typeof value !== 'string') throw new TypeError('Attribution gate: invalid ' + key);
  }
  const exhibitMatch = license.match(/\bEXHIBIT B\. Attribution Information\b([\s\S]*)/);
  if (!exhibitMatch) throw new Error('Attribution gate: missing CPAL Exhibit B');
  const exhibit = exhibitMatch[1];
  requireText(exhibit, 'Attribution Copyright Notice: ' + COPYRIGHT_NOTICE, 'Exhibit B copyright');
  requireText(exhibit, 'Attribution Phrase (not exceeding 10 words): ' + EXPECTED_PHRASE, 'Exhibit B phrase');
  requireText(exhibit, 'Attribution URL: ' + EXPECTED_URL, 'Exhibit B URL');
  for (const [part, value] of [['copyright', COPYRIGHT_NOTICE], ['phrase', EXPECTED_PHRASE], ['URL', EXPECTED_URL]]) {
    requireText(notice, value, 'NOTICE ' + part);
  }

  // Strip HTML comments before locating the actual footer; marketing strings
  // elsewhere in the template cannot satisfy this application notice.
  const markup = template.replace(/<!--[\s\S]*?-->/g, '');
  const footers = [...markup.matchAll(/<footer\b([^>]*)>([\s\S]*?)<\/footer\s*>/gi)];
  if (footers.length !== 1) throw new Error('Attribution gate: expected one GUI footer');
  const [, attributes, inner] = footers[0];
  const hidden = /\bhidden\b|\baria-hidden\s*=\s*["']?true\b|\bstyle\s*=/;
  if (hidden.test(attributes)) throw new Error('Attribution gate: footer may be hidden');
  const label = inner.match(/<span\b([^>]*)\bclass\s*=\s*["']copyright-attribution["']([^>]*)>([\s\S]*?)<\/span\s*>/i);
  if (!label) throw new Error('Attribution gate: missing dedicated GUI credit');
  if (hidden.test(label[1] + label[2])) throw new Error('Attribution gate: GUI credit may be hidden');
  const visibleCredit = label[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  requireText(visibleCredit, '© 2026 Cesare-ml (VirgoStars project)', 'GUI copyright');
  requireText(visibleCredit, EXPECTED_PHRASE, 'GUI phrase');
  requireText(visibleCredit, EXPECTED_URL, 'GUI URL');

  // Catch explicit hiding, including functional selectors like :is(footer)
  // or :where(.copyright-attribution), across breakpoint rules. Computed
  // layout and clipped text still need real Windows/WebView2 visual QA.
  const css = styles.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|[\s,>+~(])(?:footer\b|\.copyright-attribution\b)/i.test(rule[1])) continue;
    if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?)(?:\s*!important)?\s*(?:;|$)/i.test(rule[2])) {
      throw new Error('Attribution gate: GUI footer/credit hidden by CSS');
    }
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const read = path => readFileSync(resolve(root, path), 'utf8');
  verifyAttribution({
    license: read('LICENSE'),
    notice: read('NOTICE'),
    template: read('src/app/desktop-app.component.html'),
    styles: read('src/app/desktop-app.component.css'),
  });
  process.stdout.write('CPAL Exhibit B and desktop GUI attribution source gate passed.\n');
}
