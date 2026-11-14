/**
 * Accessible DOM references must belong to one picker instance.
 * Multiple independent offline pickers may exist in one window; sharing
 * fixed input/listbox/option ids would redirect labels and ARIA references.
 * This counter is UI-only: no place text, coordinates or user data enter IDs.
 */
let nextInstance = 0;

export interface OfflineCityPickerDomIds {
  readonly inputId: string;
  readonly listId: string;
  optionId(index: number): string;
}

export function newOfflineCityPickerDomIds(): OfflineCityPickerDomIds {
  const prefix = `vs-offline-city-${++nextInstance}`;
  return {
    inputId: `${prefix}-input`,
    listId: `${prefix}-list`,
    optionId: (index: number) => `${prefix}-option-${index}`,
  };
}
