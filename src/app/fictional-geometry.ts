/**
 * Deterministic, intentionally fictional coordinates for the offline UI demo.
 * This file is not an astronomical model or a source of birth-chart positions.
 */
const BASE_PLANET_LONGITUDES = [19.3, 83.1, 44.8, 129.4, 167.1, 208.6, 278.1, 305.6, 347.7, 6.5] as const;
const BASE_ASCENDANT = 103;
const BASE_MEDIUM_COELI = 15;

export function normalizeFictionalLongitude(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Fictional longitude must be finite');
  const remainder = value % 360;
  // Negative sub-degree inputs can round back up to 360 when added to 360.
  // Keep the upper bound exclusive and canonicalize negative zero.
  if (remainder === 0) return 0;
  const wrapped = remainder < 0 ? remainder + 360 : remainder;
  return wrapped === 360 ? 0 : wrapped;
}

export interface FictionalAngles {
  readonly ascendant: number;
  readonly descendant: number;
  readonly mediumCoeli: number;
  readonly imumCoeli: number;
  readonly vertex: number;
  readonly planetLongitudes: ReadonlyArray<number>;
  readonly houseCusps: ReadonlyArray<number>;
}

export function buildFictionalAngles(shift: number): Readonly<FictionalAngles> {
  if (!Number.isFinite(shift)) throw new RangeError('Fictional shift must be finite');
  // Reduce before adding base angles: a large but finite offset must not erase
  // every small coordinate by floating-point absorption.
  const shiftDegrees = normalizeFictionalLongitude(shift);
  const ascendant = normalizeFictionalLongitude(BASE_ASCENDANT + shiftDegrees);
  const mediumCoeli = normalizeFictionalLongitude(BASE_MEDIUM_COELI + shiftDegrees);
  return Object.freeze({
    ascendant,
    descendant: normalizeFictionalLongitude(ascendant + 180),
    mediumCoeli,
    imumCoeli: normalizeFictionalLongitude(mediumCoeli + 180),
    vertex: normalizeFictionalLongitude(ascendant + 120),
    planetLongitudes: Object.freeze(BASE_PLANET_LONGITUDES.map((longitude) =>
      normalizeFictionalLongitude(longitude + shiftDegrees))),
    houseCusps: Object.freeze(Array.from({length: 12}, (_, i) =>
      normalizeFictionalLongitude(ascendant + i * 30))),
  });
}
