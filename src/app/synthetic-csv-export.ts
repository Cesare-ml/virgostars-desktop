/**
 * CSV export for the chart-first laboratory's fictional fixture only.
 * This does NOT export natal records, calculate astronomy, or support cloud sync.
 */
export const SYNTHETIC_CSV_FILENAME = 'virgostars-FICTIONAL-NOT-CALCULATED.csv';
export const SYNTHETIC_DATA_STATUS = 'FICTIONAL_NOT_CALCULATED';

const PLANET_ORDER = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
] as const;

type PlanetRow = Readonly<{ name: string; longitude: number }>;
type HouseRow = Readonly<{ number: number; longitude: number }>;

function invalidFixture(): never {
  // No data contents or filenames in errors: never log a potentially private value.
  throw new Error('Invalid fictional CSV fixture');
}

function formatSyntheticLongitude(value: number): string {
  if (!Number.isFinite(value) || Object.is(value, -0) || value < 0 || value >= 360) {
    invalidFixture();
  }
  const tenths = Math.round(value * 10);
  if (Math.abs(value * 10 - tenths) > 1e-8 || tenths >= 3600) invalidFixture();
  return (tenths / 10).toFixed(1);
}

/**
 * Strict 22-row, locale-independent export: fixed identifiers and decimal-dot values.
 * Invalid/missing/extra/duplicate fixture rows stop the export (no partial output).
 * File purpose is unambiguous even when opened outside VirgoStars Desktop.
 */
export function buildSyntheticChartCsv(
  planets: ReadonlyArray<PlanetRow>,
  houses: ReadonlyArray<HouseRow>,
): string {
  if (!Array.isArray(planets) || planets.length !== PLANET_ORDER.length ||
      !Array.isArray(houses) || houses.length !== 12) invalidFixture();

  const names = new Set<string>();
  const planetPositions = new Map<string, string>();
  for (const planet of planets) {
    if (!planet || typeof planet.name !== 'string' ||
        !PLANET_ORDER.includes(planet.name as (typeof PLANET_ORDER)[number]) ||
        names.has(planet.name)) invalidFixture();
    names.add(planet.name);
    planetPositions.set(planet.name, formatSyntheticLongitude(planet.longitude));
  }
  if (names.size !== PLANET_ORDER.length) invalidFixture();

  const housePositions = new Map<number, string>();
  for (const house of houses) {
    if (!house || !Number.isInteger(house.number) || house.number < 1 ||
        house.number > 12 || housePositions.has(house.number)) invalidFixture();
    housePositions.set(house.number, formatSyntheticLongitude(house.longitude));
  }
  if (housePositions.size !== 12) invalidFixture();

  // Identifiers are fixed and validated above: spreadsheet formula injection
  // (names starting =, +, -, @, or tab) is categorically rejected.
  const lines = ['record_type,object_name,longitude_degrees,data_quality'];
  for (const name of PLANET_ORDER) {
    lines.push('planet,' + name + ',' + planetPositions.get(name) + ',' + SYNTHETIC_DATA_STATUS);
  }
  for (let house = 1; house <= 12; house++) {
    lines.push('house,' + house + ',' + housePositions.get(house) + ',' + SYNTHETIC_DATA_STATUS);
  }
  return lines.join('\r\n') + '\r\n';
}
