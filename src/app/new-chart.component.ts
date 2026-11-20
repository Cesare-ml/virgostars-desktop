import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject} from '@angular/core';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import {resolveCivilTime, type CivilTimeChoice} from './native/civil-time';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {
  MAX_CHART_NAME_LENGTH, cleanChartName, cleanPlaceName, formatUtcOffset, parseDegreesMicro, resolveNewChart, resolveHistoricalNewChart, savedChartFields,
  type NewChartInput, type NewChartProblem,
} from './new-chart-form';
import {translate, type Locale, type MessageKey} from './translations';
import type {SavedChartV1} from './native/chart-archive-contract';

const PROBLEM_KEYS: Record<NewChartProblem, MessageKey> = {
  date_invalid: 'problem.date', time_invalid: 'problem.time', zone_invalid: 'problem.zone',
  zone_unavailable: 'problem.zoneUnavailable', latitude_invalid: 'problem.latitude',
  longitude_invalid: 'problem.longitude', time_nonexistent: 'problem.nonexistent',
  historical_invalid: 'problem.historical',
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
export class NewChartComponent implements OnChanges {
  @Input() locale: Locale = 'it';
  @Input() busy = false;
  /** Non-null in archive edit mode; saving preserves this chart's UUID. */
  @Input() editChart: SavedChartV1 | null = null;
  @Output() readonly chartRequested = new EventEmitter<NewChartInput>();
  private readonly cd = inject(ChangeDetectorRef);

  readonly maxNameLength = MAX_CHART_NAME_LENGTH;
  name = '';
  date = '';
  time = '12:00';
  timeUnknown = false;
  timeZone = hostTimeZone();
  latitude = '';
  longitude = '';
  placeName = '';
  city: OfflinePlaceV1 | null = null;
  problem: NewChartProblem | null = null;
  choices: readonly CivilTimeChoice[] = [];
  historicalMode = false;
  historicalCalendar: 'gregorian'|'julian' = 'julian';
  historicalOffset: 'localMeanSolar'|'supplied' = 'localMeanSolar';
  historicalDeltaT: 'espenakMeeus2006'|'supplied' = 'espenakMeeus2006';
  historicalOffsetSeconds = '0';
  historicalDeltaTSeconds = '';
  historicalCivilUncertainty = '60';
  historicalDeltaTUncertainty = '3600';
  private historicalOffsetSource = 'User supplied local minus UT1';
  private historicalDeltaTSource = 'User supplied';

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['editChart'] || !this.editChart) return;
    const fields = savedChartFields(this.editChart);
    Object.assign(this, fields);
    this.timeUnknown=!!this.editChart.unknownDate;
    const historical = this.editChart.historical;
    this.historicalMode = !!historical;
    if (historical) {
      this.historicalCalendar = historical.civil.calendar;
      this.historicalOffset = historical.civil.offset.kind;
      this.historicalOffsetSeconds = historical.civil.offset.kind === 'supplied' ? String(historical.civil.offset.secondsEast) : '0';
      this.historicalOffsetSource = historical.civil.offset.kind === 'supplied' ? historical.civil.offset.source : 'User supplied local minus UT1';
      this.historicalDeltaT = historical.deltaT.kind === 'espenakMeeus2006Unquantified' ? 'espenakMeeus2006' : historical.deltaT.kind;
      this.historicalDeltaTSeconds = historical.deltaT.kind === 'supplied' ? String(historical.deltaT.seconds) : '';
      this.historicalDeltaTSource = historical.deltaT.kind === 'supplied' ? historical.deltaT.source : 'User supplied';
      this.historicalCivilUncertainty = String(historical.civil.uncertaintySeconds);
      this.historicalDeltaTUncertainty = historical.deltaT.kind === 'espenakMeeus2006Unquantified' ? '' : String(historical.deltaT.uncertaintySeconds);
    }
    this.city = null;
    this.problem = null;
    this.choices = [];
    this.cd.markForCheck();
  }

  t(key: MessageKey): string { return translate(this.locale, key); }
  get problemText(): string { return this.problem ? this.t(PROBLEM_KEYS[this.problem]) : ''; }
  offsetLabel(choice: CivilTimeChoice): string { return 'UTC' + formatUtcOffset(choice.offsetSeconds); }
  setHistoricalMode(event:Event):void { this.historicalMode = (event.target as HTMLInputElement).checked; this.problem=null; this.choices=[]; }
  setTimeUnknown(event:Event):void {this.timeUnknown=(event.target as HTMLInputElement).checked;this.problem=null;this.choices=[];}
  setHistorical(field:'historicalCalendar'|'historicalOffset'|'historicalDeltaT'|'historicalOffsetSeconds'|'historicalDeltaTSeconds'|'historicalCivilUncertainty'|'historicalDeltaTUncertainty', event:Event):void {
    const value=(event.target as HTMLInputElement).value;
    if (field === 'historicalOffsetSeconds') this.historicalOffsetSource='User supplied local minus UT1';
    if (field === 'historicalDeltaTSeconds') this.historicalDeltaTSource='User supplied';
    if (field === 'historicalCalendar' && (value === 'gregorian' || value === 'julian')) this.historicalCalendar=value;
    else if (field === 'historicalOffset' && (value === 'localMeanSolar' || value === 'supplied')) this.historicalOffset=value;
    else if (field === 'historicalDeltaT' && (value === 'espenakMeeus2006' || value === 'supplied')) this.historicalDeltaT=value;
    else if (field === 'historicalOffsetSeconds' || field === 'historicalDeltaTSeconds' || field === 'historicalCivilUncertainty' || field === 'historicalDeltaTUncertainty') this[field]=value;
    this.problem=null;
  }

  set(field: 'name' | 'date' | 'time' | 'timeZone' | 'latitude' | 'longitude' | 'placeName', event: Event): void {
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
    const fields = {
      name: this.name, date: this.date, time: this.timeUnknown ? '12:00:00' : this.time, timeZone: this.timeZone,
      latitude: this.latitude, longitude: this.longitude, placeName: this.placeName,
    };
    const result = this.historicalMode ? resolveHistoricalNewChart(fields, {calendar:this.historicalCalendar,
      offset:this.historicalOffset, offsetSeconds:this.historicalOffsetSeconds, deltaT:this.historicalDeltaT,
      deltaTSeconds:this.historicalDeltaTSeconds, civilUncertaintySeconds:this.historicalCivilUncertainty,
      deltaTUncertaintySeconds:this.historicalDeltaTUncertainty, offsetSource:this.historicalOffsetSource, deltaTSource:this.historicalDeltaTSource}) :
      resolveNewChart(fields, value => resolveCivilTime(value, {yearRange:'archive'}), selectedUtc ?? this.editChart?.utcIso ?? null);
    this.problem = result.status === 'problem' ? result.problem : null;
    this.choices = result.status === 'choice_required' ? result.choices : [];
    if (result.status === 'ready') this.chartRequested.emit(this.timeUnknown ? {...result.input,timeUnknown:true,unknownDate:this.date} : result.input);
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
        latMicro, lngMicro, placeName: cleanPlaceName(this.placeName),
      });
    }
    this.cd.markForCheck();
  }
}
