/** Host-owned glyphs from the approved astrological-assets pack. */
const RETROGRADE_ASSETS = new Set([
  'Chiron', 'Jupiter', 'Mars', 'Mercury', 'Neptune', 'Pluto', 'Saturn', 'Uranus', 'Venus',
  'mean Node', 'mean Node Sud', 'true Node', 'true Node Sud', 'osc. Apogee', 'osc. Perigee',
]);

export function celestialGlyphUrl(name: string, retrograde = false): string {
  return '/assets/img/simboli-bianchi/elementi-celesti/' +
    encodeURIComponent(name + (retrograde && RETROGRADE_ASSETS.has(name) ? '-r' : '')) + '.png';
}

export function zodiacGlyphUrl(sign: number): string {
  if (!Number.isInteger(sign) || sign < 0 || sign > 11) return '';
  return '/assets/img/simboli-bianchi/segni/' + String(sign + 1).padStart(2, '0') + '.png';
}
