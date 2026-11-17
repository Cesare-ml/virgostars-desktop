/**
 * Turns one validated chart snapshot into the data shape the Charts renderer
 * draws. Zodiac arithmetic and house placement come from astrological-functions;
 * positions come from the snapshot. Nothing is estimated here: a body or house
 * system the provider did not compute is simply absent.
 */
import {
  dodecatemoriaLongitude, locateLongitudeInHouses, normalize360, zodiacSignIndex,
} from 'astrological-functions';
import type {
  ChartBodyV1, ChartHouseSystemV1, ChartSnapshotV1, HouseSystemId,
} from '../native/chart-calculation-contract';

export type RenderPlanet = {
  name: string;
  longitude: number;
  latitude: number;
  distance: number;
  longitudeSpeed: number;
  latitudeSpeed: number;
  distanceSpeed: number;
  longitudeSign: number;
  longitude30: number;
  equatoriale: {rectAscension: number; declination: number};
  dodecatemoria?: {longitude: number; longitudeSpeed: number; longitudeSign: number; longitude30: number};
};

export type RenderHouseSystem = {
  house: number[];
  ascendant: number;
  mc: number;
  armc: number;
  vertex: number;
  ds: number;
  ic: number;
};

export type TemaRenderData = {
  dataora: string;
  as: number;
  ds: number;
  mc: number;
  ic: number;
  planets: Record<string, RenderPlanet>;
  houses: Record<string, RenderHouseSystem>;
  australInversion: boolean;
  fasiSinodiche: Record<string, never>;
  fasiSinodicheLatitudinali: Record<string, never>;
  lunazioniErmetiche: Record<string, never>;
  astrologiaOraria: Record<string, never>;
  orePlanetarie: Record<string, never>;
  partiArabe: Record<string, never>;
};

/** The seven traditional bodies carry a dodecatemorion. */
const TRADITIONAL = new Set(['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn']);

/** Points defined as the exact opposite of a computed one. */
const OPPOSITES: ReadonlyArray<readonly [string, string]> = [
  ['true Node Sud', 'true Node'],
  ['mean Node Sud', 'mean Node'],
  ['osc. Perigee', 'osc. Apogee'],
  ['mean Perigee', 'mean Apogee'],
];

function zodiacParts(longitude: number): {longitudeSign: number; longitude30: number} {
  const longitudeSign = zodiacSignIndex(longitude);
  return {longitudeSign, longitude30: longitude - longitudeSign * 30};
}

function planet(body: ChartBodyV1): RenderPlanet {
  const result: RenderPlanet = {
    name: body.id,
    longitude: body.longitudeDeg,
    latitude: body.latitudeDeg,
    distance: body.distanceAu,
    longitudeSpeed: body.longitudeSpeed,
    latitudeSpeed: body.latitudeSpeed,
    distanceSpeed: body.distanceSpeed,
    ...zodiacParts(body.longitudeDeg),
    equatoriale: {rectAscension: body.rightAscensionDeg, declination: body.declinationDeg},
  };
  if (TRADITIONAL.has(body.id)) {
    const longitude = dodecatemoriaLongitude(body.longitudeDeg);
    result.dodecatemoria = {longitude, longitudeSpeed: body.longitudeSpeed, ...zodiacParts(longitude)};
  }
  return result;
}

function opposite(name: string, source: RenderPlanet): RenderPlanet {
  const longitude = normalize360(source.longitude + 180);
  return {
    name,
    longitude,
    latitude: -source.latitude,
    distance: source.distance,
    longitudeSpeed: source.longitudeSpeed,
    latitudeSpeed: -source.latitudeSpeed,
    distanceSpeed: source.distanceSpeed,
    ...zodiacParts(longitude),
    equatoriale: {
      rectAscension: normalize360(source.equatoriale.rectAscension + 180),
      declination: -source.equatoriale.declination,
    },
  };
}

function houseSystem(system: ChartHouseSystemV1): RenderHouseSystem {
  return {
    house: [...system.cuspsDeg],
    ascendant: system.ascendantDeg,
    mc: system.mcDeg,
    armc: system.armcDeg,
    vertex: system.vertexDeg,
    ds: normalize360(system.ascendantDeg + 180),
    ic: normalize360(system.mcDeg + 180),
  };
}

/**
 * Returns null when the snapshot has no house system at all: without an
 * Ascendant the renderer cannot orient the wheel, and none is invented.
 */
export function buildTemaRenderData(chart: ChartSnapshotV1, utcIso: string): TemaRenderData | null {
  const first = chart.houses[0];
  if (!first) return null;
  const planets: Record<string, RenderPlanet> = {};
  for (const body of chart.bodies) planets[body.id] = planet(body);
  for (const [name, sourceName] of OPPOSITES) {
    const source = planets[sourceName];
    if (source) planets[name] = opposite(name, source);
  }
  const houses: Record<string, RenderHouseSystem> = {};
  for (const system of chart.houses) houses[system.id] = houseSystem(system);
  // The four angles do not depend on the house system.
  const angles = houseSystem(first);
  return {
    dataora: utcIso,
    as: angles.ascendant, ds: angles.ds, mc: angles.mc, ic: angles.ic,
    planets, houses,
    australInversion: false,
    fasiSinodiche: {}, fasiSinodicheLatitudinali: {}, lunazioniErmetiche: {},
    astrologiaOraria: {}, orePlanetarie: {}, partiArabe: {},
  };
}

export type PlanetRow = Readonly<{
  name: string;
  longitude: number;
  /** Ecliptic latitude in degrees, north positive. */
  latitude: number;
  /** Longitude speed in degrees per day; negative is retrograde. */
  speed: number;
  /** Latitude speed in degrees per day. */
  latitudeSpeed: number;
  signIndex: number;
  degreeInSign: number;
  retrograde: boolean;
  house: number | null;
}>;

export type TableLocale = 'it' | 'en';
const SIGN_ABBREVIATIONS: Readonly<Record<TableLocale, readonly string[]>> = Object.freeze({
  it: ['Ari', 'Tor', 'Gem', 'Can', 'Leo', 'Ver', 'Bil', 'Sco', 'Sag', 'Cap', 'Acq', 'Pes'],
  en: ['Ari', 'Tau', 'Gem', 'Can', 'Leo', 'Vir', 'Lib', 'Sco', 'Sag', 'Cap', 'Aqu', 'Pis'],
});
const pad2 = (value: number): string => String(value).padStart(2, '0');
const SECONDS_PER_CIRCLE = 360 * 3600;

/** `28° Bil 27' 36"`: degrees, sign, minutes and seconds within the sign, truncated and never rounded up to 60. */
export function formatLongitudeDms(longitude: number, locale: TableLocale = 'it'): string {
  if (!Number.isFinite(longitude)) return '—';
  const total = Math.floor(longitude * 3600 + 1e-6);
  const seconds = ((total % SECONDS_PER_CIRCLE) + SECONDS_PER_CIRCLE) % SECONDS_PER_CIRCLE;
  const degrees = Math.floor(seconds / 3600);
  const sign = Math.floor(degrees / 30);
  return pad2(degrees - sign * 30) + '° ' + SIGN_ABBREVIATIONS[locale][sign] + ' ' +
    pad2(Math.floor(seconds / 60) % 60) + "' " + pad2(seconds % 60) + '"';
}

/** `-05° 09' 35"`: signed degrees, minutes and seconds, truncated. */
export function formatLatitudeDms(latitude: number): string {
  if (!Number.isFinite(latitude)) return '—';
  const seconds = Math.floor(Math.abs(latitude) * 3600 + 1e-6);
  return (latitude < 0 && seconds > 0 ? '-' : '') + pad2(Math.floor(seconds / 3600)) + '° ' +
    pad2(Math.floor(seconds / 60) % 60) + "' " + pad2(seconds % 60) + '"';
}

/** Longitude speed in degrees per day with at most two decimals and the locale's decimal separator. */
export function formatSpeed(speed: number, locale: TableLocale = 'it', decimals = 2): string {
  if (!Number.isFinite(speed)) return '—';
  const scale = 10 ** decimals;
  const rounded = Math.round(speed * scale) / scale;
  return new Intl.NumberFormat(locale === 'it' ? 'it-IT' : 'en-GB', {maximumFractionDigits: decimals})
    .format(Object.is(rounded, -0) ? 0 : rounded);
}

export type HouseDisplay = Readonly<{text: string; element: 'fire' | 'earth' | 'air' | 'water'}>;
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const ELEMENTS = ['fire', 'earth', 'air', 'water'] as const;
/** Angular houses are written in Roman numerals, the others in Arabic; the colour follows the element of the house. */
export function houseDisplay(house: number): HouseDisplay | null {
  if (!Number.isInteger(house) || house < 1 || house > 12) return null;
  return Object.freeze({
    text: [1, 4, 7, 10].includes(house) ? ROMAN[house] : String(house),
    element: ELEMENTS[(house - 1) % 4],
  });
}

/** Inspector rows in the order the snapshot lists them, opposites last. */
export function planetRows(data: TemaRenderData, system: HouseSystemId): PlanetRow[] {
  const cusps = data.houses[system]?.house;
  return Object.values(data.planets).map(body => {
    let house: number | null = null;
    if (cusps) {
      try { house = locateLongitudeInHouses(body.longitude, cusps).house; } catch { house = null; }
    }
    return Object.freeze({
      name: body.name,
      longitude: body.longitude,
      signIndex: body.longitudeSign,
      degreeInSign: body.longitude30,
      latitude: body.latitude,
      speed: body.longitudeSpeed,
      latitudeSpeed: body.latitudeSpeed,
      retrograde: body.longitudeSpeed < 0,
      house,
    });
  });
}

export function availableHouseSystems(data: TemaRenderData): HouseSystemId[] {
  return Object.keys(data.houses) as HouseSystemId[];
}

/** `12°34'` within a sign; minutes are truncated, never rounded up to 60. */
export function formatDegreeInSign(degreeInSign: number): string {
  const totalMinutes = Math.floor(degreeInSign * 60 + 1e-9);
  const degrees = Math.floor(totalMinutes / 60);
  return degrees + '°' + String(totalMinutes % 60).padStart(2, '0') + "'";
}
