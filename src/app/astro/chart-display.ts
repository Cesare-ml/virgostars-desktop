import {angularSeparation, normalize360} from 'astrological-functions';
import type {ChartSettings} from '../chart-settings';
import type {TemaRenderData} from './tema-render-data';

/** VirgoStars/Regolo: southern charts use opposite zodiac positions and a mirrored wheel. */
export function australChartData(data:TemaRenderData, latitudeMicro:number, enabled:boolean): TemaRenderData {
  if (!enabled || latitudeMicro >= 0) return data;
  const opposite = (value:number):number => normalize360(value + 180);
  const planets = Object.fromEntries(Object.entries(data.planets).map(([id,body]) => {
    const longitude = opposite(body.longitude);
    const dodecatemoria = body.dodecatemoria && {...body.dodecatemoria,
      longitude:opposite(body.dodecatemoria.longitude), longitudeSign:(body.dodecatemoria.longitudeSign+6)%12};
    return [id,{...body, longitude, longitudeSign:(body.longitudeSign+6)%12, dodecatemoria}];
  }));
  const houses = Object.fromEntries(Object.entries(data.houses).map(([id,house]) => [id,{...house,
    house:house.house.map(opposite), ascendant:opposite(house.ascendant), mc:opposite(house.mc),
    ds:opposite(house.ds), ic:opposite(house.ic), vertex:opposite(house.vertex), armc:opposite(house.armc)}]));
  return {...data, planets, houses, as:opposite(data.as), ds:opposite(data.ds), mc:opposite(data.mc), ic:opposite(data.ic), australInversion:true};
}

/** Regolo includes otherwise hidden outer planets only inside their own orb of a visible point or axis. */
export function settingsWithConjunctOuter(data:TemaRenderData, settings:ChartSettings): ChartSettings {
  if (!settings.outerWhenConjunct) return settings;
  const points = {...settings.points};
  const active:number[] = [data.as,data.ds,data.mc,data.ic].filter(Number.isFinite);
  for (const [name,option] of Object.entries(settings.points)) {
    const body = data.planets[name];
    if (option.shown && body && Number.isFinite(body.longitude)) active.push(body.longitude);
  }
  for (const name of ['Uranus','Neptune','Pluto'] as const) {
    const body = data.planets[name], option = settings.points[name];
    if (!option.shown && body && Number.isFinite(body.longitude) && active.some(longitude => angularSeparation(body.longitude,longitude) < option.orb)) {
      points[name] = {...option, shown:true};
      active.push(body.longitude);
    }
  }
  return {...settings, points};
}

/** Exact Regolo 252-year/36-year-cycle convention; Jan–March before 0° Aries uses the prior year. */
export function regoloPlanetOfYear(year:number, month:number, sunLongitude:number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isFinite(sunLongitude)) return null;
  const years = ((year - 1765 - (sunLongitude > 270 && month <= 3 ? 1 : 0)) % 252 + 252) % 252;
  const order = ['Saturn','Jupiter','Mars','Sun','Venus','Mercury','Moon'];
  return order[(Math.floor(years/36)*4 + years%36)%7];
}
