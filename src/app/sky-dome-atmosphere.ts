/**
 * Illustration-only atmospheric attenuation for the observer's sky.
 *
 * Native VirgoStars-Ephemeris supplies the geometric Sun altitude: this
 * function NEVER derives a celestial position or claims radiometric accuracy.
 * It is a smooth, bounded display convention from astronomical twilight
 * (-12° in the current sky UI) to the solar horizon (0°).
 *
 * Without atmosphere every catalogue star remains available, even by day.
 */
export function skyAtmosphereStarTransmission(
  sunAltitudeDeg:number|null,
  atmosphereEnabled:boolean,
):number {
  if(!atmosphereEnabled||sunAltitudeDeg===null||!Number.isFinite(sunAltitudeDeg))return 1;
  const x=Math.max(0,Math.min(1,(sunAltitudeDeg+12)/12));
  const twilight=x*x*(3-2*x);
  return 1-0.98*twilight;
}

/**
 * Suppress nearly invisible dots and nameplates from both rendering AND
 * raycasting. Avoid ghost hits on a star that daylight makes imperceptible.
 */
export function skyAtmosphereStarDotsVisible(transmission:number):boolean {
  return Number.isFinite(transmission)&&transmission>=0.05;
}
export function skyAtmosphereStarNamesVisible(transmission:number):boolean {
  return Number.isFinite(transmission)&&transmission>=0.22;
}
