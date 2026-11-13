/**
 * Fail closed on CSS resource-loading functions in the offline global bundle.
 * The prototype's global stylesheet requires no URL-based assets; permitting
 * any requires a future explicit asset/rights + local-path verifier.
 * This scans CSS lexical tokens, not arbitrary strings or inert comments.
 */
const FORBIDDEN = new Set(['url', 'image-set', '-webkit-image-set', 'image']);
const fail = message => { throw new Error('DESKTOP CSS RESOURCES: ' + message); };
const identChar = ch => ch !== undefined && /[A-Za-z0-9_-]/.test(ch);
const hexChar = ch => ch !== undefined && /[0-9A-Fa-f]/.test(ch);

function skipComment(css, start) {
  const end = css.indexOf('*/', start + 2);
  if (end < 0) fail('Unterminated CSS comment');
  return end + 2;
}
function skipString(css, start) {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      if (i + 1 >= css.length) fail('Unterminated CSS string');
      i += css[i + 1] === '\r' && css[i + 2] === '\n' ? 3 : 2;
    } else if (css[i] === quote) {
      return i + 1;
    } else if (css[i] === '\n' || css[i] === '\r') {
      fail('Unterminated CSS string');
    } else {
      i++;
    }
  }
  fail('Unterminated CSS string');
}
function readIdent(css, start) {
  let value = '';
  let i = start;
  while (i < css.length) {
    const ch = css[i];
    if (identChar(ch)) {
      value += ch;
      i++;
    } else if (ch === '\\') {
      i++;
      if (i >= css.length || css[i] === '\r' || css[i] === '\n') fail('Invalid CSS identifier escape');
      if (hexChar(css[i])) {
        let hex = '';
        while (hex.length < 6 && hexChar(css[i])) hex += css[i++];
        const code = Number.parseInt(hex, 16);
        value += code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code) : '\ufffd';
        if (/\s/.test(css[i] ?? '')) i++;
      } else {
        value += css[i++];
      }
    } else {
      break;
    }
  }
  return {value: value.toLowerCase(), end: i};
}
function skipTrivia(css, start) {
  let i = start;
  while (i < css.length) {
    if (/\s/.test(css[i])) i++;
    else if (css.startsWith('/*', i)) i = skipComment(css, i);
    else break;
  }
  return i;
}

/** Global stylesheet must never cause secondary resource fetches (offline-first). */
export function assertNoCssResourceFunctions(css) {
  if (typeof css !== 'string') fail('Invalid CSS stylesheet');
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      i = skipComment(css, i);
    } else if (css[i] === '"' || css[i] === "'") {
      i = skipString(css, i);
    } else if (identChar(css[i]) || css[i] === '\\') {
      const name = readIdent(css, i);
      if (name.end === i) fail('Invalid CSS token');
      if (FORBIDDEN.has(name.value) && css[skipTrivia(css, name.end)] === '(') {
        fail('CSS resource-loading functions are not allowed in the offline global stylesheet');
      }
      i = name.end;
    } else {
      i++;
    }
  }
  return true;
}
