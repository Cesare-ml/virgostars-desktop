/**
 * Aspect table of one chart, following the same rule the Charts renderer uses
 * to draw the lines, so the list describes what is on screen:
 *
 *  - points are taken in the renderer's fixed order;
 *  - both points must take part in aspects;
 *  - the orb is the one of the second point of the pair, capped by the orb of
 *    the aspect when that is set and smaller;
 *  - declination parallels use a fixed orb of one degree;
 *  - a point is never aspected with its own opposite, and axes never with axes.
 *
 * Angular arithmetic comes from astrological-functions. Whether an aspect is
 * applying is derived from daily motions; natal axes with unknown speed are omitted.
 * In transit comparisons, the natal chart is treated as a fixed snapshot.
 */
import {angularSeparation, normalize360, signedAngularDistance} from 'astrological-functions';
import type {AspectDefinition, AspectKind, ChartSettings} from '../chart-settings';
import type {TemaRenderData} from './tema-render-data';

/** The order in which the renderer walks the points when pairing them. */
export const RENDER_POINT_ORDER: readonly string[] = Object.freeze([
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Chiron',
  'MC', 'IC', 'AS', 'DS',
  'mean Apogee', 'mean Perigee', 'osc. Apogee', 'osc. Perigee',
  'mean Node', 'mean Node Sud', 'true Node', 'true Node Sud',
]);
const AXES: readonly string[] = ['AS', 'DS', 'MC', 'IC'];
const OPPOSITE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['osc. Apogee', 'osc. Perigee'], ['mean Apogee', 'mean Perigee'],
  ['true Node', 'true Node Sud'], ['mean Node', 'mean Node Sud'],
];
const PARALLEL_ORB_DEG = 1;
export const MATRIX_PLANETS: readonly string[] = Object.freeze([
  'Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto',
]);
export const MATRIX_EXTRA_POINTS: readonly string[] = Object.freeze([
  'osc. Apogee','true Node','AS','MC',
]);

/** The same ordering is used by both axes of the optional outer-planet matrix. */
export function matrixPointOrder(includeTransaturnians: boolean): readonly string[] {
  return [...(includeTransaturnians ? MATRIX_PLANETS : MATRIX_PLANETS.slice(0,7)), ...MATRIX_EXTRA_POINTS];
}

export type AspectPoint = Readonly<{
  name: string;
  longitude: number;
  /** Degrees per day; null for axes, which are treated as fixed. */
  speed: number | null;
  declination: number | null;
}>;

export type AspectRow = Readonly<{
  aspect: string;
  kind: AspectKind;
  from: string;
  to: string;
  /** Distance from exactness in degrees, always positive. */
  orbDeg: number;
  /** Orb allowed for this pair. */
  allowedOrbDeg: number;
  /** True while the aspect is becoming more exact; null when it cannot be told. */
  applying: boolean | null;
}>;

type PointSettings = Readonly<Record<string, {shown: boolean; orb: number; aspects: boolean} | undefined>>;

/** Points of a chart that the renderer would pair, in its order. */
export function aspectPoints(data: TemaRenderData, points: PointSettings): AspectPoint[] {
  const axes: Record<string, number> = {AS: data.as, DS: data.ds, MC: data.mc, IC: data.ic};
  const result: AspectPoint[] = [];
  for (const name of RENDER_POINT_ORDER) {
    if (AXES.includes(name)) {
      // Axes are always candidates; whether they are aspected is a separate setting.
      result.push({name, longitude: axes[name], speed: null, declination: null});
      continue;
    }
    const body = data.planets[name];
    if (!body || !points[name]?.shown) continue;
    result.push({
      name, longitude: body.longitude, speed: body.longitudeSpeed,
      declination: body.equatoriale.declination,
    });
  }
  return result;
}

function excluded(a: string, b: string): boolean {
  if (AXES.includes(a) && AXES.includes(b)) return true;
  return OPPOSITE_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/** Signed distance from exactness and its daily rate, or null when the aspect does not apply. */
function measure(definition: AspectDefinition, a: AspectPoint, b: AspectPoint): {deviation: number; rate: number | null} | null {
  const relativeSpeed = (b.speed ?? 0) - (a.speed ?? 0);
  switch (definition.kind) {
    case 'longitude': {
      const angle = definition.angleDeg as number;
      const target = Math.min(angle, 360 - angle);
      const signed = signedAngularDistance(a.longitude, b.longitude);
      // The separation grows when the point ahead moves faster.
      const rate = signed === 0 ? Math.abs(relativeSpeed) : Math.sign(signed) * relativeSpeed;
      return {deviation: angularSeparation(a.longitude, b.longitude) - target, rate};
    }
    case 'directed': {
      const ahead = normalize360(b.longitude - a.longitude);
      return {deviation: signedAngularDistance(definition.angleDeg as number, ahead), rate: relativeSpeed};
    }
    case 'parallel':
    case 'contraparallel': {
      if (a.declination === null || b.declination === null) return null;
      const deviation = definition.kind === 'parallel' ? a.declination - b.declination : a.declination + b.declination;
      // Declination motion is not part of the chart data, so applying is unknown.
      return {deviation, rate: null};
    }
  }
}

export function computeAspects(
  points: readonly AspectPoint[],
  settings: ChartSettings,
  definitions: readonly AspectDefinition[],
): AspectRow[] {
  const pointSettings: PointSettings = settings.points;
  const aspectSettings: Readonly<Record<string, {active: boolean; orb: number | null} | undefined>> = settings.aspects;
  const candidates = points.filter(point => pointSettings[point.name]?.aspects === true);
  const rows: AspectRow[] = [];
  for (const definition of definitions) {
    const setting = aspectSettings[definition.id];
    if (!setting?.active) continue;
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i], b = candidates[j];
        if (excluded(a.name, b.name)) continue;
        const measured = measure(definition, a, b);
        if (!measured) continue;
        const pointOrb = pointSettings[b.name]?.orb ?? 0;
        const allowed = definition.kind === 'parallel' || definition.kind === 'contraparallel'
          ? PARALLEL_ORB_DEG
          : setting.orb !== null && setting.orb < pointOrb ? setting.orb : pointOrb;
        const orbDeg = Math.abs(measured.deviation);
        if (!(orbDeg < allowed)) continue;
        const applying = a.speed === null || b.speed === null || measured.rate === null || measured.rate === 0 || measured.deviation === 0
          ? null : measured.deviation * measured.rate < 0;
        rows.push(Object.freeze({
          aspect: definition.id, kind: definition.kind, from: a.name, to: b.name,
          orbDeg, allowedOrbDeg: allowed, applying,
        }));
      }
    }
  }
  return rows;
}

/**
 * The dedicated aspects matrix evaluates traditional planets plus true Black
 * Moon (osculating apogee), true North Node, ASC and MC. Outer planets can be
 * toggled independently of the wheel's default aspect-line configuration.
 * Keep the chart's configured orbs and active aspect definitions intact.
 */
export function computePlanetMatrixAspects(
  data: TemaRenderData, settings: ChartSettings, definitions: readonly AspectDefinition[],
  includeTransaturnians = false,
): AspectRow[] {
  const points = {...settings.points};
  const visiblePoints = matrixPointOrder(includeTransaturnians);
  for (const name of visiblePoints) {
    const id = name as keyof ChartSettings['points'];
    points[id] = {...points[id], shown:true, aspects:true};
  }
  const matrixSettings = {...settings, points};
  const planetPoints = aspectPoints(data,matrixSettings.points).filter(point=>visiblePoints.includes(point.name));
  return computeAspects(planetPoints,matrixSettings,definitions);
}

/**
 * Ordered cross-chart pairs. Unlike pairs within one chart, equal names,
 * opposite points and pairs of axes represent distinct chart positions.
 * In a transit comparison only the sky moves; synastry has no common clock.
 */
export function computeCrossAspects(
  from: readonly AspectPoint[],
  to: readonly AspectPoint[],
  settings: ChartSettings,
  definitions: readonly AspectDefinition[],
  comparison: 'transits' | 'synastry',
): AspectRow[] {
  const rows: AspectRow[] = [];
  const pointSettings: PointSettings = settings.points;
  const aspectSettings: Readonly<Record<string, {active: boolean; orb: number | null} | undefined>> = settings.aspects;
  for (const definition of definitions) {
    const setting = aspectSettings[definition.id];
    if (!setting?.active) continue;
    for (const first of from) {
      if (!pointSettings[first.name]?.aspects) continue;
      for (const second of to) {
        const pointSetting = pointSettings[second.name];
        if (!pointSetting?.aspects) continue;
        // from = moving sky, to = fixed natal chart for transits.
        const measured = measure(definition, first,
          comparison === 'transits' ? {...second, speed: null} : second);
        if (!measured) continue;
        const allowed = definition.kind === 'parallel' || definition.kind === 'contraparallel'
          ? PARALLEL_ORB_DEG
          : setting.orb !== null && setting.orb < pointSetting.orb ? setting.orb : pointSetting.orb;
        const orbDeg = Math.abs(measured.deviation);
        if (!(orbDeg < allowed)) continue;
        const applying = comparison === 'synastry' || first.speed === null || measured.rate === null || measured.rate === 0 || measured.deviation === 0
          ? null : measured.deviation * measured.rate < 0;
        rows.push(Object.freeze({aspect: definition.id, kind: definition.kind, from: first.name, to: second.name,
          orbDeg, allowedOrbDeg: allowed, applying}));
      }
    }
  }
  return rows;
}

/** `2°05'`; minutes are truncated, never rounded up to 60. */
export function formatOrb(orbDeg: number): string {
  const totalMinutes = Math.floor(Math.abs(orbDeg) * 60 + 1e-9);
  return Math.floor(totalMinutes / 60) + '°' + String(totalMinutes % 60).padStart(2, '0') + "'";
}
