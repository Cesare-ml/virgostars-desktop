/**
 * Lightweight query preflight shared by Angular and direct Node ESM tests.
 * Rust remains authoritative: its Unicode char::is_alphanumeric() is not
 * guaranteed to match JavaScript Unicode property escapes exactly.
 *
 * @param {string} query
 * @returns {'query_too_short' | 'query_too_long' | null}
 */
export function offlinePlaceQueryProblem(query) {
  const characters = [...query];
  if (characters.length > 80) return 'query_too_long';
  const alphanumeric = characters.filter(char => /[\p{L}\p{N}]/u.test(char)).length;
  if (alphanumeric < 2) return 'query_too_short';
  const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.length > 5 ? 'query_too_long' : null;
}
