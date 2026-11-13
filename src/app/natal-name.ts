/** In-memory name rules for the unsaved natal draft (Unicode code points, not UTF-16 units). */
export const NATAL_NAME_INPUT_LIMIT = 160;
export const NATAL_NAME_VALID_LIMIT = 120;

/** Never cut a UTF-16 surrogate pair when bounding untrusted editor input. */
export function truncateNatalName(input: string): string {
  let result = '';
  let count = 0;
  for (const scalar of input) {
    if (count >= NATAL_NAME_INPUT_LIMIT) break;
    result += scalar;
    count++;
  }
  return result;
}

/** Reject control characters and unpaired surrogates; retain legitimate Unicode names. */
export function isValidNatalName(input: string): boolean {
  const name = input.trim();
  if (!name) return false;
  let count = 0;
  for (const scalar of name) {
    if (++count > NATAL_NAME_VALID_LIMIT) return false;
    const cp = scalar.codePointAt(0)!;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) ||
        (cp >= 0xd800 && cp <= 0xdfff) || cp === 0x2028 || cp === 0x2029) return false;
  }
  return true;
}
