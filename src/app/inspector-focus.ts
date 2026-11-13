/** Keep keyboard focus on a surviving control when the inspector is removed. */
export interface InspectorFocusArea {
  contains(element: Node | null): boolean;
}

export interface InspectorFocusTarget {
  focus(options?: FocusOptions): void;
}

/**
 * Only move focus if it belongs to the panel being closed. The DOM nodes
 * must be inspected before Angular removes the *ngIf view. Focus failures
 * are best-effort and must never block the close operation.
 */
export function preserveInspectorFocusOnClose(
  panel: InspectorFocusArea | null | undefined,
  activeElement: Node | null,
  toggle: InspectorFocusTarget | null | undefined,
): void {
  try {
    if (panel?.contains(activeElement)) toggle?.focus({preventScroll: true});
  } catch {
    // WebView focus availability must not break chart/inspector interaction.
  }
}
