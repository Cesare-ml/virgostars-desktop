import type {InspectorTab} from './workspace-state';

/** WAI-ARIA tablist key navigation for the small, instant-switching inspector. */
const INSPECTOR_TABS: readonly InspectorTab[] = ['planets', 'houses', 'settings'];

/** Only navigation keys select a tab; callers own focus and preventDefault. */
export function nextInspectorTab(current: InspectorTab, key: string): InspectorTab | null {
  const index = INSPECTOR_TABS.indexOf(current);
  if (index < 0) return null;
  switch (key) {
    case 'ArrowRight': return INSPECTOR_TABS[(index + 1) % INSPECTOR_TABS.length];
    case 'ArrowLeft': return INSPECTOR_TABS[(index + INSPECTOR_TABS.length - 1) % INSPECTOR_TABS.length];
    case 'Home': return INSPECTOR_TABS[0];
    case 'End': return INSPECTOR_TABS[INSPECTOR_TABS.length - 1];
    default: return null;
  }
}
