/** Read-only synthetic fixtures for renderer QA; never use as calculated astrology. */
export const DEMO_PRESETS = Object.freeze([
  Object.freeze({id: 'a', shift: 0, labelKey: 'demo.preset.a'}),
  Object.freeze({id: 'b', shift: 45, labelKey: 'demo.preset.b'}),
  Object.freeze({id: 'c', shift: 120, labelKey: 'demo.preset.c'}),
] as const);
export type DemoPresetId = (typeof DEMO_PRESETS)[number]['id'];
export const DEFAULT_DEMO_PRESET: DemoPresetId = 'a';

export const DEMO_NAMES = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter',
  'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;
export type DemoPlanet = (typeof DEMO_NAMES)[number];
const BASE_LONGITUDES = [19.3, 83.1, 44.8, 129.4, 167.1, 208.6, 278.1, 305.6, 347.7, 6.5] as const;

function wrapDegrees(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Invalid synthetic fixture offset');
  if (value >= 0 && value < 360) return value;
  return ((value % 360) + 360) % 360;
}

export function demoPresetDefinition(id: DemoPresetId): (typeof DEMO_PRESETS)[number] {
  const item = DEMO_PRESETS.find(preset => preset.id === id);
  if (!item) throw new Error('Unknown synthetic demo preset');
  return item;
}

export function nextDemoPreset(current: DemoPresetId): DemoPresetId {
  const index = DEMO_PRESETS.findIndex(preset => preset.id === current);
  if (index < 0) throw new Error('Unknown synthetic demo preset');
  return DEMO_PRESETS[(index + 1) % DEMO_PRESETS.length].id;
}

export function fictionalAngles(shift = 0): Readonly<{ascendant: number; mc: number}> {
  return {ascendant: wrapDegrees(103 + shift), mc: wrapDegrees(15 + shift)};
}

export function fictionalPlanetPositions(shift = 0): ReadonlyArray<Readonly<{name: DemoPlanet; longitude: number}>> {
  return DEMO_NAMES.map((name, index) => ({name, longitude: wrapDegrees(BASE_LONGITUDES[index] + shift)}));
}

export function fictionalHousePositions(shift = 0): ReadonlyArray<Readonly<{number: number; longitude: number}>> {
  const {ascendant} = fictionalAngles(shift);
  return Array.from({length: 12}, (_, index) => ({number: index + 1, longitude: wrapDegrees(ascendant + index * 30)}));
}
