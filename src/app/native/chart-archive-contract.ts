/**
 * Local chart archive contract shared with the Rust `chart_archive` command.
 * The archive stores what the user typed (name, instant, zone, position, place),
 * never calculated positions. It is encrypted on disk by the Rust host, which alone holds the
 * key; the WebView cannot choose where the file lives and never sees a path or a key.
 */
import type {HistoricalChartRequest} from './historical-chart-contract';
import {copyHistoricalChartRequest} from './historical-chart-validation.mjs';
export type ChartRecordV1 = Readonly<{
  id: string;
  name: string;
  utcIso: string;
  timeZone: string;
  latMicro: number;
  lngMicro: number;
  placeName: string;
  /** Explicit local-clock input; when present, UTC and zone are empty. */
  historical?: HistoricalChartRequest & Readonly<{protocolVersion: 1}>;
}>;

export type SavedChartV1 = ChartRecordV1 & Readonly<{createdAtMs: number; updatedAtMs: number; groups: readonly string[]}>;

export type ArchiveOperation =
  | Readonly<{operation: 'list'}>
  | Readonly<{operation: 'save'; chart: ChartRecordV1}>
  | Readonly<{operation: 'delete'; id: string}>
  | Readonly<{operation: 'photo_save'; id: string; photoData: readonly number[]}>
  | Readonly<{operation: 'photo_read' | 'photo_delete'; id: string}>
  | Readonly<{operation: 'set_groups'; id: string; groups: readonly string[]}>
  /** Deletes the old plain-text file of the first prototype, once its charts are in the encrypted archive. */
  | Readonly<{operation: 'remove_legacy'}>;

export type ArchiveFailure =
  | 'not_native' | 'invalid_request' | 'not_found' | 'archive_full'
  | 'archive_unavailable' | 'archive_corrupt' | 'archive_newer' | 'archive_locked' | 'photo_corrupt' | 'unavailable';

export type ArchiveResult =
  | Readonly<{kind: 'ready'; charts: readonly SavedChartV1[]; legacyPresent: boolean;
      photoIds: readonly string[]; photoData: readonly number[] | null}>
  | Readonly<{kind: ArchiveFailure}>;

type WireRequest = {protocolVersion: 1; operation: string; chart?: ChartRecordV1; id?: string; photoData?: readonly number[]; groups?: readonly string[]};

export interface ChartArchiveTransport {
  isNative(): boolean;
  invoke(command: 'chart_archive', args: {request: WireRequest}): Promise<unknown>;
}

const PROTOCOL_ERROR = 'Invalid chart archive protocol';
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
// Control characters and invisible direction/format marks never belong in a label.
const UNSAFE_TEXT = /[\p{Cc}​-‏‪-‮⁦-⁩﻿]/u;
const MAX_CHARTS = 5000;
export const MAX_PHOTO_BYTES = 220_000;
const FAILURES: readonly string[] = [
  'invalid_request', 'not_found', 'archive_full', 'archive_unavailable', 'archive_corrupt', 'archive_newer', 'archive_locked', 'photo_corrupt',
];

/** Photo transport accepts only a resized JPEG. No paths, EXIF, SVG or URLs cross IPC. */
export function validPhotoBytes(bytes: readonly number[]): boolean {
  if (!Array.isArray(bytes) || Object.getPrototypeOf(bytes) !== Array.prototype ||
      bytes.length < 8 || bytes.length > MAX_PHOTO_BYTES ||
      bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
      bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return false;
  return Object.keys(bytes).length === bytes.length && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255);
}

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

function label(x: unknown, maxLength: number): x is string {
  return typeof x === 'string' && [...x].length <= maxLength && x.trim() === x && !UNSAFE_TEXT.test(x);
}

function copyGroups(value: unknown): readonly string[] | null {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
      || value.length > 50 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result: string[] = [];
    for (let index = 0; index < value.length; index++) {
      const group = field(value, String(index));
      if (!label(group, 160) || !group || result.includes(group)) return null;
      result.push(group);
    }
    return Object.freeze(result);
  } catch { return null; }
}

function microDegrees(x: unknown, limit: number): x is number {
  return typeof x === 'number' && Number.isSafeInteger(x) && Math.abs(x) <= limit;
}

function validHistory(value:unknown, latMicro:number, lngMicro:number):boolean {
  if (!plainObject(value)) return false;
  const version=Object.getOwnPropertyDescriptor(value,'protocolVersion');
  const copy=copyHistoricalChartRequest(value);
  return !!version && version.enumerable === true && Object.hasOwn(version,'value') && version.value === 1 &&
    !!copy && copy.deltaT.kind !== 'espenakMeeus2006Unquantified' && copy.latMicro === latMicro && copy.lngMicro === lngMicro;
}

/** The same rules the Rust side enforces, checked before anything is sent. */
export function validChartRecord(chart: ChartRecordV1): boolean {
  return plainObject(chart) &&
    typeof chart.id === 'string' && ID_PATTERN.test(chart.id) &&
    label(chart.name, 80) && label(chart.placeName, 160) &&
    (chart.historical === undefined
      ? typeof chart.utcIso === 'string' && UTC_PATTERN.test(chart.utcIso) &&
        typeof chart.timeZone === 'string' && chart.timeZone.length <= 120 && ZONE_PATTERN.test(chart.timeZone)
      : chart.utcIso === '' && chart.timeZone === '' && validHistory(chart.historical, chart.latMicro, chart.lngMicro)) &&
    microDegrees(chart.latMicro, 90_000_000) && microDegrees(chart.lngMicro, 180_000_000);
}

function decodeSavedChart(raw: unknown, seen: Set<string>): SavedChartV1 {
  if (!plainObject(raw)) throw new Error(PROTOCOL_ERROR);
  const rawHistory = Object.hasOwn(raw, 'historical') ? field(raw, 'historical') : undefined;
  let historical:ChartRecordV1['historical'];
  if (rawHistory !== undefined) {
    if (!plainObject(rawHistory) || field(rawHistory,'protocolVersion') !== 1) throw new Error(PROTOCOL_ERROR);
    const copy=copyHistoricalChartRequest(rawHistory);
    if (!copy) throw new Error(PROTOCOL_ERROR);
    historical=Object.freeze({protocolVersion:1,...copy});
  }
  const chart: ChartRecordV1 = {
    id: field(raw, 'id') as string,
    name: field(raw, 'name') as string,
    utcIso: field(raw, 'utcIso') as string,
    timeZone: field(raw, 'timeZone') as string,
    latMicro: field(raw, 'latMicro') as number,
    lngMicro: field(raw, 'lngMicro') as number,
    placeName: field(raw, 'placeName') as string,
    ...(historical === undefined ? {} : {historical}),
  };
  const createdAtMs = field(raw, 'createdAtMs');
  const updatedAtMs = field(raw, 'updatedAtMs');
  const groups = copyGroups(Object.hasOwn(raw, 'groups') ? field(raw, 'groups') : []);
  if (!validChartRecord(chart) || seen.has(chart.id) ||
      !groups ||
      typeof createdAtMs !== 'number' || !Number.isSafeInteger(createdAtMs) || createdAtMs < 0 ||
      typeof updatedAtMs !== 'number' || !Number.isSafeInteger(updatedAtMs) || updatedAtMs < createdAtMs) {
    throw new Error(PROTOCOL_ERROR);
  }
  seen.add(chart.id);
  return Object.freeze({...chart, createdAtMs, updatedAtMs, groups});
}

type DecodedArchive =
  | Readonly<{status: 'ok'; charts: readonly SavedChartV1[]; legacyPresent: boolean;
      photoIds: readonly string[]; photoData: readonly number[] | null}>
  | Readonly<{status: Exclude<ArchiveFailure, 'not_native' | 'unavailable'>}>;

/** Detached, frozen values from one native response; throws a generic error otherwise. */
export function decodeArchiveResponse(raw: unknown): DecodedArchive {
  try {
    if (!plainObject(raw) || field(raw, 'protocolVersion') !== 1) throw new Error(PROTOCOL_ERROR);
    const status = field(raw, 'status');
    if (typeof status === 'string' && FAILURES.includes(status)) {
      return Object.freeze({status: status as Exclude<ArchiveFailure, 'not_native' | 'unavailable'>});
    }
    const charts = field(raw, 'charts');
    if (status !== 'ok' || !Array.isArray(charts) || Object.getPrototypeOf(charts) !== Array.prototype ||
        charts.length > MAX_CHARTS || Reflect.ownKeys(charts).length !== charts.length + 1) {
      throw new Error(PROTOCOL_ERROR);
    }
    const legacyPresent = field(raw, 'legacyPresent');
    if (typeof legacyPresent !== 'boolean') throw new Error(PROTOCOL_ERROR);
    const seen = new Set<string>();
    const decoded = Array.from({length: charts.length}, (_, index) => decodeSavedChart(field(charts, String(index)), seen));
    const rawIds = Object.hasOwn(raw, 'photoIds') ? field(raw, 'photoIds') : [];
    if (!Array.isArray(rawIds) || rawIds.length > MAX_CHARTS ||
        Object.getPrototypeOf(rawIds) !== Array.prototype || Object.keys(rawIds).length !== rawIds.length ||
        !rawIds.every(id => typeof id === 'string' && ID_PATTERN.test(id) && seen.has(id)) ||
        new Set(rawIds).size !== rawIds.length) throw new Error(PROTOCOL_ERROR);
    const rawPhoto = Object.hasOwn(raw, 'photoData') ? field(raw, 'photoData') : null;
    if (rawPhoto !== null && !validPhotoBytes(rawPhoto as number[])) throw new Error(PROTOCOL_ERROR);
    return Object.freeze({status: 'ok', charts: Object.freeze(decoded), legacyPresent,
      photoIds:Object.freeze([...rawIds] as string[]), photoData:rawPhoto ? Object.freeze([...(rawPhoto as number[])]) : null});
  } catch {
    // Never surface native details, accessor or Proxy trap messages.
    throw new Error(PROTOCOL_ERROR);
  }
}

function wireRequest(operation: ArchiveOperation): WireRequest | null {
  if (!plainObject(operation)) return null;
  if (operation.operation === 'list') return {protocolVersion: 1, operation: 'list'};
  if (operation.operation === 'remove_legacy') return {protocolVersion: 1, operation: 'remove_legacy'};
  if (operation.operation === 'save' && validChartRecord(operation.chart)) {
    const {id, name, utcIso, timeZone, latMicro, lngMicro, placeName, historical} = operation.chart;
    const copy = historical ? copyHistoricalChartRequest(historical) : null;
    if (historical && !copy) return null;
    return {protocolVersion: 1, operation: 'save', chart: {id, name, utcIso, timeZone, latMicro, lngMicro, placeName,
      ...(copy === null ? {} : {historical:{protocolVersion:1,...copy}})}};
  }
  if (operation.operation === 'delete' && typeof operation.id === 'string' && ID_PATTERN.test(operation.id)) {
    return {protocolVersion: 1, operation: 'delete', id: operation.id};
  }
  if (operation.operation === 'photo_save' && typeof operation.id === 'string' && ID_PATTERN.test(operation.id) &&
      validPhotoBytes(operation.photoData)) {
    return {protocolVersion: 1, operation: 'photo_save', id:operation.id, photoData:[...operation.photoData]};
  }
  if ((operation.operation === 'photo_read' || operation.operation === 'photo_delete') &&
      typeof operation.id === 'string' && ID_PATTERN.test(operation.id)) {
    return {protocolVersion: 1, operation:operation.operation, id:operation.id};
  }
  if (operation.operation === 'set_groups' && typeof operation.id === 'string' && ID_PATTERN.test(operation.id)) {
    const groups = copyGroups(operation.groups);
    return groups ? {protocolVersion: 1, operation: 'set_groups', id: operation.id, groups} : null;
  }
  return null;
}

/** One native call per operation; every failure is reduced to a small set of states. */
export async function requestArchive(
  transport: ChartArchiveTransport,
  operation: ArchiveOperation,
): Promise<ArchiveResult> {
  const request = wireRequest(operation);
  if (!request) return {kind: 'invalid_request'};
  try {
    if (!transport.isNative()) return {kind: 'not_native'};
    const decoded = decodeArchiveResponse(await transport.invoke('chart_archive', {request}));
    return decoded.status === 'ok'
      ? {kind: 'ready', charts: decoded.charts, legacyPresent: decoded.legacyPresent,
          photoIds:decoded.photoIds, photoData:decoded.photoData}
      : {kind: decoded.status};
  } catch {
    return {kind: 'unavailable'};
  }
}

/** Stable identity for a chart, created once when it is first saved. */
export function newChartId(randomUuid: () => string = () => globalThis.crypto.randomUUID()): string {
  const id = String(randomUuid()).toLowerCase();
  if (!ID_PATTERN.test(id)) throw new Error('Invalid chart id source');
  return id;
}
