import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, Input, OnDestroy, inject} from '@angular/core';
import {calculateHistoricalCalendar} from './native/historical-calendar';
import {calculatePlanetSet} from './historical-planet-set';
import type {HistoricalCalendarRequest} from './native/historical-calendar-contract';
import {HISTORICAL_BODIES, type HistoricalBody, type HistoricalPlanet, type HistoricalResult} from './native/historical-planets-contract';
import {translate, type Locale, type MessageKey} from './translations';

const BODY_LABELS: Record<HistoricalBody, MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus', Mars:'name.mars',
  Jupiter:'name.jupiter', Saturn:'name.saturn', Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
};
const FAILURES: Record<Exclude<HistoricalResult['kind'], 'ready'>, MessageKey> = {
  not_native:'calc.browser', provider_unavailable:'calc.noprovider', invalid_request:'historical.invalid',
  time_source_unavailable:'historical.usnoUnavailable', time_source_out_of_range:'historical.usnoOutOfRange',
  calculation_failed:'historical.failed', unavailable:'historical.failed',
};
type TextField = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'uncertainty' | 'deltaSeconds' | 'source';
function numberOrNaN(text: string): number { return text.trim() === '' ? NaN : Number(text); }

@Component({
  selector: 'vs-historical-planets', standalone: true, imports: [CommonModule],
  templateUrl: './historical-planets.component.html', styleUrls: ['./historical-planets.component.css'],
})
export class HistoricalPlanetsComponent implements OnDestroy {
  @Input() locale: Locale = 'it';
  private readonly cd = inject(ChangeDetectorRef);
  private ticket = 0;
  private destroyed = false;
  readonly bodies = HISTORICAL_BODIES;
  body: HistoricalBody = 'Sun';
  allBodies = false;
  year = '2000'; month = '1'; day = '1'; hour = '12'; minute = '0'; second = '0';
  uncertainty = ''; deltaSeconds = ''; source = '';
  choice: 'supplied' | 'espenakMeeus2006' | 'usno' = 'espenakMeeus2006';
  estimateUncertainty = false;
  allowPredictions = false;
  includeScenarios = false;
  busy = false;
  results: readonly HistoricalPlanet[] = [];
  message: MessageKey | null = null;
  failedBody: HistoricalBody | null = null;

  ngOnDestroy(): void { this.destroyed = true; this.ticket++; }
  t(key: MessageKey): string { return translate(this.locale, key); }
  bodyLabel(body: HistoricalBody): string { return this.t(BODY_LABELS[body]); }
  private clear(): void { this.ticket++; this.busy = false; this.results = []; this.message = null; this.failedBody = null; }
  set(field: TextField, event: Event): void { this[field] = (event.target as HTMLInputElement).value; this.clear(); }
  setBody(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (this.bodies.includes(value as HistoricalBody)) this.body = value as HistoricalBody;
    this.clear();
  }
  setAllBodies(event: Event): void {
    this.allBodies = (event.target as HTMLInputElement).checked;
    this.clear();
  }
  setChoice(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'supplied' || value === 'espenakMeeus2006' || value === 'usno') this.choice = value;
    if (this.choice !== 'espenakMeeus2006') this.estimateUncertainty = false;
    this.allowPredictions = false;
    this.clear();
  }
  setEstimateUncertainty(event: Event): void {
    this.estimateUncertainty = (event.target as HTMLInputElement).checked;
    this.clear();
  }
  setAllowPredictions(event: Event): void {
    this.allowPredictions = (event.target as HTMLInputElement).checked;
    this.clear();
  }
  setScenarios(event: Event): void {
    this.includeScenarios = (event.target as HTMLInputElement).checked;
    this.clear();
  }
  async calculate(): Promise<void> {
    if (this.busy) return;
    const uncertaintySeconds = numberOrNaN(this.uncertainty);
    const request: HistoricalCalendarRequest = {body: this.body, year: numberOrNaN(this.year), month: numberOrNaN(this.month),
      day: numberOrNaN(this.day), hour: numberOrNaN(this.hour), minute: numberOrNaN(this.minute), second: numberOrNaN(this.second),
      includeScenarios: this.includeScenarios,
      deltaT: this.choice === 'supplied' ? {kind: 'supplied', seconds: numberOrNaN(this.deltaSeconds), uncertaintySeconds, source: this.source}
        : this.choice === 'usno' ? {kind: 'usno', uncertaintySeconds, allowPredictions: this.allowPredictions}
        : this.estimateUncertainty ? {kind: 'espenakMeeus2006EstimatedUncertainty'} : {kind: 'espenakMeeus2006', uncertaintySeconds}};
    const ticket = ++this.ticket;
    this.busy = true; this.message = null; this.failedBody = null; this.results = [];
    const outcome = await calculatePlanetSet(request, this.allBodies ? this.bodies : [this.body],
      calculateHistoricalCalendar, () => this.destroyed || ticket !== this.ticket);
    if (this.destroyed || ticket !== this.ticket) return;
    this.busy = false;
    if (outcome.kind === 'ready') this.results = outcome.planets;
    else if (outcome.kind === 'failed') { this.failedBody = outcome.body; this.message = FAILURES[outcome.reason]; }
    this.cd.markForCheck();
  }
}
