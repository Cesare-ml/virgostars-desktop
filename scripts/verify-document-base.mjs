/** Ensure relative desktop assets resolve against the embedded Tauri origin. */
const invalid = () => { throw new Error('DESKTOP BASE HREF: Expected one root-relative base before bundled assets'); };

/**
 * Validate Angular build HTML, not arbitrary internet HTML. A deliberately
 * narrow allowlist rejects additional attributes, duplicates and remote bases.
 */
export function verifyDesktopBaseHref(html) {
  if (typeof html !== 'string') invalid();
  const bases = html.match(/<base(?=[\s/>])[^>]*>/gi) ?? [];
  if (bases.length !== 1 || !/^<base\s+href\s*=\s*(["'])\/\1\s*\/?>$/i.test(bases[0])) invalid();

  const headOpen = /<head(?:\s[^>]*)?>/i.exec(html);
  const headClose = /<\/head\s*>/i.exec(html);
  const baseIndex = html.indexOf(bases[0]);
  if (!headOpen || !headClose || baseIndex < headOpen.index + headOpen[0].length ||
      baseIndex >= headClose.index || headClose.index <= headOpen.index) invalid();

  // HTML applies the base in parsing order. A preceding asset reference can
  // resolve against the wrong location even if the base is valid later.
  const prefix = html.slice(headOpen.index + headOpen[0].length, baseIndex);
  if (/<(?:link|script)(?=[\s/>])/i.test(prefix)) invalid();
  return true;
}
