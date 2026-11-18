/** Offline CSS url() verifier for the compiled global Tauri stylesheet. */
import { lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';

const fail = reason => { throw new Error('DESKTOP CSS URLS: ' + reason); };
const isHex = ch => ch !== undefined && /[0-9a-f]/i.test(ch);
const isIdent = ch => ch !== undefined && /[a-zA-Z0-9_-]/.test(ch);

function escapeAt(css, start) {
  let i = start + 1;
  if (i >= css.length || css[i] === '\n' || css[i] === '\r' || css[i] === '\f') {
    fail('Invalid CSS escape');
  }
  if (isHex(css[i])) {
    let digits = '';
    while (digits.length < 6 && isHex(css[i])) digits += css[i++];
    const cp = Number.parseInt(digits, 16);
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      fail('Invalid CSS escape code point');
    }
    if (/\s/.test(css[i] ?? '')) i++;
    return { value: String.fromCodePoint(cp), end: i };
  }
  return { value: css[i], end: i + 1 };
}

function quoted(css, start) {
  const quote = css[start];
  let value = '';
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === quote) return { value, end: i + 1 };
    if (css[i] === '\\') {
      const esc = escapeAt(css, i);
      value += esc.value;
      i = esc.end;
    } else {
      if (css[i] === '\n' || css[i] === '\r' || css[i] === '\f') fail('Unterminated CSS string');
      value += css[i++];
    }
  }
  fail('Unterminated CSS string');
}

function skipComment(css, start) {
  const end = css.indexOf('*/', start + 2);
  if (end === -1) fail('Unterminated CSS comment');
  return end + 2;
}

function urlValue(css, start) {
  let i = start;
  while (/\s/.test(css[i] ?? '') && i < css.length) i++;
  if (css[i] === '"' || css[i] === "'") {
    const parsed = quoted(css, i);
    i = parsed.end;
    while (/\s/.test(css[i] ?? '') && i < css.length) i++;
    if (css[i] !== ')') fail('Malformed quoted CSS url()');
    return { value: parsed.value, end: i + 1 };
  }
  let value = '';
  while (i < css.length && css[i] !== ')') {
    if (css[i] === '\\') {
      const esc = escapeAt(css, i);
      value += esc.value;
      i = esc.end;
    } else {
      if (css[i] === '"' || css[i] === "'" || css[i] === '(' || css[i] === '\n' || css[i] === '\r') {
        fail('Malformed unquoted CSS url()');
      }
      value += css[i++];
    }
  }
  if (i === css.length) fail('Unterminated CSS url()');
  const trimmed = value.trim();
  if (/\s/.test(trimmed)) fail('Whitespace in unquoted CSS url()');
  return { value: trimmed, end: i + 1 };
}

function verifyResource(value, bundleDir) {
  if (value.length === 0 || value.length > 65536) fail('Empty or oversized CSS url()');
  if (value.startsWith('data:')) {
    const match = /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[1].length > 32768) fail('Unapproved CSS data URL');
    const bytes = Buffer.from(match[1], 'base64');
    if (!bytes.length || bytes.toString('base64') !== match[1]) fail('Noncanonical CSS data URL');
    return;
  }
  // Angular may emit hashed fonts in media/ and approved images in assets/img/.
  // Resolve each segment without symlinks, traversal, query or fragment aliases.
  const clean = value.replace(/^\.\//, '');
  if (!/^(?:media\/[A-Za-z0-9._-]+|assets\/img\/[A-Za-z0-9._/-]+)$/.test(clean)) {
    fail('Nonlocal or unapproved CSS url() resource');
  }
  const parts = clean.split('/');
  if (parts.some(part => part === '.' || part === '..' || !part)) fail('Unsafe CSS url() path');
  let path = resolve(bundleDir);
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      fail('Missing or unsafe CSS url() resource');
    }
  }
}

/** Checks active url(...) functions, not inert comments or CSS content strings. */
export function assertOfflineCssUrls(css, bundleDir) {
  if (typeof css !== 'string' || typeof bundleDir !== 'string' || css.length > 5_000_000) {
    fail('Invalid CSS URL audit input');
  }
  let count = 0;
  for (let i = 0; i < css.length;) {
    if (css.startsWith('/*', i)) {
      i = skipComment(css, i);
    } else if (css[i] === '"' || css[i] === "'") {
      i = quoted(css, i).end;
    } else if (isIdent(css[i]) || css[i] === '\\') {
      let ident = '';
      while (i < css.length && (isIdent(css[i]) || css[i] === '\\')) {
        if (css[i] === '\\') {
          const esc = escapeAt(css, i);
          ident += esc.value;
          i = esc.end;
        } else {
          ident += css[i++];
        }
      }
      if (ident.toLowerCase() === 'url') {
        // CSS comments can separate an identifier from its function delimiter.
        // Fail closed rather than overlooking a resource hidden by comments.
        let opening = i;
        while (css.startsWith('/*', opening)) opening = skipComment(css, opening);
        if (css[opening] === '(') {
          const parsed = urlValue(css, opening + 1);
          verifyResource(parsed.value, bundleDir);
          count++;
          i = parsed.end;
        }
      }
    } else {
      i++;
    }
  }
  return count;
}
