import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output, inject} from '@angular/core';
import {isTauri} from '@tauri-apps/api/core';
import {normalizeCurrentCoordinates} from './current-location';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import {resolveCivilTime, type CivilTimeChoice} from './native/civil-time';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {
  MAX_CHART_NAME_LENGTH, cleanChartName, formatUtcOffset, parseDegreesMicro, resolveNewChart,
  type NewChartInput, type NewChartProblem,
} from './new-chart-form';
import {translate, type Locale, type MessageKey} from './translations';

const PROBLEM_KEYS: Record<NewChartProblem, MessageKey> = {
  date_invalid: 'problem.date', time_invalid: 'problem.time', zone_invalid: 'problem.zone',
  zone_unavailable: 'problem.zoneUnavailable', latitude_invalid: 'problem.latitude',
  longitude_invalid: 'problem.longitude', time_nonexistent: 'problem.nonexistent',
};

function hostTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/**
 * Birth data entry. Values stay in this component's memory until submitted,
 * then travel to the parent as one validated object. Nothing is persisted.
 */
@Component({
  selector: 'vs-new-chart',
  standalone: true,
  imports: [CommonModule, OfflineCityPickerComponent],
  templateUrl: './new-chart.component.html',
  styleUrls: ['./new-chart.component.css'],
})
export class NewChartComponent implements OnInit, OnDestroy {
  @Input() locale: Locale = 'it';
  @Input() autoLocateCurrentSky = false;
  @Input() busy = false;
  @Output() readonly chartRequested = new EventEmitter<NewChartInput>();
  @Output() readonly autoLocationCheckStarted = new EventEmitter<void>();
  private readonly cd = inject(ChangeDetectorRef);
  private destroyed = false;
  private locationRequest = 0;

  readonly maxNameLength = MAX_CHART_NAME_LENGTH;
  name = '';
  date = '';
  time = '12:00';
  timeZone = hostTimeZone();
  latitude = '';
  longitude = '';
  placeName = '';
  city: OfflinePlaceV1 | null = null;
  problem: NewChartProblem | null = null;
  choices: readonly CivilTimeChoice[] = [];
  locationMessage: MessageKey | null = null;
  locationPending = false;

  t(key: MessageKey): string { return translate(this.locale, key); }

  ngOnInit(): void {
    if (!this.autoLocateCurrentSky) return;
    this.autoLocationCheckStarted.emit();
    // Reuse only an earlier explicit WebView grant. First-run users press the
    // location button below; there is no silent first-run location request.
    void this.resumePreviouslyGrantedLocation();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.locationRequest++;
  }

  private async resumePreviouslyGrantedLocation(): Promise<void> {
    if (!isTauri() || !this.isLocationApiReady() || !navigator.permissions?.query) return;
    try {
      const permission = await navigator.permissions.query({name: 'geolocation'});
      if (this.destroyed) return;
      if (permission.state === 'granted') this.requestCurrentLocation();
      else if (permission.state === 'denied') this.locationMessage = 'location.denied';
      else this.locationMessage = 'location.choose';
      this.cd.markForCheck();
    } catch {
      if (!this.destroyed) {
        this.locationMessage = 'location.choose';
        this.cd.markForCheck();
      }
    }
  }

  private isLocationApiReady(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext === true &&
      typeof navigator !== 'undefined' && !!navigator.geolocation;
  }

  /** Explicit one-shot device location request; coordinates remain in this form's memory. */
  requestCurrentLocation(): void {
    if (this.busy || this.destroyed || this.locationPending) return;
    const request = ++this.locationRequest;
    if (!this.isLocationApiReady()) {
      this.locationMessage = typeof window !== 'undefined' && !window.isSecureContext
        ? 'location.secure' : 'location.unavailable';
      this.cd.markForCheck();
      return;
    }
    this.locationPending = true;
    this.locationMessage = 'location.requesting';
    this.cd.markForCheck();
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (this.destroyed || request !== this.locationRequest) return;
        const coordinates = normalizeCurrentCoordinates(position.coords.latitude, position.coords.longitude);
        if (!coordinates) {
          this.locationPending = false;
          this.locationMessage = 'location.invalid';
          this.cd.markForCheck();
          return;
        }
        this.latitude = (coordinates.latMicro / 1e6).toFixed(6);
        this.longitude = (coordinates.lngMicro / 1e6).toFixed(6);
        this.timeZone = hostTimeZone();
        this.placeName = this.t('location.currentName');
        this.city = null;
        this.problem = null;
        this.choices = [];
        this.locationPending = false;
        this.locationMessage = 'location.success';
        this.submitNow();
        this.cd.markForCheck();
      }, error => {
        if (this.destroyed || request !== this.locationRequest) return;
        this.locationPending = false;
        this.locationMessage = error.code === 1 ? 'location.denied' :
          error.code === 3 ? 'location.timeout' : 'location.unavailable';
        this.cd.markForCheck();
      }, {enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000});
    } catch {
      if (!this.destroyed && request === this.locationRequest) {
        this.locationPending = false;
        this.locationMessage = 'location.unavailable';
        this.cd.markForCheck();
      }
    }
  }
  get problemText(): string { return this.problem ? this.t(PROBLEM_KEYS[this.problem]) : ''; }
  offsetLabel(choice: CivilTimeChoice): string { return 'UTC' + formatUtcOffset(choice.offsetSeconds); }

  set(field: 'name' | 'date' | 'time' | 'timeZone' | 'latitude' | 'longitude', event: Event): void {
    this[field] = (event.target as HTMLInputElement).value;
    // Any edit invalidates an earlier daylight-saving choice and message.
    this.problem = null;
    this.choices = [];
    if (field === 'latitude' || field === 'longitude') {
      this.city = null;
      this.placeName = '';
    }
  }

  onCitySelected(place: OfflinePlaceV1): void {
    this.city = place;
    this.latitude = (place.latMicro / 1e6).toFixed(6);
    this.longitude = (place.lngMicro / 1e6).toFixed(6);
    if (place.timeZone) this.timeZone = place.timeZone;
    this.placeName = place.name;
    this.problem = null;
    this.choices = [];
    this.cd.markForCheck();
  }

  onCityEdited(): void {
    this.city = null;
    this.cd.markForCheck();
  }

  submit(selectedUtc: string | null = null): void {
    if (this.busy) return;
    const result = resolveNewChart({
      name: this.name, date: this.date, time: this.time, timeZone: this.timeZone,
      latitude: this.latitude, longitude: this.longitude, placeName: this.placeName,
    }, resolveCivilTime, selectedUtc);
    this.problem = result.status === 'problem' ? result.problem : null;
    this.choices = result.status === 'choice_required' ? result.choices : [];
    if (result.status === 'ready') this.chartRequested.emit(result.input);
    this.cd.markForCheck();
  }

  /** Chart of this very moment at the entered place; the date fields are ignored. */
  submitNow(): void {
    if (this.busy) return;
    this.choices = [];
    const latMicro = parseDegreesMicro(this.latitude, 90);
    const lngMicro = parseDegreesMicro(this.longitude, 180);
    this.problem = latMicro === null ? 'latitude_invalid' : lngMicro === null ? 'longitude_invalid' : null;
    if (latMicro !== null && lngMicro !== null) {
      this.chartRequested.emit({
        name: cleanChartName(this.name), utcIso: new Date().toISOString(),
        localDate: '', localTime: '', timeZone: this.timeZone.trim() || 'UTC', offsetSeconds: 0,
        latMicro, lngMicro, placeName: cleanChartName(this.placeName), liveNow: true,
      });
    }
    this.cd.markForCheck();
  }
}
