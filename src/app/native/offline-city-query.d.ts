/** UI-side preflight for the native Rust offline-city FTS query. */
export declare function offlinePlaceQueryProblem(
  query: string,
): 'query_too_short' | 'query_too_long' | null;
