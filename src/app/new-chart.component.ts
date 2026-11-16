import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, Output, inject} from '@angular/core';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import {resolveCivilTime, type CivilTimeChoice} from './native/civil-time';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {
  MAX_CHART_NAME_LENGTH, cleanChartName, formatUtcOffset, resolveNewChart, resolveNowChart,
  type NewChartInput, type NewChartProblem,
} from './new-chart-form';
import {translate, type Locale, type MessageKey} from './translations';

const PROBLEM_KEYS: Record<NewChartProblem, MessageKey> = {
  date_invalid: 'problem.date', time_invalid: 'problem.time', zone_invalid: 'problem.zone',
  zone_unavailable: 'problem.zoneUnavailable', latitude_invalid: 'problem.latitude',
  longitude_invalid: 'problem.longitude', time_nonexistent: 'problem.nonexistent',
  instant_unavailable: 'problem.instantUnavailable',
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
export class NewChartComponent {
  @Input() locale: Locale = 'it';
  @Input() busy = false;
  @Output() readonly chartRequested = new EventEmitter<NewChartInput>();
  private readonly cd = inject(ChangeDetectorRef);

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

  t(key: MessageKey): string { return translate(this.locale, key); }
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
    // A city with no verified zone must not inherit the previous city's or host's zone.
    this.timeZone = place.timeZone ?? '';
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
    const result = resolveNowChart({
      name: this.name, timeZone: this.timeZone, latitude: this.latitude,
      longitude: this.longitude, placeName: this.placeName,
    });
    this.problem = result.status === 'problem' ? result.problem : null;
    if (result.status === 'ready') this.chartRequested.emit(result.input);
    this.cd.markForCheck();
  }
}
