import {CommonModule} from '@angular/common';
import {SolarReturnStripComponent, type SolarReturnStripData} from 'grafici-astrologici';
import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject,
} from '@angular/core';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {findReturns} from './native/return-search';
import {calculateChart} from './native/chart-calculation';
import type {ChartCalculationResult, HouseSystemId} from './native/chart-calculation-contract';
import {buildTemaRenderData, formatLongitudeDms} from './astro/tema-render-data';
import {addExtraHouses} from './astro/extra-houses';
import type {ReturnInstantV1, ReturnSearchResult} from './native/return-search-contract';
import {cleanChartName, parseDegreesMicro, type NewChartInput} from './new-chart-form';
import {
  formatReturnInstant, nextReturnAfter, parseReturnYear, returnChartName, suggestReturnTimeZone, validTimeZone,
  type ReturnKind, type ReturnRadix,
} from './returns-form';
import {translate, type Locale, type MessageKey} from './translations';
import {celestialGlyphUrl, zodiacGlyphUrl} from './astrological-glyphs';
import {ReturnOsmMapComponent, type ReturnMapPoint} from './return-osm-map.component';
import {ReturnMapGeocoder} from './return-map-geocode';

const SEARCH_FAILURES: Record<Exclude<ReturnSearchResult['kind'], 'ready'>, MessageKey> = {
  not_native: 'calc.browser', provider_unavailable: 'calc.noprovider', invalid_request: 'calc.invalid',
  calculation_failed: 'calc.failed', unavailable: 'calc.failed',
};
const PREVIEW_FAILURES: Record<Exclude<ChartCalculationResult['kind'], 'ready'>, MessageKey> = {
  ...SEARCH_FAILURES, out_of_range:'calc.range',
};

export type ReturnChartRequest = Readonly<{input: NewChartInput; radixChartId: number; withRadix: boolean; keepMapOpen?:boolean}>;

/**
 * Solar or lunar returns of one chart: pick a year and a place, list the
 * instants, cast a chart for one of them. The radix is fixed while the panel
 * is open, so several returns can be cast from the same list.
 */
@Component({
  selector: 'vs-returns-panel',
  standalone: true,
  imports: [CommonModule, OfflineCityPickerComponent, SolarReturnStripComponent, ReturnOsmMapComponent],
  templateUrl: './returns-panel.component.html',
  styleUrls: ['./returns-panel.component.css'],
})
export class ReturnsPanelComponent implements OnChanges, OnDestroy {
  @Input() locale: Locale = 'it';
  @Input() kind: ReturnKind = 'solar';
  @Input({required: true}) radix!: ReturnRadix;
  @Input() busy = false;
  @Input() houseSystem: HouseSystemId = 'egizia';
  @Output() readonly chartRequested = new EventEmitter<ReturnChartRequest>();
  @Output() readonly closed = new EventEmitter<void>();
  private readonly cd = inject(ChangeDetectorRef);
  private searchTicket = 0;
  private destroyed = false;
  private previewTicket = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewBusy = false;
  private pendingPreview: {ticket:number; utcIso:string; latMicro:number; lngMicro:number} | null = null;
  private readonly geocoder = new ReturnMapGeocoder();
  private geocodeAbort:AbortController | null = null;
  private selectionTicket = 0;

  year = String(new Date().getUTCFullYear());
  latitude = '';
  longitude = '';
  timeZone = '';
  timeZoneSuggested = false;
  placeName = '';
  city: OfflinePlaceV1 | null = null;
  mapCenter:ReturnMapPoint = {latMicro:41_899_200,lngMicro:12_545_000};
  hoverPoint:ReturnMapPoint | null = null;
  previewInstant: string | null = null;
  preview: {latMicro:number; lngMicro:number; ascendant:number; mc:number; ds:number; ic:number; cusps:readonly number[];
    planets:readonly {name:string; longitude:number; glyphUrl:string}[]} | null = null;
  previewMessage: MessageKey | null = null;
  withRadix = true;
  searching = false;
  searched = false;
  message: MessageKey | null = null;
  instants: readonly ReturnInstantV1[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    const radixChanged = changes['radix'] &&
      (changes['radix'].previousValue as ReturnRadix | undefined)?.chartId !== this.radix.chartId;
    if (radixChanged) {
      // A return is cast for the radix place unless the user relocates it.
      this.latitude = (this.radix.latMicro / 1e6).toFixed(6);
      this.longitude = (this.radix.lngMicro / 1e6).toFixed(6);
      this.timeZone = this.radix.timeZone;
      this.timeZoneSuggested = false;
      this.placeName = this.radix.placeName;
      this.city = null;
      this.mapCenter = {latMicro:this.radix.latMicro,lngMicro:this.radix.lngMicro};
    }
    if (radixChanged || changes['kind']) {
      this.clearResults();
      if (this.kind === 'solar') void this.searchNextSolarReturn();
    }
    else if (changes['houseSystem']) this.invalidatePreview();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this.searchTicket++;
    this.invalidatePreview();
  }

  t(key: MessageKey): string { return translate(this.locale, key); }
  get titleKey(): MessageKey { return this.kind === 'solar' ? 'returns.solar' : 'returns.lunar'; }
  whenLabel(instant: ReturnInstantV1): string { return formatReturnInstant(instant.utcIso, this.timeZone.trim(), this.locale); }
  trackInstant(_index: number, instant: ReturnInstantV1): string { return instant.utcIso; }

  private clearResults(): void {
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this.searchTicket++;
    this.invalidatePreview();
    this.previewInstant = null;
    this.searching = false;
    this.searched = false;
    this.instants = [];
    this.message = null;
  }

  set(field: 'year' | 'latitude' | 'longitude' | 'timeZone', event: Event): void {
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this[field] = (event.target as HTMLInputElement).value;
    this.message = null;
    if (field === 'year') this.clearResults();
    if (field === 'latitude' || field === 'longitude') {
      this.city = null;
      this.placeName = '';
      this.timeZone = '';
      this.timeZoneSuggested = false;
    }
    if (field === 'timeZone') this.timeZoneSuggested = false;
  }

  toggleWithRadix(event: Event): void { this.withRadix = (event.target as HTMLInputElement).checked; }

  async selectOnlinePoint(coordinates:ReturnMapPoint):Promise<void> {
    this.geocodeAbort?.abort();
    const ticket = ++this.selectionTicket;
    const abort = this.geocodeAbort = new AbortController();
    this.applyMapPoint(coordinates);
    const timer = setTimeout(() => abort.abort(), 4000);
    const place = await this.geocoder.lookup(coordinates.latMicro, coordinates.lngMicro, abort.signal);
    clearTimeout(timer);
    if (this.destroyed || ticket !== this.selectionTicket) return;
    this.placeName = place;
    if (!place) this.message = 'returns.map.noPlace';
    this.cd.markForCheck();
    if (place) this.castSelectedReturn();
  }

  private applyMapPoint(coordinates:ReturnMapPoint):void {
    this.latitude = (coordinates.latMicro / 1e6).toFixed(6);
    this.longitude = (coordinates.lngMicro / 1e6).toFixed(6);
    this.city = null;
    this.placeName = '';
    // The offline boundary database is approximate; the user can edit the result.
    this.timeZone = suggestReturnTimeZone(coordinates.latMicro, coordinates.lngMicro) ?? '';
    this.timeZoneSuggested = this.timeZone !== '';
    this.message = null;
    this.cd.markForCheck();
  }
  castSelectedReturn():void {
    const selected = this.instants.find(instant => instant.utcIso === this.previewInstant);
    if (selected && this.timeZone) this.cast(selected);
  }

  private invalidatePreview(): void {
    this.previewTicket++;
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.pendingPreview = null;
    this.preview = null;
    this.previewMessage = null;
  }
  setPreviewInstant(instant: ReturnInstantV1): void {
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this.invalidatePreview();
    this.previewInstant = instant.utcIso;
    this.cd.markForCheck();
  }
  previewCoordinates(coordinates:ReturnMapPoint):void {
    if (!this.previewInstant || this.destroyed) return;
    this.hoverPoint = coordinates;
    this.previewTicket++;
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.pendingPreview = null;
    this.previewMessage = null;
    const request = {ticket:this.previewTicket, utcIso:this.previewInstant, ...coordinates};
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.pendingPreview = request;
      void this.runMapPreview();
    }, 350);
  }
  private async runMapPreview(): Promise<void> {
    if (this.previewBusy || !this.pendingPreview || this.destroyed) return;
    const request = this.pendingPreview;
    this.pendingPreview = null;
    this.previewBusy = true;
    const result = await calculateChart({utcIso:request.utcIso, latMicro:request.latMicro, lngMicro:request.lngMicro});
    const data = result.kind === 'ready' ? buildTemaRenderData(result.chart, request.utcIso) : null;
    if (data && result.kind === 'ready') await addExtraHouses(data, result.chart, result.provider,
      request.utcIso, request.latMicro, request.lngMicro);
    this.previewBusy = false;
    if (!this.destroyed && request.ticket === this.previewTicket) {
      const house = data?.houses[this.houseSystem];
      if (house && data) this.preview = {latMicro:request.latMicro, lngMicro:request.lngMicro,
        ascendant:house.ascendant, mc:house.mc, ds:house.ds, ic:house.ic, cusps:house.house,
        planets:['Moon','Mercury','Venus','Sun','Mars','Jupiter','Saturn','true Node','osc. Apogee','osc. Perigee']
          .flatMap(name => { const planet=data.planets[name]; return planet ? [{name, longitude:planet.longitude,
            glyphUrl:celestialGlyphUrl(name, planet.longitudeSpeed < 0)}] : []; })};
      else this.previewMessage = result.kind === 'ready' ? 'calc.nohouses' : PREVIEW_FAILURES[result.kind];
      this.cd.markForCheck();
    }
    if (!this.destroyed && this.pendingPreview) void this.runMapPreview();
  }
  previewLongitude(value: number): string { return formatLongitudeDms(value, this.locale); }
  get previewStrip():SolarReturnStripData | null {
    const p=this.preview, radix=this.radix.houseSets?.[this.houseSystem];
    if (!p || !radix) return null;
    const names:MessageKey[]=['sign.aries','sign.taurus','sign.gemini','sign.cancer','sign.leo','sign.virgo',
      'sign.libra','sign.scorpio','sign.sagittarius','sign.capricorn','sign.aquarius','sign.pisces'];
    return {radixCusps:radix.house, returnCusps:p.cusps,
      axes:[{name:'ASC',longitude:p.ascendant},{name:'MC',longitude:p.mc},{name:'DS',longitude:p.ds},{name:'IC',longitude:p.ic}],
      planets:p.planets, signs:names.map((name,i)=>({name:this.t(name),glyphUrl:zodiacGlyphUrl(i)}))};
  }

  onCitySelected(place: OfflinePlaceV1): void {
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this.city = place;
    this.latitude = (place.latMicro / 1e6).toFixed(6);
    this.longitude = (place.lngMicro / 1e6).toFixed(6);
    this.timeZone = place.timeZone || suggestReturnTimeZone(place.latMicro, place.lngMicro) || '';
    this.timeZoneSuggested = !place.timeZone && this.timeZone !== '';
    this.placeName = place.name;
    this.mapCenter = {latMicro:place.latMicro,lngMicro:place.lngMicro};
    if (this.kind === 'solar') this.previewCoordinates(this.mapCenter);
    this.message = null;
    this.cd.markForCheck();
  }

  onCityEdited(): void {
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    this.city = null;
    this.cd.markForCheck();
  }

  async search(): Promise<void> {
    if (this.searching) return;
    this.selectionTicket++;
    this.geocodeAbort?.abort();
    const year = parseReturnYear(this.year);
    if (year === null) {
      this.message = 'returns.year.invalid';
      return;
    }
    const ticket = ++this.searchTicket;
    this.searching = true;
    this.message = null;
    this.cd.markForCheck();
    const result = await findReturns({
      body: this.kind === 'solar' ? 'Sun' : 'Moon',
      targetLongitudeDeg: this.kind === 'solar' ? this.radix.sunLongitude : this.radix.moonLongitude,
      year,
    });
    // Only the latest search for the current radix, kind and year may answer.
    if (this.destroyed || ticket !== this.searchTicket) return;
    this.searching = false;
    this.searched = result.kind === 'ready';
    this.instants = result.kind === 'ready' ? result.instants : [];
    this.previewInstant = this.instants[0]?.utcIso ?? null;
    this.message = result.kind === 'ready' ? null : SEARCH_FAILURES[result.kind];
    if (this.kind === 'solar' && this.previewInstant) this.previewCoordinates(this.mapCenter);
    this.cd.markForCheck();
  }

  /** Search the current and next UTC year; do not choose an already elapsed return. */
  private async searchNextSolarReturn():Promise<void> {
    const ticket = ++this.searchTicket, now = Date.now(), year = new Date(now).getUTCFullYear();
    this.searching = true;
    for (const candidate of [year,year+1]) {
      if (candidate>2400) break;
      const result = await findReturns({body:'Sun',targetLongitudeDeg:this.radix.sunLongitude,year:candidate});
      if (this.destroyed || ticket!==this.searchTicket) return;
      if (result.kind !== 'ready') { this.searching=false; this.message=SEARCH_FAILURES[result.kind]; this.cd.markForCheck(); return; }
      const next = nextReturnAfter(result.instants,now);
      if (next) {
        this.year=String(candidate); this.instants=result.instants; this.previewInstant=next.utcIso;
        this.searching=false; this.searched=true; this.message=null;
        this.previewCoordinates(this.mapCenter);
        this.cast(next, true);
        this.cd.markForCheck(); return;
      }
    }
    this.searching=false; this.searched=true; this.message=null; this.cd.markForCheck();
  }

  /** Cast the chart of one return at the chosen place. */
  cast(instant: ReturnInstantV1, keepMapOpen = false): void {
    if (this.busy) return;
    const latMicro = parseDegreesMicro(this.latitude, 90);
    const lngMicro = parseDegreesMicro(this.longitude, 180);
    const timeZone = this.timeZone.trim();
    this.message = latMicro === null ? 'problem.latitude' : lngMicro === null ? 'problem.longitude'
      : !validTimeZone(timeZone) ? 'problem.zone' : null;
    if (latMicro === null || lngMicro === null || this.message) return;
    this.chartRequested.emit({
      radixChartId: this.radix.chartId,
      withRadix: this.withRadix,
      ...(keepMapOpen ? {keepMapOpen:true} : {}),
      input: {
        name: returnChartName(this.kind, instant.utcIso, this.radix.name),
        utcIso: instant.utcIso, localDate: '', localTime: '', timeZone, offsetSeconds: 0,
        latMicro, lngMicro, placeName: cleanChartName(this.placeName),
      },
    });
  }
}
