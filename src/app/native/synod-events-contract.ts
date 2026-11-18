/** Recorded-event IPC: the host controls archive paths and verifies its digest. */
export type SynodRecord = Readonly<{body:string; startMillis:number | null; phase:string | null; phaseStatus:string | null}>;
export type SynodResult = Readonly<{kind:'ready'; records:readonly SynodRecord[]}> |
  Readonly<{kind:'not_native'|'archive_missing'|'archive_invalid'|'invalid_request'|'unavailable'}>;
export interface SynodTransport {
  isNative(): boolean;
  invoke(command:'synod_events', args:{request:{protocolVersion:1; utcMicros:number}}): Promise<unknown>;
}
export async function requestSynods(port:SynodTransport, utcMs:number): Promise<SynodResult> {
  if (!Number.isSafeInteger(utcMs) || utcMs < -2_208_988_800_000 || utcMs >= 2_019_686_400_000) return {kind:'invalid_request'};
  if (!port.isNative()) return {kind:'not_native'};
  try {
    const raw = await port.invoke('synod_events', {request:{protocolVersion:1, utcMicros:utcMs*1000}});
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {kind:'unavailable'};
    const data = raw as Record<string,unknown>;
    if (data['protocolVersion'] !== 1 || !Array.isArray(data['records']) || data['records'].length > 128) return {kind:'unavailable'};
    if (data['status'] !== 'ok') {
      const status = data['status'];
      return {kind:status === 'archive_missing' || status === 'archive_invalid' || status === 'invalid_request' ? status : 'unavailable'};
    }
    const records: SynodRecord[] = [];
    const seen = new Set<string>();
    for (const item of data['records']) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return {kind:'unavailable'};
      const r = item as Record<string,unknown>;
      if (typeof r['body'] !== 'string' || r['body'].length < 1 || r['body'].length > 80 || /[\x00-\x1f\x7f]/.test(r['body']) || seen.has(r['body']) ||
        !(r['startMillis'] === null || (Number.isSafeInteger(r['startMillis']) && (r['startMillis'] as number) <= utcMs && (r['startMillis'] as number) >= -8_640_000_000_000_000)) ||
        !(r['phase'] === null || (typeof r['phase'] === 'string' && /^[A-Z0-9]{1,16}$/.test(r['phase']))) ||
        !(r['phaseStatus'] === null || (typeof r['phaseStatus'] === 'string' && /^[a-z_]{1,80}$/.test(r['phaseStatus'])))) return {kind:'unavailable'};
      seen.add(r['body']);
      records.push({body:r['body'], startMillis:r['startMillis'] as number|null, phase:r['phase'] as string|null, phaseStatus:r['phaseStatus'] as string|null});
    }
    return {kind:'ready', records};
  } catch { return {kind:'unavailable'}; }
}
