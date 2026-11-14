/**
 * Lightweight query preflight shared by Angular and direct Node ESM tests.
 * Match Rust's bounded FTS term policy: separator punctuation and underscores,
 * ignore single-character fragments, and reject a sixth meaningful prefix.
 * Rust remains authoritative for Unicode edge cases and direct IPC callers.
 *
 * @param {string} query
 * @returns {'query_too_short' | 'query_too_long' | null}
 */
export function offlinePlaceQueryProblem(query) {
  // Bound work before applying the regex: callers outside the picker may
  // supply very large pasted strings. Do not materialize [...query].
  if (typeof query !== 'string') return 'query_too_short';
  let scalarCount = 0;
  for (const char of query) {
    if (++scalarCount > 80) return 'query_too_long';
  }
  // FTS5 has a costly one-letter prefix path. Names such as L'Aquila and
  // Rio_de_Janeiro must still work, without emitting single-letter prefixes.
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  let meaningful = 0;
  for (const term of terms) {
    if ([...term].length < 2) continue;
    if (++meaningful > 5) return 'query_too_long';
  }
  return meaningful === 0 ? 'query_too_short' : null;
}
