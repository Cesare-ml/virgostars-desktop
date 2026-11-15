import {CommonModule} from '@angular/common';
import {
  ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject,
} from '@angular/core';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {findReturns} from './native/return-search';
import type {ReturnInstantV1, ReturnSearchResult} from './native/return-search-contract';
import {cleanChartName, parseDegreesMicro, type NewChartInput} from './new-chart-form';
import {
  formatReturnInstant, parseReturnYear, returnChartName, validTimeZone,
  type ReturnKind, type ReturnRadix,
} from './returns-form';
import {translate, type Locale, type MessageKey} from './translations';

const SEARCH_FAILURES: Record<Exclude<ReturnSearchResult['kind'], 'ready'>, MessageKey> = {
  not_native: 'calc.browser', provider_unavailable: 'calc.noprovider', invalid_request: 'calc.invalid',
  calculation_failed: 'calc.failed', unavailable: 'calc.failed',
};

export type ReturnChartRequest = Readonly<{input: NewChartInput; radixChartId: number; withRadix: boolean}>;

/**
 * Solar or lunar returns of one chart: pick a year and a place, list the
 * instants, cast a chart for one of them. The radix is fixed while the panel
 * is open, so several returns can be cast from the same list.
 */
@Component({
  selector: 'vs-returns-panel',
  standalone: true,
  imports: [CommonModule, OfflineCityPickerComponent],
  templateUrl: './returns-panel.component.html',
  styleUrls: ['./returns-panel.component.css'],
})
export class ReturnsPanelComponent implements OnChanges, OnDestroy {
  @Input() locale: Locale = 'it';
  @Input() kind: ReturnKind = 'solar';
  @Input({required: true}) radix!: ReturnRadix;
  @Input() busy = false;
  @Output() readonly chartRequested = new EventEmitter<ReturnChartRequest>();
  @Output() readonly closed = new EventEmitter<void>();
  private readonly cd = inject(ChangeDetectorRef);
  private searchTicket = 0;
  private destroyed = false;

  year = String(new Date().getUTCFullYear());
  latitude = '';
  longitude = '';
  timeZone = '';
  placeName = '';
  city: OfflinePlaceV1 | null = null;
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
      this.placeName = this.radix.placeName;
      this.city = null;
    }
    if (radixChanged || changes['kind']) this.clearResults();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.searchTicket++;
  }

  t(key: MessageKey): string { return translate(this.locale, key); }
  get titleKey(): MessageKey { return this.kind === 'solar' ? 'returns.solar' : 'returns.lunar'; }
  whenLabel(instant: ReturnInstantV1): string { return formatReturnInstant(instant.utcIso, this.timeZone.trim(), this.locale); }
  trackInstant(_index: number, instant: ReturnInstantV1): string { return instant.utcIso; }

  private clearResults(): void {
    this.searchTicket++;
    this.searching = false;
    this.searched = false;
    this.instants = [];
    this.message = null;
  }

  set(field: 'year' | 'latitude' | 'longitude' | 'timeZone', event: Event): void {
    this[field] = (event.target as HTMLInputElement).value;
    this.message = null;
    if (field === 'year') this.clearResults();
    if (field === 'latitude' || field === 'longitude') {
      this.city = null;
      this.placeName = '';
    }
  }

  toggleWithRadix(event: Event): void { this.withRadix = (event.target as HTMLInputElement).checked; }

  onCitySelected(place: OfflinePlaceV1): void {
    this.city = place;
    this.latitude = (place.latMicro / 1e6).toFixed(6);
    this.longitude = (place.lngMicro / 1e6).toFixed(6);
    if (place.timeZone) this.timeZone = place.timeZone;
    this.placeName = place.name;
    this.message = null;
    this.cd.markForCheck();
  }

  onCityEdited(): void {
    this.city = null;
    this.cd.markForCheck();
  }

  async search(): Promise<void> {
    if (this.searching) return;
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
    this.message = result.kind === 'ready' ? null : SEARCH_FAILURES[result.kind];
    this.cd.markForCheck();
  }

  /** Cast the chart of one return at the chosen place. */
  cast(instant: ReturnInstantV1): void {
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
      input: {
        name: returnChartName(this.kind, instant.utcIso, this.radix.name),
        utcIso: instant.utcIso, localDate: '', localTime: '', timeZone, offsetSeconds: 0,
        latMicro, lngMicro, placeName: cleanChartName(this.placeName),
      },
    });
  }
}
