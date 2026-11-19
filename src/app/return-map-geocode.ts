/** A deliberately user-triggered reverse lookup, never used on pointer movement. */
export class ReturnMapGeocoder {
  private lastRequest = 0;
  private readonly cache = new Map<string,string>();

  async lookup(latMicro:number, lngMicro:number, signal:AbortSignal):Promise<string> {
    if (!Number.isSafeInteger(latMicro) || !Number.isSafeInteger(lngMicro) ||
        Math.abs(latMicro)>90_000_000 || Math.abs(lngMicro)>180_000_000) return '';
    const key = `${latMicro},${lngMicro}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    // The public service limits requests to at most one per second. Never queue
    // or retry: a second quick click simply uses coordinates without a name.
    const now = Date.now();
    if (now-this.lastRequest < 1200) return '';
    this.lastRequest = now;
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({format:'jsonv2', lat:String(latMicro/1e6), lon:String(lngMicro/1e6)}).toString();
    try {
      const response = await fetch(url, {signal, credentials:'omit', redirect:'error'});
      if (!response.ok || Number(response.headers.get('content-length') || 0)>65536) return '';
      const text = await response.text();
      if (text.length>65536) return '';
      const data:unknown = JSON.parse(text);
      if (!data || typeof data !== 'object') return '';
      const obj = data as {address?:Record<string,unknown>; display_name?:unknown};
      const address = obj.address && typeof obj.address === 'object' ? obj.address : {};
      const city = [address['city'],address['town'],address['village']].find(x => typeof x === 'string' && x.trim());
      const country = typeof address['country'] === 'string' ? address['country'] : '';
      const name = (typeof city === 'string' ? [city,country].filter(Boolean).join(', ') :
        typeof obj.display_name === 'string' ? obj.display_name : '').slice(0,160);
      if (name) { if (this.cache.size>=100) this.cache.clear(); this.cache.set(key,name); }
      return name;
    } catch { return ''; }
  }
}
