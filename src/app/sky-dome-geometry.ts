/**
 * Screen-space geometry for the observer's celestial dome. Does not compute
 * astronomy. Every astronomical object enters with a host-calculated altitude
 * and azimuth in true-North / clockwise-East convention.
 *
 * Three.js frame: +X=East, +Y=Up (zenith), +Z=North.
 */
export type ObserverVector = Readonly<{x:number;y:number;z:number}>;
export type ObserverPoint = Readonly<{altitudeDeg:number;azimuthNorthEastDeg:number}>;
export type SkyOverlayKind = 'zodiac' | 'houses' | 'primary-directions';
/** Future overlay geometry must be supplied by a versioned, validated engine. */
export type SkyOverlayPolyline = Readonly<{
  id:string;
  kind:SkyOverlayKind;
  points:readonly ObserverPoint[];
  /** Identifies the ephemeris/method; never a guessed decorative line. */
  provenance:string;
}>;
const DEG=Math.PI/180;
export function observerVector(azimuthNorthEastDeg:number, altitudeDeg:number, radius=1):ObserverVector|null {
  if(![azimuthNorthEastDeg,altitudeDeg,radius].every(Number.isFinite)||
    altitudeDeg < -90 || altitudeDeg > 90 || radius <= 0) return null;
  const az=azimuthNorthEastDeg*DEG,alt=altitudeDeg*DEG;
  return Object.freeze({
    x:radius*Math.cos(alt)*Math.sin(az),
    y:radius*Math.sin(alt),
    z:radius*Math.cos(alt)*Math.cos(az),
  });
}
export function validOverlay(line:SkyOverlayPolyline):boolean {
  return ['zodiac','houses','primary-directions'].includes(line.kind) &&
    /^[a-z0-9_-]{1,80}$/.test(line.id) &&
    typeof line.provenance==='string' && line.provenance.length>0 && line.provenance.length<=180 &&
    line.points.length>=2 && line.points.length<=2048 &&
    line.points.every(p=>observerVector(p.azimuthNorthEastDeg,p.altitudeDeg)!==null);
}
