/**
 * Browser composition events must not trigger speculative offline place searches.
 * Return true only for a committed, changed query or when editing a selected city.
 * The caller may receive an extra input event immediately after compositionend.
 */
export function shouldCommitCityQuery(
  rawValue: string,
  currentQuery: string,
  hasSelectedCity: boolean,
  isComposing: boolean,
): boolean {
  return !isComposing && (rawValue !== currentQuery || hasSelectedCity);
}

/**
 * Enter confirms an IME candidate while composing; it must never select a
 * highlighted city. Legacy Windows WebView2 IME keyCode 229 is also ignored.
 */
export function shouldHandleCityPickerKey(
  composing: boolean,
  eventIsComposing: boolean,
  keyCode: number,
): boolean {
  return !composing && !eventIsComposing && keyCode !== 229;
}
