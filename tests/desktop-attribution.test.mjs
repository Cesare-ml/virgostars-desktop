import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyDesktopAttribution} from '../scripts/verify-desktop-attribution.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const fixture = () => ({
  template: read('src/app/desktop-app.component.html'),
  notice: read('NOTICE'),
  license: read('LICENSE'),
});

test('checked-in Desktop footer matches NOTICE and CPAL Exhibit B', () => {
  const {template, notice, license} = fixture();
  assert.deepEqual(verifyDesktopAttribution(template, notice, license), {verified: true});
});

test('rejects removed, incomplete and non-footer attribution', () => {
  const f = fixture();
  const span = '<span class="copyright-attribution">';
  for (const altered of [
    f.template.replace(span, '<span>'),
    f.template.replace('Powered by VirgoStars', 'Powered by an unknown project'),
    f.template.replace('https://www.virgostars.it/', 'https://example.invalid/'),
    f.template.replace('© 2026 Cesare-ml (VirgoStars project)', '© 2026 Other'),
    f.template.replace(span, '</footer>' + span),
  ]) {
    assert.throws(() => verifyDesktopAttribution(altered, f.notice, f.license), /DESKTOP ATTRIBUTION/);
  }
});

test('rejects comment-only and hidden or conditional attribution spans', () => {
  const f = fixture();
  const open = '<span class="copyright-attribution">';
  const commentOnly = f.template.replace(/<span class="copyright-attribution">[^<]*<\/span>/, match => '<!-- ' + match + ' -->');
  assert.throws(() => verifyDesktopAttribution(commentOnly, f.notice, f.license), /DESKTOP ATTRIBUTION/);
  for (const replacement of [
    '<span class="copyright-attribution" hidden>',
    '<span class="copyright-attribution" style="display:none">',
    '<span class="copyright-attribution" *ngIf="false">',
  ]) {
    assert.throws(() => verifyDesktopAttribution(f.template.replace(open, replacement), f.notice, f.license),
      /DESKTOP ATTRIBUTION/);
  }
});

test('rejects duplicate or dynamic footer structure', () => {
  const f = fixture();
  assert.throws(() => verifyDesktopAttribution(f.template + '<footer></footer>', f.notice, f.license),
    /exactly one static footer/);
  assert.throws(() => verifyDesktopAttribution(f.template.replace('<footer>', '<footer [hidden]="true">'), f.notice, f.license),
    /exactly one static footer/);
});

test('rejects NOTICE or Exhibit B drift even if the UI retains the words', () => {
  const f = fixture();
  assert.throws(() => verifyDesktopAttribution(f.template, f.notice.replace('Powered by VirgoStars', 'Powered by Other'), f.license),
    /NOTICE is inconsistent/);
  assert.throws(() => verifyDesktopAttribution(f.template, f.notice, f.license.replace('Attribution URL: https://www.virgostars.it/', 'Attribution URL: https://example.invalid/')),
    /CPAL attribution URL mismatch/);
});

test('inert template, ng-template, noscript, or script cannot supply a launch footer', () => {
  const f = fixture();
  const footer = f.template.match(/<footer>[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer);
  for (const tag of ['template', 'ng-template', 'noscript', 'script']) {
    const moved = f.template.replace(footer, `<${tag}>${footer}</${tag}>`);
    assert.throws(() => verifyDesktopAttribution(moved, f.notice, f.license),
      /footer is not a direct child/);
  }
});

test('rejects credits inside a nested element or under hidden and conditional ancestors', () => {
  const f = fixture();
  const footer = f.template.match(/<footer>[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer);
  assert.throws(() => verifyDesktopAttribution(
    f.template.replace(footer, `<div>${footer}</div>`), f.notice, f.license),
  /footer is not a direct child/);
  const workspace = '<div class="workspace"';
  for (const attr of [' hidden', ' inert', ' *ngIf="false"', ' [hidden]="true"',
                      ' [attr.hidden]="true"', ' style="display:none"',
                      ' [style.display]="\'none\'"', ' aria-hidden="true"']) {
    const altered = f.template.replace(workspace, workspace + attr);
    assert.throws(() => verifyDesktopAttribution(altered, f.notice, f.license),
      /hidden or conditional ancestor/);
  }
});

test('rejects text interpolation or extra text even when original credits remain intact', () => {
  const f = fixture();
  const original = 'Powered by VirgoStars · https://www.virgostars.it/';
  for (const changed of [
    'Powered by VirgoStars · https://www.virgostars.it/ {{someUserText}}',
    'Powered by VirgoStars · https://www.virgostars.it/ · extra',
  ]) {
    assert.throws(() => verifyDesktopAttribution(
      f.template.replace(original, changed), f.notice, f.license),
    /static footer attribution text mismatch/);
  }
});
