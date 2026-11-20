import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import {
  ASPECT_DEFINITIONS, POINT_IDS, defaultChartSettings, parseOrb, sanitizeChartSettings,
  type AspectId, type ChartSettings, type FixedStarSettings, type PointId,
} from './chart-settings';
import {ASPECT_LABEL_KEYS, POINT_LABEL_KEYS} from './point-labels';
import {translate, type Locale, type MessageKey} from './translations';

/**
 * Editor for aspects, orbs and points. It never mutates its input: every
 * change is emitted as a new, sanitized settings object.
 */
@Component({
  selector: 'vs-chart-settings',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-settings.component.html',
  styleUrls: ['./chart-settings.component.css'],
})
export class ChartSettingsComponent {
  @Input() locale: Locale = 'it';
  @Input({required: true}) settings!: ChartSettings;
  @Input() disabled = false;
  @Input() starsOnly = false;
  @Input() starsSaveStatus: 'saved'|'failed'|null = null;
  @Output() readonly settingsChange = new EventEmitter<ChartSettings>();
  @Output() readonly saveStarDefaults = new EventEmitter<FixedStarSettings>();

  readonly aspectIds: readonly AspectId[] = ASPECT_DEFINITIONS.map(definition => definition.id);
  readonly pointIds: readonly PointId[] = POINT_IDS;
  invalidOrb = false;
  invalidStars = false;

  t(key: MessageKey): string { return translate(this.locale, key); }
  aspectLabel(id: AspectId): string { return this.t(ASPECT_LABEL_KEYS[id]); }
  pointLabel(id: PointId): string { return this.t(POINT_LABEL_KEYS[id]); }
  orbText(orb: number | null): string { return orb === null ? '' : String(orb); }

  private emit(change: (next: ChartSettings) => void): void {
    const next = sanitizeChartSettings(this.settings);
    change(next);
    this.invalidOrb = false;
    // Keep a local immutable snapshot so successive input changes do not use
    // stale @Input values before the parent view is checked again.
    this.settings = sanitizeChartSettings(next);
    this.settingsChange.emit(this.settings);
  }
  private checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }

  setShowAspects(event: Event): void { this.emit(next => { next.showAspects = this.checked(event); }); }
  setDisplayOption(key:'australInversion'|'outerWhenConjunct'|'planetOfYear'|'focusAspects'|'showDecans'|'showDecades'|'showTerms', event:Event): void {
    this.emit(next => { next[key] = this.checked(event); });
  }
  setApplicationMode(event:Event): void {
    const mode = (event.target as HTMLSelectElement).value;
    if (mode === 'off' || mode === 'applying' || mode === 'separating') this.emit(next => { next.applicationMode = mode; });
  }
  setAspectActive(id: AspectId, event: Event): void { this.emit(next => { next.aspects[id].active = this.checked(event); }); }
  setPointShown(id: PointId, event: Event): void { this.emit(next => { next.points[id].shown = this.checked(event); }); }
  setPointAspects(id: PointId, event: Event): void { this.emit(next => { next.points[id].aspects = this.checked(event); }); }

  setStarMagnitude(event: Event): void {
    const input = event.target as HTMLInputElement;
    const text = input.value.trim().replace(',', '.');
    const value = text === '20.1' || text === '' ? null : /^-?\d{1,2}(?:\.\d)?$/.test(text) ? Number(text) : NaN;
    if (value !== null && (!Number.isFinite(value) || value < -10 || value > 20)) {
      input.value = this.orbText(this.settings.fixedStars.magnitudeLimit ?? 20.1);
      this.invalidStars = true;
      return;
    }
    this.invalidStars = false;
    this.settings = {...this.settings, fixedStars:{...this.settings.fixedStars, magnitudeLimit:value}};
  }
  setStarOrb(field:'longitudeOrb'|'axisOrb', event:Event): void {
    const input = event.target as HTMLInputElement;
    const value = parseOrb(input.value, 0);
    if (value === null || value === undefined) {
      input.value = this.orbText(this.settings.fixedStars[field]);
      this.invalidStars = true;
      return;
    }
    this.invalidStars = false;
    this.settings = {...this.settings, fixedStars:{...this.settings.fixedStars, [field]:value}};
  }
  /** Input updates the displayed value; commit once on release or keyboard change. */
  commitStarSliders(): void {
    if (!this.invalidStars) this.settingsChange.emit(sanitizeChartSettings(this.settings));
  }
  saveStarsAsDefault(): void { this.saveStarDefaults.emit({...this.settings.fixedStars}); }
  setUnknownMagnitude(event:Event):void {
    this.invalidStars = false;
    this.emit(next => { next.fixedStars.includeUnknownMagnitude = this.checked(event); });
  }

  /** An aspect orb may be empty: the aspect then uses the orb of the point. */
  setAspectOrb(id: AspectId, event: Event): void {
    const input = event.target as HTMLInputElement;
    const orb = parseOrb(input.value, 0.1);
    if (orb === undefined) {
      input.value = this.orbText(this.settings.aspects[id].orb);
      this.invalidOrb = true;
      return;
    }
    this.emit(next => { next.aspects[id].orb = orb; });
  }
  setPointOrb(id: PointId, event: Event): void {
    const input = event.target as HTMLInputElement;
    const orb = parseOrb(input.value, 0);
    if (orb === undefined || orb === null) {
      input.value = this.orbText(this.settings.points[id].orb);
      this.invalidOrb = true;
      return;
    }
    this.emit(next => { next.points[id].orb = orb; });
  }
  reset(): void {
    this.invalidOrb = false;
    this.invalidStars = false;
    this.settingsChange.emit(defaultChartSettings());
  }
}
