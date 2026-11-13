import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAttribution} from '../scripts/verify-attribution.mjs';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

const valid = () => ({
  license: [
    'Common Public Attribution License Version 1.0',
    'EXHIBIT B. Attribution Information',
    'Attribution Copyright Notice: Copyright (c) 2026 Cesare-ml (VirgoStars project)',
    'Attribution Phrase (not exceeding 10 words): Powered by VirgoStars',
    'Attribution URL: https://www.virgostars.it/',
  ].join('\n'),
  notice: 'Copyright (c) 2026 Cesare-ml (VirgoStars project)\nPowered by VirgoStars\nhttps://www.virgostars.it/',
  template: '<div>Powered by VirgoStars</div><footer>{{t(\'footer\')}} <span class="copyright-attribution"> · © 2026 Cesare-ml (VirgoStars project) · Powered by VirgoStars · https://www.virgostars.it/</span></footer>',
  styles: 'footer { color:inherit; }\n@media(max-width:700px) { footer {font-size:11px} }',
});

test('accepts literal CPAL Exhibit B and a visible session footer', () => {
  assert.equal(verifyAttribution(valid()), true);
});
test('rejects a missing or degraded Exhibit B notice', () => {
  const fixture = valid();
  fixture.license = fixture.license.replace('EXHIBIT B.', 'EXHIBIT C.');
  assert.throws(() => verifyAttribution(fixture), /Exhibit B/);
  fixture.license = valid().license.replace('Powered by VirgoStars', 'powered by someone else');
  assert.throws(() => verifyAttribution(fixture), /Exhibit B phrase/);
});
test('rejects a missing copyright or URL in NOTICE', () => {
  const fixture = valid();
  fixture.notice = fixture.notice.replace('https://www.virgostars.it/', '');
  assert.throws(() => verifyAttribution(fixture), /NOTICE URL/);
});
test('rejects a credit present only outside the GUI footer or in a comment', () => {
  const fixture = valid();
  fixture.template = '<div>Powered by VirgoStars https://www.virgostars.it/</div><!--' + valid().template + '-->';
  assert.throws(() => verifyAttribution(fixture), /GUI footer/);
  fixture.template = valid().template.replace('Powered by VirgoStars · https://www.virgostars.it/', 'unbranded preview');
  assert.throws(() => verifyAttribution(fixture), /GUI phrase/);
});
test('rejects a hidden HTML footer or label', () => {
  const fixture = valid();
  fixture.template = fixture.template.replace('<footer>', '<footer hidden>');
  assert.throws(() => verifyAttribution(fixture), /may be hidden/);
  fixture.template = valid().template.replace('class="copyright-attribution"', 'class="copyright-attribution" aria-hidden="true"');
  assert.throws(() => verifyAttribution(fixture), /may be hidden/);
});
test('rejects explicit CSS hiding on desktop or narrow layout', () => {
  const fixture = valid();
  fixture.styles = '@media(max-width:700px) { .copyright-attribution { display:none!important; }}';
  assert.throws(() => verifyAttribution(fixture), /hidden by CSS/);
  fixture.styles = 'footer { opacity: 0; }';
  assert.throws(() => verifyAttribution(fixture), /hidden by CSS/);
});
test('rejects hiding attribution through functional CSS selectors', () => {
  const fixture = valid();
  fixture.styles = '@media(max-width:700px) { :where(footer) { display: none; } }';
  assert.throws(() => verifyAttribution(fixture), /hidden by CSS/);
  fixture.styles = ':is(.copyright-attribution) { visibility: hidden; }';
  assert.throws(() => verifyAttribution(fixture), /hidden by CSS/);
  fixture.styles = ':where(.footer-secondary) { display: none; }';
  assert.equal(verifyAttribution(fixture), true);
});
test('session credits remain non-shrinking and wrappable at narrow widths', () => {
  const css = read('src/app/desktop-app.component.css');
  const footerRule = css.match(/footer\s*\{([^}]*)\}/);
  assert.ok(footerRule, 'missing footer style');
  assert.match(footerRule[1], /(?:^|;)\s*flex-shrink:\s*0\s*;/);
  assert.match(footerRule[1], /(?:^|;)\s*overflow-wrap:\s*anywhere\s*;/);
  assert.match(footerRule[1], /(?:^|;)\s*line-height:\s*1\.45\s*;/);
});

test('rejects non-string values rather than coerce', () => {
  const fixture = valid();
  fixture.notice = null;
  assert.throws(() => verifyAttribution(fixture), /invalid notice/);
});

test('tracked Desktop license, NOTICE and Angular footer pass the source gate', () => {
  assert.equal(verifyAttribution({
    license: read('LICENSE'),
    notice: read('NOTICE'),
    template: read('src/app/desktop-app.component.html'),
    styles: read('src/app/desktop-app.component.css'),
  }), true);
});
test('normal and private offline bundle commands enforce the attribution gate', () => {
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['verify:attribution'], 'node scripts/verify-attribution.mjs');
  assert.match(scripts['verify:bundle'], /npm run verify:attribution$/);
  assert.match(scripts['verify:bundle:private'], /npm run verify:attribution$/);
});
