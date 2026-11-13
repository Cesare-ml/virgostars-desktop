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

// Avoid stealing shortcuts from composite accessibility widgets as well as
// native inputs. In particular, date/time editors often use role=spinbutton
// on a div and custom city pickers use role=combobox/listbox.
const INTERACTIVE_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'spinbutton', 'slider',
  'listbox', 'grid', 'gridcell', 'menu', 'menuitem', 'dialog', 'alertdialog'
]);
const INTERACTIVE_ANCESTOR_SELECTOR = [
  '[contenteditable]', '[aria-modal="true"]', 'dialog',
  ...[...INTERACTIVE_ROLES].map(role => `[role="${role}"]`)
].join(', ');

function isEditing(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const element = node as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'DIALOG'].includes(tag)) return true;
  if (typeof element.getAttribute === 'function') {
    const role = element.getAttribute('role');
    if (typeof role === 'string' && role.toLowerCase().split(/\s+/).some(value => INTERACTIVE_ROLES.has(value))) return true;
    if (element.getAttribute('aria-modal')?.toLowerCase() === 'true') return true;
  }
  return typeof element.closest === 'function' && Boolean(element.closest(INTERACTIVE_ANCESTOR_SELECTOR));
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
