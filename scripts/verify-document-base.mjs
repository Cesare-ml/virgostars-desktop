/** Ensure relative desktop assets resolve against the embedded Tauri origin. */
const invalid = () => { throw new Error('DESKTOP BASE HREF: Expected one root-relative base before bundled assets'); };

/**
 * Validate Angular-generated HTML, not arbitrary internet HTML. Keep comments
 * from masquerading as real tags and require the base to follow metadata only.
 */
export function verifyDesktopBaseHref(html) {
  if (typeof html !== 'string') invalid();
  // Preserve positions while removing inert comments. A truncated comment is
  // not a valid build artifact and must not make a fake base appear active.
  const markup = html.replace(/<!--[\s\S]*?-->/g, match => ' '.repeat(match.length));
  if (markup.includes('<!--') || markup.includes('-->')) invalid();

  // The reviewed Angular document needs only charset and viewport metadata.
  // Disallow http-equiv directives (especially refresh): they can silently
  // navigate a packaged offline WebView or change document-level behavior.
  // Account for '>' inside quoted attribute values when scanning tags.
  const metaTags = markup.match(/<meta(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  if (metaTags.some(tag => /\bhttp-equiv\s*=/i.test(tag))) invalid();

  const bases = markup.match(/<base(?=[\s/>])[^>]*>/gi) ?? [];
  if (bases.length !== 1 || !/^<base\s+href\s*=\s*(["'])\/\1\s*\/?>$/i.test(bases[0])) invalid();

  const headOpen = /<head(?:\s[^>]*)?>/i.exec(markup);
  const headClose = /<\/head\s*>/i.exec(markup);
  const baseIndex = markup.indexOf(bases[0]);
  if (!headOpen || !headClose || baseIndex < headOpen.index + headOpen[0].length ||
      baseIndex >= headClose.index || headClose.index <= headOpen.index) invalid();

  // Angular's build may emit charset, viewport and title before <base>.
  // Other elements (notably <template>, <noscript>, <script> or <link>) can
  // hide the tag or consume relative resources before the base takes effect.
  const prefix = markup.slice(headOpen.index + headOpen[0].length, baseIndex);
  const metadataOnly = prefix
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<title(?:\s[^>]*)?>[\s\S]*?<\/title\s*>/gi, '');
  if (metadataOnly.trim() !== '') invalid();
  return true;
}
