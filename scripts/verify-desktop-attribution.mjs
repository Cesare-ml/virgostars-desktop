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
  // Comments are inert. Inert template/script/noscript nodes also cannot satisfy
  // the launch notice: require the footer to be a direct child of the live chart panel.
  const source = template.replace(/<!--[\s\S]*?-->/g, '');
  const footers = [...source.matchAll(/<footer>([\s\S]*?)<\/footer>/g)];
  requireNotice(footers.length === 1, 'expected exactly one static footer');
  const stack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img',
    'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const prefix = source.slice(0, footers[0].index);
  // Angular control-flow blocks (@if/@defer/etc.) do not create an HTML
  // ancestor tag, so the HTML stack alone could approve a non-rendered footer.
  // Be conservative: any control-flow syntax preceding this launch notice
  // needs an explicit gate review; interpolations and comments are inert here.
  const outsideInterpolations = prefix.replace(/{{[\s\S]*?}}/g, '');
  requireNotice(!/@(?:if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/.test(outsideInterpolations),
    'Angular control-flow before footer requires review');
  for (const match of prefix.matchAll(/<\/?([a-z][a-z0-9-]*)\b([^<>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    if (match[0].startsWith('</')) {
      requireNotice(stack.length > 0 && stack[stack.length - 1].tag === tag,
        'malformed Desktop HTML before footer');
      stack.pop();
    } else if (!match[0].endsWith('/>') && !voidTags.has(tag)) {
      stack.push({tag, attrs: match[2]});
    }
  }
  const parent = stack[stack.length - 1];
  requireNotice(parent?.tag === 'main' && parent.attrs === ' class="chart-panel"',
    'footer is not a direct child of the static Desktop chart panel');
  requireNotice(stack.every(node =>
    !/(?:^|\s)(?:hidden|inert|\*ngIf|\[hidden\]|\[attr\.hidden\]|style|\[style(?:\.[^\]]+)?\])(?=\s|=|$)/i.test(node.attrs) &&
    !/\baria-hidden\s*=\s*["']true["']/i.test(node.attrs)),
    'footer has a hidden or conditional ancestor');

  const attributions = [...footers[0][1].matchAll(/<span class="copyright-attribution">([^<]*)<\/span>/g)];
  requireNotice(attributions.length === 1, 'expected one static attribution span in the footer');
  const expected = `· © 2026 ${DEVELOPER} · ${PHRASE} · ${URL}`;
  requireNotice(attributions[0][1].replace(/\s+/g, ' ').trim() === expected,
    'static footer attribution text mismatch');
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
