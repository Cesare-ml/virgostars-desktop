/** Recorded-event IPC: the host controls archive paths and verifies its digest. */
export type SynodRecord = Readonly<{body:string; startMillis:number | null; phase:string | null; phaseStatus:string | null; phaseStartsMillis:readonly [number,number,number,number] | null}>;
export type SynodResult = Readonly<{kind:'ready'; records:readonly SynodRecord[]}> |
  Readonly<{kind:'not_native'|'archive_missing'|'archive_invalid'|'invalid_request'|'unavailable'}>;
export interface SynodTransport {
  isNative(): boolean;
  invoke(command:'synod_events', args:{request:{protocolVersion:1; utcMicros:number}}): Promise<unknown>;
}
export async function requestSynods(port:SynodTransport, utcMs:number): Promise<SynodResult> {
  // The navigator supports years 1–3000. Millisecond instants within this
  // interval can be represented exactly as integer multiples of 1000 µs.
  if (!Number.isSafeInteger(utcMs) || utcMs < -62_135_596_800_000 || utcMs >= 32_535_216_000_000 ||
      BigInt(utcMs*1000)!==BigInt(utcMs)*1000n) return {kind:'invalid_request'};
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
      const starts=r['phaseStartsMillis'];
      if (!(starts===undefined || starts===null || (Array.isArray(starts) && starts.length===4 && starts.every((value,index)=>
        Number.isSafeInteger(value) && Math.abs(value)<=8_640_000_000_000_000 && (index===0 || value>starts[index-1])) && starts[0]===r['startMillis']))) return {kind:'unavailable'};
      seen.add(r['body']);
      records.push({body:r['body'], startMillis:r['startMillis'] as number|null, phase:r['phase'] as string|null, phaseStatus:r['phaseStatus'] as string|null,
        phaseStartsMillis:Array.isArray(starts) ? [starts[0],starts[1],starts[2],starts[3]] : null});
    }
    return {kind:'ready', records};
  } catch { return {kind:'unavailable'}; }
}
