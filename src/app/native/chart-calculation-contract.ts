/**
 * Chart-calculation contract shared with the Rust `calculate_chart` command.
 * One UTC instant and one position go in; positions and house cusps come out.
 * Nothing here is astronomy: every value is validated and copied, never derived.
 */
export const CHART_BODY_IDS = Object.freeze([
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
  'mean Node', 'true Node', 'mean Apogee', 'osc. Apogee', 'Chiron',
] as const);
export type ChartBodyId = typeof CHART_BODY_IDS[number];

export const HOUSE_SYSTEM_IDS = Object.freeze(['egizia', 'placido', 'koch', 'regio-montano', 'porfirio'] as const);
export type HouseSystemId = typeof HOUSE_SYSTEM_IDS[number] | import('../astro/extra-houses').ExtraHouseSystemId;

export type EphemerisSource = 'jpl' | 'lunar_model';

export type ChartBodyV1 = Readonly<{
  id: ChartBodyId;
  longitudeDeg: number;
  latitudeDeg: number;
  distanceAu: number;
  longitudeSpeed: number;
  latitudeSpeed: number;
  distanceSpeed: number;
  rightAscensionDeg: number;
  declinationDeg: number;
  ephemerisSource: EphemerisSource;
}>;

export type ChartHouseSystemV1 = Readonly<{
  id: HouseSystemId;
  cuspsDeg: readonly number[];
  ascendantDeg: number;
  mcDeg: number;
  armcDeg: number;
  vertexDeg: number;
}>;

export type ChartSnapshotV1 = Readonly<{
  julianDayUt: number;
  houseAngleContext?: Readonly<{ttJulianDay:number; trueObliquityDeg:number}> | null;
  bodies: readonly ChartBodyV1[];
  houses: readonly ChartHouseSystemV1[];
  unavailableBodies: readonly ChartBodyId[];
  unavailableHouseSystems: readonly HouseSystemId[];
}>;

export type ChartProviderV1 = Readonly<{id: string; engineVersion: string}>;

export type SolarDayV1 = Readonly<{sunriseJdUt: number; sunsetJdUt: number; nextSunriseJdUt: number}>;
export type FixedStarV1 = Readonly<{id:number; name:string; longitudeDeg:number; latitudeDeg:number; magnitude:number | null; trueAltitudeDeg:number; azimuthSouthWestDeg:number; approximate:boolean; constellation:string | null; interpretations:Readonly<Record<string,string>>}>;
export type ChartRequestV1 = Readonly<{utcIso: string; latMicro: number; lngMicro: number; includeSolarEvents?: boolean; includePreviousNewMoon?:boolean; includeFixedStars?:boolean}>;

export type ChartCalculationResult =
  | Readonly<{kind: 'ready'; provider: ChartProviderV1; chart: ChartSnapshotV1; solarDay?: SolarDayV1 | null; previousNewMoonLongitudeDeg?:number | null; fixedStars?:readonly FixedStarV1[] | null}>
  | Readonly<{kind: 'not_native' | 'provider_unavailable' | 'invalid_request' | 'out_of_range' | 'calculation_failed' | 'unavailable'}>;

export interface ChartCalculationTransport {
  isNative(): boolean;
  invoke(
    command: 'calculate_chart',
    args: {request: {protocolVersion: 1; utcIso: string; latMicro: number; lngMicro: number; includeSolarEvents?: boolean; includePreviousNewMoon?:boolean; includeFixedStars?:boolean}},
  ): Promise<unknown>;
}

const PROTOCOL_ERROR = 'Invalid chart calculation protocol';
const JD_MIN = 2_410_000;
const JD_MAX = 2_470_000;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SOURCES: readonly string[] = ['jpl'];

function plainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const prototype = Object.getPrototypeOf(x);
  return prototype === Object.prototype || prototype === null;
}

/** Read one own data property: never a getter, never an inherited value. */
function field(source: object, name: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, name);
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error(PROTOCOL_ERROR);
  return descriptor.value;
}

function denseArray(x: unknown, maxLength: number): unknown[] {
  if (!Array.isArray(x) || Object.getPrototypeOf(x) !== Array.prototype || x.length > maxLength ||
      Reflect.ownKeys(x).length !== x.length + 1) {
    throw new Error(PROTOCOL_ERROR);
  }
  return Array.from({length: x.length}, (_, index) => field(x, String(index)));
}

function finite(x: unknown, min: number, max: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) throw new Error(PROTOCOL_ERROR);
  return x;
}

/** Longitudes and right ascensions: `0 <= value < 360`. */
function circle(x: unknown): number {
  const value = finite(x, 0, 360);
  if (value === 360) throw new Error(PROTOCOL_ERROR);
  return value;
}

function member<T extends string>(x: unknown, allowed: readonly T[], seen: Set<string>): T {
  if (typeof x !== 'string' || !(allowed as readonly string[]).includes(x) || seen.has(x)) {
    throw new Error(PROTOCOL_ERROR);
  }
  seen.add(x);
  return x as T;
}

function decodeBody(raw: unknown, seen: Set<string>, historical: boolean): ChartBodyV1 {
  if (!plainObject(raw)) throw new Error(PROTOCOL_ERROR);
  const source = field(raw, 'ephemerisSource');
  if (typeof source !== 'string' || !(SOURCES.includes(source) || (historical && source === 'lunar_model'))) throw new Error(PROTOCOL_ERROR);
  return Object.freeze({
    id: member(field(raw, 'id'), CHART_BODY_IDS, seen),
    longitudeDeg: circle(field(raw, 'longitudeDeg')),
    latitudeDeg: finite(field(raw, 'latitudeDeg'), -90, 90),
    distanceAu: finite(field(raw, 'distanceAu'), 0, 1000),
    longitudeSpeed: finite(field(raw, 'longitudeSpeed'), -30, 30),
    latitudeSpeed: finite(field(raw, 'latitudeSpeed'), -30, 30),
    distanceSpeed: finite(field(raw, 'distanceSpeed'), -10, 10),
    rightAscensionDeg: circle(field(raw, 'rightAscensionDeg')),
    declinationDeg: finite(field(raw, 'declinationDeg'), -90, 90),
    ephemerisSource: source as EphemerisSource,
  });
}

function decodeHouseSystem(raw: unknown, seen: Set<string>): ChartHouseSystemV1 {
  if (!plainObject(raw)) throw new Error(PROTOCOL_ERROR);
  const cusps = denseArray(field(raw, 'cuspsDeg'), 12);
  if (cusps.length !== 12) throw new Error(PROTOCOL_ERROR);
  return Object.freeze({
    id: member(field(raw, 'id'), HOUSE_SYSTEM_IDS, seen),
    cuspsDeg: Object.freeze(cusps.map(circle)),
    ascendantDeg: circle(field(raw, 'ascendantDeg')),
    mcDeg: circle(field(raw, 'mcDeg')),
    armcDeg: circle(field(raw, 'armcDeg')),
    vertexDeg: circle(field(raw, 'vertexDeg')),
  });
}

type DecodedResponse =
  | Readonly<{status: 'ok'; provider: ChartProviderV1; chart: ChartSnapshotV1; solarDay?: SolarDayV1 | null; previousNewMoonLongitudeDeg?:number | null; fixedStars?:readonly FixedStarV1[] | null}>
  | Readonly<{status: 'provider_unavailable' | 'invalid_request' | 'out_of_range' | 'calculation_failed'}>;

/** Detached, frozen values from one native response; throws a generic error otherwise. */
export function decodeChartResponse(raw: unknown, historical = false): DecodedResponse {
  try {
    if (!plainObject(raw) || field(raw, 'protocolVersion') !== 1) throw new Error(PROTOCOL_ERROR);
    const status = field(raw, 'status');
    if (status === 'provider_unavailable' || status === 'invalid_request' || status === 'out_of_range' || status === 'calculation_failed') {
      return Object.freeze({status});
    }
    if (status !== 'ok') throw new Error(PROTOCOL_ERROR);

    const provider = field(raw, 'provider');
    if (!plainObject(provider)) throw new Error(PROTOCOL_ERROR);
    const providerId = field(provider, 'id');
    const engineVersion = field(provider, 'engineVersion');
    if (typeof providerId !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(providerId) ||
        typeof engineVersion !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(engineVersion)) {
      throw new Error(PROTOCOL_ERROR);
    }

    const chart = field(raw, 'chart');
    if (!plainObject(chart)) throw new Error(PROTOCOL_ERROR);
    const bodyIds = new Set<string>();
    const bodies = denseArray(field(chart, 'bodies'), CHART_BODY_IDS.length).map(body => decodeBody(body, bodyIds, historical));
    const houseIds = new Set<string>();
    const houses = denseArray(field(chart, 'houses'), HOUSE_SYSTEM_IDS.length)
      .map(system => decodeHouseSystem(system, houseIds));
    // A body or system is either computed or listed as unavailable, never both.
    const unavailableBodies = denseArray(field(chart, 'unavailableBodies'), CHART_BODY_IDS.length)
      .map(id => member(id, CHART_BODY_IDS, bodyIds));
    const unavailableHouseSystems = denseArray(field(chart, 'unavailableHouseSystems'), HOUSE_SYSTEM_IDS.length)
      .map(id => member(id, HOUSE_SYSTEM_IDS, houseIds));
    if (!bodyIds.has('Sun') || !bodyIds.has('Moon') ||
        unavailableBodies.includes('Sun') || unavailableBodies.includes('Moon')) {
      throw new Error(PROTOCOL_ERROR);
    }
    const julianDayUt = finite(field(chart, 'julianDayUt'), historical ? -4_000_000 : JD_MIN, historical ? 4_000_000 : JD_MAX);
    const solarDescriptor = Object.getOwnPropertyDescriptor(raw, 'solarDay');
    let solarDay: SolarDayV1 | null = null;
    if (solarDescriptor) {
      const solar = field(raw, 'solarDay');
      if (solar !== null) {
        if (!plainObject(solar)) throw new Error(PROTOCOL_ERROR);
        const sunriseJdUt = finite(field(solar, 'sunriseJdUt'), JD_MIN - 3, JD_MAX + 3);
        const sunsetJdUt = finite(field(solar, 'sunsetJdUt'), JD_MIN - 3, JD_MAX + 3);
        const nextSunriseJdUt = finite(field(solar, 'nextSunriseJdUt'), JD_MIN - 3, JD_MAX + 3);
        if (!(sunriseJdUt <= julianDayUt && julianDayUt < nextSunriseJdUt &&
              sunriseJdUt < sunsetJdUt && sunsetJdUt < nextSunriseJdUt)) throw new Error(PROTOCOL_ERROR);
        solarDay = Object.freeze({sunriseJdUt, sunsetJdUt, nextSunriseJdUt});
      }
    }
    const contextDescriptor = Object.getOwnPropertyDescriptor(chart, 'houseAngleContext');
    let houseAngleContext: {ttJulianDay:number; trueObliquityDeg:number} | null = null;
    if (contextDescriptor) {
      const context = field(chart, 'houseAngleContext');
      if (context !== null) {
        if (!plainObject(context)) throw new Error(PROTOCOL_ERROR);
        const ttJulianDay = finite(field(context, 'ttJulianDay'), julianDayUt - 1, julianDayUt + 1);
        const trueObliquityDeg = finite(field(context, 'trueObliquityDeg'), 0.01, 89.99);
        houseAngleContext = Object.freeze({ttJulianDay, trueObliquityDeg});
      }
    }
    const moonDescriptor = Object.getOwnPropertyDescriptor(raw, 'previousNewMoonLongitudeDeg');
    const moonRaw = moonDescriptor ? field(raw, 'previousNewMoonLongitudeDeg') : null;
    const previousNewMoonLongitudeDeg = moonRaw === null ? null : circle(moonRaw);
    const starsDescriptor = Object.getOwnPropertyDescriptor(raw, 'fixedStars');
    const starsRaw = starsDescriptor ? field(raw, 'fixedStars') : null;
    let fixedStars: readonly FixedStarV1[] | null = null;
    if (starsRaw !== null) {
      const ids = new Set<number>();
      fixedStars = Object.freeze(denseArray(starsRaw, 2048).map(star => {
        if (!plainObject(star)) throw new Error(PROTOCOL_ERROR);
        const id = finite(field(star, 'id'), 1, 1000000), name = field(star, 'name');
        if (!Number.isSafeInteger(id) || ids.has(id) || typeof name !== 'string' || !/^[\p{L}\p{N} .'-]{1,80}$/u.test(name)) throw new Error(PROTOCOL_ERROR);
        ids.add(id);
        const interpretations:Record<string,string> = Object.create(null);
        const interpretationDescriptor = Object.getOwnPropertyDescriptor(star, 'interpretations');
        if (interpretationDescriptor) {
          const source = field(star, 'interpretations');
          if (!plainObject(source) || Reflect.ownKeys(source).length > 32) throw new Error(PROTOCOL_ERROR);
          for (const key of Reflect.ownKeys(source)) {
            if (typeof key !== 'string' || !key || key.length > 80) throw new Error(PROTOCOL_ERROR);
            const value = field(source,key);
            if (typeof value !== 'string' || value.length > 8192 || value.includes('\0')) throw new Error(PROTOCOL_ERROR);
            interpretations[key] = value;
          }
        }
        const magnitudeRaw = field(star, 'magnitude');
        const approximateDescriptor = Object.getOwnPropertyDescriptor(star, 'approximate');
        const approximate = approximateDescriptor ? field(star, 'approximate') : false;
        if (typeof approximate !== 'boolean') throw new Error(PROTOCOL_ERROR);
        const constellationRaw = Object.getOwnPropertyDescriptor(star, 'constellation') ? field(star,'constellation') : null;
        if (constellationRaw !== null && (typeof constellationRaw !== 'string' || constellationRaw.length > 160 || /[\x00-\x1f\x7f]/.test(constellationRaw))) throw new Error(PROTOCOL_ERROR);
        return Object.freeze({id, name, longitudeDeg:circle(field(star, 'longitudeDeg')),
          latitudeDeg:finite(field(star, 'latitudeDeg'), -90, 90), magnitude:magnitudeRaw === null ? null : finite(magnitudeRaw, -10, 20), approximate,
          trueAltitudeDeg:finite(field(star, 'trueAltitudeDeg'), -90, 90), azimuthSouthWestDeg:circle(field(star, 'azimuthSouthWestDeg')),
          constellation:constellationRaw as string | null, interpretations:Object.freeze(interpretations)});
      }));
    }
    return Object.freeze({
      status: 'ok',
      provider: Object.freeze({id: providerId, engineVersion}),
      ...(solarDescriptor ? {solarDay} : {}),
      ...(moonDescriptor ? {previousNewMoonLongitudeDeg} : {}),
      ...(starsDescriptor ? {fixedStars} : {}),
      chart: Object.freeze({
        // Calendar years 1900 to 2033 (JD about 2 415 020 to 2 463 965), with some margin.
        julianDayUt,
        ...(contextDescriptor ? {houseAngleContext} : {}),
        bodies: Object.freeze(bodies),
        houses: Object.freeze(houses),
        unavailableBodies: Object.freeze(unavailableBodies),
        unavailableHouseSystems: Object.freeze(unavailableHouseSystems),
      }),
    });
  } catch {
    // Never surface native details, accessor or Proxy trap messages.
    throw new Error(PROTOCOL_ERROR);
  }
}

export function validChartRequest(request: ChartRequestV1): boolean {
  return typeof request?.utcIso === 'string' && UTC_PATTERN.test(request.utcIso) &&
    Number.isSafeInteger(request.latMicro) && Math.abs(request.latMicro) <= 90_000_000 &&
    Number.isSafeInteger(request.lngMicro) && Math.abs(request.lngMicro) <= 180_000_000 &&
    (request.includeSolarEvents === undefined || typeof request.includeSolarEvents === 'boolean') &&
    (request.includePreviousNewMoon === undefined || typeof request.includePreviousNewMoon === 'boolean') &&
    (request.includeFixedStars === undefined || typeof request.includeFixedStars === 'boolean');
}

/**
 * One native call per request. The caller decides which answer is still wanted;
 * failures are reduced to a small set of states and never carry birth data.
 */
export async function requestChart(
  transport: ChartCalculationTransport,
  request: ChartRequestV1,
): Promise<ChartCalculationResult> {
  if (!validChartRequest(request)) return {kind: 'invalid_request'};
  try {
    if (!transport.isNative()) return {kind: 'not_native'};
    const raw = await transport.invoke('calculate_chart', {
      request: {protocolVersion: 1, utcIso: request.utcIso, latMicro: request.latMicro, lngMicro: request.lngMicro,
        ...(request.includeSolarEvents ? {includeSolarEvents: true} : {}),
        ...(request.includePreviousNewMoon ? {includePreviousNewMoon:true} : {}),
        ...(request.includeFixedStars ? {includeFixedStars:true} : {})},
    });
    const decoded = decodeChartResponse(raw);
    return decoded.status === 'ok'
      ? {kind: 'ready', provider: decoded.provider, chart: decoded.chart,
        ...(Object.hasOwn(decoded, 'solarDay') ? {solarDay: decoded.solarDay} : {}),
        ...(Object.hasOwn(decoded, 'previousNewMoonLongitudeDeg') ? {previousNewMoonLongitudeDeg:decoded.previousNewMoonLongitudeDeg} : {}),
        ...(Object.hasOwn(decoded, 'fixedStars') ? {fixedStars:decoded.fixedStars} : {})}
      : {kind: decoded.status};
  } catch {
    return {kind: 'unavailable'};
  }
}
