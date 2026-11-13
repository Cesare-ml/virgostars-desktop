/** Ensure the offline Angular document really mounts the Desktop-owned root. */
const invalid = () => { throw new Error('Angular bundle is not the desktop-owned app'); };

/**
 * Validate the generated Angular index.html, not arbitrary HTML. The desktop
 * source uses an empty <vs-desktop-app></vs-desktop-app> as the first body node.
 */
export function verifyDesktopAppRoot(html) {
  if (typeof html !== 'string') invalid();
  // HTML comments do not create DOM elements. Preserve positions while masking.
  const markup = html.replace(/<!--[\s\S]*?-->/g, comment => ' '.repeat(comment.length));
  if (markup.includes('<!--') || markup.includes('-->')) invalid();

  const bodies = [...markup.matchAll(/<body(?:\s[^<>]*)?>/gi)];
  const ends = [...markup.matchAll(/<\/body\s*>/gi)];
  if (bodies.length !== 1 || ends.length !== 1) invalid();
  const begin = bodies[0].index + bodies[0][0].length;
  const finish = ends[0].index;
  if (begin >= finish) invalid();

  // Fail closed on duplicate, nested, nonempty or inert roots. Angular owns
  // this exact empty host element; scripts belong after it in the body.
  const body = markup.slice(begin, finish);
  if (!/^\s*<vs-desktop-app\s*>\s*<\/vs-desktop-app\s*>/i.test(body)) invalid();
  if ((markup.match(/<vs-desktop-app(?=[\s/>])/gi) ?? []).length !== 1) invalid();
  // A second closing tag can follow a valid root and evade the prefix test.
  // Comments have already been masked, so only live closing tags count.
  if ((markup.match(/<\/vs-desktop-app\s*>/gi) ?? []).length !== 1) invalid();
  return true;
}
