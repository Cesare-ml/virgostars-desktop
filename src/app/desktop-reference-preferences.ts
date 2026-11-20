import type {UiPreferencesStorage} from './ui-preferences';
const DEFAULT_SKY_PLACE:ReferencePlace = Object.freeze({name:'Roma',latMicro:41_893_000,lngMicro:12_483_000,timeZone:'Europe/Rome'});

export type ReferencePlace = Readonly<{name:string; latMicro:number; lngMicro:number; timeZone:string}>;
export type AccountChartReference = Readonly<{source:'local'|'synced'; id:string}>;
export const REFERENCE_PLACE_KEY = 'virgostars.desktop.reference-place.v1';
export const ACCOUNT_CHART_KEY = 'virgostars.desktop.account-chart.v1';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validReferencePlace(value:unknown): value is ReferencePlace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const place=value as Record<string,unknown>;
  if (typeof place.name!=='string' || !place.name.trim() || place.name.length>160 || /[\u0000-\u001f\u007f]/.test(place.name) ||
      !Number.isSafeInteger(place.latMicro) || Math.abs(place.latMicro as number)>90_000_000 ||
      !Number.isSafeInteger(place.lngMicro) || Math.abs(place.lngMicro as number)>180_000_000 ||
      typeof place.timeZone!=='string' || place.timeZone.length>120) return false;
  try { new Intl.DateTimeFormat('en',{timeZone:place.timeZone}); return true; } catch { return false; }
}

export function loadReferencePlace(storage:UiPreferencesStorage|null):ReferencePlace {
  try { const raw=storage?.getItem(REFERENCE_PLACE_KEY); if (raw && raw.length<=1000) {
    const value:unknown=JSON.parse(raw); if (validReferencePlace(value)) return Object.freeze({...value});
  }} catch { /* use fallback */ }
  return DEFAULT_SKY_PLACE;
}
export function saveReferencePlace(storage:UiPreferencesStorage|null, place:ReferencePlace):boolean {
  try { if (!storage || !validReferencePlace(place)) return false; storage.setItem(REFERENCE_PLACE_KEY,JSON.stringify(place)); return true; } catch { return false; }
}
export function loadAccountChart(storage:UiPreferencesStorage|null):AccountChartReference|null {
  try { const raw=storage?.getItem(ACCOUNT_CHART_KEY); if (!raw || raw.length>200) return null;
    const value=JSON.parse(raw); return value && (value.source==='local'||value.source==='synced') && typeof value.id==='string' && ID.test(value.id)
      ? Object.freeze({source:value.source,id:value.id}) : null;
  } catch { return null; }
}
export function saveAccountChart(storage:UiPreferencesStorage|null, reference:AccountChartReference|null):boolean {
  try { if (!storage || reference && (!['local','synced'].includes(reference.source) || !ID.test(reference.id))) return false;
    storage.setItem(ACCOUNT_CHART_KEY,JSON.stringify(reference)); return true;
  } catch { return false; }
}
