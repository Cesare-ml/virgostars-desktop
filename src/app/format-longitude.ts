/**
 * Format an already validated ecliptic longitude for the demonstration inspector.
 * Does not calculate or normalize astronomical positions. Invalid values stay unavailable.
 */
export function formatEclipticLongitude(value: number, locale: 'it' | 'en' = 'en'): string {
  // Accept [0, 360) only. In particular, do not silently wrap bad source values.
  if ((locale !== 'it' && locale !== 'en') || !Number.isFinite(value) || value < 0 || value >= 360) return '—';
  const tenths = Math.round(value * 10);
  // A valid longitude just below 360 can round to the same display as 0.
  const displayed = ((tenths === 3600 ? 0 : tenths) / 10).toFixed(1);
  // Presentation only: CSV export retains the locale-independent decimal point.
  return (locale === 'it' ? displayed.replace('.', ',') : displayed) + '°';
}
