/**
 * Keyboard actions for the offline city combobox.
 * Keep DOM focus on the search input while Arrow keys navigate the listbox;
 * a Tab exits the combobox rather than entering each suggestion.
 */
export type CityPickerKeyAction = 'none' | 'next' | 'previous' | 'choose' | 'dismiss';

export function cityPickerKeyAction(
  key: string,
  resultCount: number,
  activeIndex: number,
): CityPickerKeyAction {
  // All values originate from local state in production, but the pure adapter
  // must never turn corrupt counts into a selectable option.
  if (!Number.isSafeInteger(resultCount) || resultCount < 0 ||
      !Number.isSafeInteger(activeIndex) || activeIndex < -1 ||
      activeIndex >= resultCount && activeIndex !== -1) return 'none';

  // Escape also cancels a pending lookup when suggestions have not arrived.
  if (key === 'Escape') return 'dismiss';
  // Do not cancel the browser's Tab key: it must move focus normally.
  if (key === 'Tab') return resultCount > 0 ? 'dismiss' : 'none';
  if (resultCount === 0) return 'none';

  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'previous';
  if (key === 'Enter' && activeIndex >= 0) return 'choose';
  return 'none';
}
