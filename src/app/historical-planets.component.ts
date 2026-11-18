import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, Input, OnDestroy, inject} from '@angular/core';
import {calculateHistoricalCalendar} from './native/historical-calendar';
import type {HistoricalCalendarRequest} from './native/historical-calendar-contract';
import {HISTORICAL_BODIES, type HistoricalBody, type HistoricalPlanet, type HistoricalResult} from './native/historical-planets-contract';
import {translate, type Locale, type MessageKey} from './translations';

const BODY_LABELS: Record<HistoricalBody, MessageKey> = {
  Sun:'name.sun', Moon:'name.moon', Mercury:'name.mercury', Venus:'name.venus', Mars:'name.mars',
  Jupiter:'name.jupiter', Saturn:'name.saturn', Uranus:'name.uranus', Neptune:'name.neptune', Pluto:'name.pluto',
};
const FAILURES: Record<Exclude<HistoricalResult['kind'], 'ready'>, MessageKey> = {
  not_native:'calc.browser', provider_unavailable:'calc.noprovider', invalid_request:'historical.invalid',
  calculation_failed:'historical.failed', unavailable:'historical.failed',
};
type TextField = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'uncertainty' | 'deltaSeconds' | 'source';
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
  year = '2000'; month = '1'; day = '1'; hour = '12'; minute = '0';
  uncertainty = ''; deltaSeconds = ''; source = '';
  choice: 'supplied' | 'espenakMeeus2006' = 'espenakMeeus2006';
  estimateUncertainty = false;
  includeScenarios = false;
  busy = false;
  result: HistoricalPlanet | null = null;
  message: MessageKey | null = null;

  ngOnDestroy(): void { this.destroyed = true; this.ticket++; }
  t(key: MessageKey): string { return translate(this.locale, key); }
  bodyLabel(body: HistoricalBody): string { return this.t(BODY_LABELS[body]); }
  private clear(): void { this.ticket++; this.busy = false; this.result = null; this.message = null; }
  set(field: TextField, event: Event): void { this[field] = (event.target as HTMLInputElement).value; this.clear(); }
  setBody(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (this.bodies.includes(value as HistoricalBody)) this.body = value as HistoricalBody;
    this.clear();
  }
  setChoice(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'supplied' || value === 'espenakMeeus2006') this.choice = value;
    if (this.choice === 'supplied') this.estimateUncertainty = false;
    this.clear();
  }
  setEstimateUncertainty(event: Event): void {
    this.estimateUncertainty = (event.target as HTMLInputElement).checked;
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
      day: numberOrNaN(this.day), hour: numberOrNaN(this.hour), minute: numberOrNaN(this.minute), second: 0,
      includeScenarios: this.includeScenarios,
      deltaT: this.choice === 'supplied' ? {kind: 'supplied', seconds: numberOrNaN(this.deltaSeconds), uncertaintySeconds, source: this.source}
        : this.estimateUncertainty ? {kind: 'espenakMeeus2006EstimatedUncertainty'} : {kind: 'espenakMeeus2006', uncertaintySeconds}};
    const ticket = ++this.ticket;
    this.busy = true; this.message = null; this.result = null;
    const outcome = await calculateHistoricalCalendar(request);
    if (this.destroyed || ticket !== this.ticket) return;
    this.busy = false;
    if (outcome.kind === 'ready') this.result = outcome.planet;
    else this.message = FAILURES[outcome.kind];
    this.cd.markForCheck();
  }
}
