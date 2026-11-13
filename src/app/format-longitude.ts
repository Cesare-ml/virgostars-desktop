/**
 * Format an already validated ecliptic longitude for the demonstration inspector.
 * Does not calculate or normalize astronomical positions. Invalid values stay unavailable.
 */
export function formatEclipticLongitude(value: number): string {
  // Accept [0, 360) only. In particular, do not silently wrap bad source values.
  if (!Number.isFinite(value) || value < 0 || value >= 360) return '—';
  const tenths = Math.round(value * 10);
  // A valid longitude just below 360 can round to the same display as 0.
  return ((tenths === 3600 ? 0 : tenths) / 10).toFixed(1) + '°';
}
