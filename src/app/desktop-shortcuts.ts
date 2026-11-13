/** Local-only, opt-in keyboard actions for the synthetic desktop workspace.
 * No renderer lifecycle, user data, network or native IPC is owned here.
 */
import type { ChartMode } from './workspace-state';

export type DesktopShortcut =
  | { readonly kind: 'mode'; readonly mode: ChartMode }
  | { readonly kind: 'fit' };

export interface DesktopShortcutEvent {
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: EventTarget | null;
  readonly composedPath?: () => EventTarget[];
}

function isEditing(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const element = node as {
    tagName?: unknown;
    isContentEditable?: unknown;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return typeof element.closest === 'function' && Boolean(element.closest('[contenteditable]'));
}

/** Alt+Shift+1..4 changes the fictional view; Alt+Shift+0 fits the chart.
 * Fail closed for modified/repeated keys, editable fields and unknown event paths.
 */
export function parseDesktopShortcut(event: DesktopShortcutEvent): DesktopShortcut | null {
  if (!event || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.isComposing || event.defaultPrevented) return null;
  try {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (!Array.isArray(path)) return null;
    if ([event.target, ...path].some(isEditing)) return null;
  } catch {
    return null;
  }
  switch (event.code) {
    case 'Digit1': return { kind: 'mode', mode: 'natal' };
    case 'Digit2': return { kind: 'mode', mode: 'transits' };
    case 'Digit3': return { kind: 'mode', mode: 'synastry' };
    case 'Digit4': return { kind: 'mode', mode: 'latitude' };
    case 'Digit0': return { kind: 'fit' };
    default: return null;
  }
}
