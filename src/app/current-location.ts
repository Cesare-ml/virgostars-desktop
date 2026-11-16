/** Validate one-shot device coordinates before they enter the chart form. */
export type CurrentLocationCoordinates = Readonly<{latMicro: number; lngMicro: number}>;

export function normalizeCurrentCoordinates(latitude: unknown, longitude: unknown): CurrentLocationCoordinates | null {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  const latMicro = Math.round(latitude * 1_000_000);
  const lngMicro = Math.round(longitude * 1_000_000);
  if (!Number.isSafeInteger(latMicro) || !Number.isSafeInteger(lngMicro)) return null;
  return Object.freeze({latMicro, lngMicro});
}
