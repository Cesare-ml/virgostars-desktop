/**
 * Reject CSS @import rules in Angular's self-contained offline stylesheet.
 * Skip inert strings/comments and CSS url() data; never execute CSS or fetch URLs.
 */
const fail = message => { throw new Error('DESKTOP CSS IMPORTS: ' + message); };
const asciiName = ch => ch !== undefined && /[a-zA-Z0-9_-]/.test(ch);
const hexDigit = ch => ch !== undefined && /[0-9a-f]/i.test(ch);

function cssIdent(css, start) {
  let text = '';
  let i = start;
  while (i < css.length) {
    const ch = css[i];
    if (asciiName(ch)) {
      text += ch;
      i++;
      continue;
    }
    if (ch !== '\\') break;
    i++;
    if (i >= css.length) fail('Unterminated CSS escape');
    if (hexDigit(css[i])) {
      let hex = '';
      while (hex.length < 6 && hexDigit(css[i])) hex += css[i++];
      const cp = Number.parseInt(hex, 16);
      text += cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
        ? String.fromCodePoint(cp) : '\ufffd';
      // A single whitespace character terminates a CSS hex escape.
      if (/\s/.test(css[i] ?? '')) i++;
      continue;
    }
    if (css[i] === '\n' || css[i] === '\r') fail('Invalid CSS escape');
    text += css[i++];
  }
  return { text, end: i };
}

function skipQuoted(css, start) {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
    } else if (css[i] === quote) {
      return i + 1;
    } else {
      i++;
    }
  }
  fail('Unterminated CSS string');
}

function skipUrl(css, start) {
  let i = start + 4;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      i = skipQuoted(css, i);
    } else if (ch === '\\') {
      i += 2;
    } else if (ch === ')') {
      return i + 1;
    } else {
      i++;
    }
  }
  fail('Unterminated CSS url()');
}

/**
 * Angular should inline its CSS imports during compilation. Reject any
 * remaining real @import rather than packaging a potentially missing stylesheet.
 */
export function assertNoCssImports(css) {
  if (typeof css !== 'string') fail('Invalid CSS stylesheet');
  let i = 0;
  while (i < css.length) {
    if (css.startsWith('/*', i)) {
      const close = css.indexOf('*/', i + 2);
      if (close < 0) fail('Unterminated CSS comment');
      i = close + 2;
    } else if (css[i] === '"' || css[i] === "'") {
      i = skipQuoted(css, i);
    } else if (css.slice(i, i + 4).toLowerCase() === 'url(' &&
      (i === 0 || !asciiName(css[i - 1]))) {
      i = skipUrl(css, i);
    } else if (css[i] === '@') {
      const name = cssIdent(css, i + 1);
      if (name.text.toLowerCase() === 'import') {
        fail('CSS @import must be inlined before offline packaging');
      }
      i = Math.max(name.end, i + 1);
    } else {
      i++;
    }
  }
  return true;
}
