import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, inject} from '@angular/core';
import {createOfflinePlaceSearch} from './native/offline-places';
import {newOfflineCityPickerDomIds} from './offline-city-picker-dom-ids';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {OfflineCityPickerState, type CityPickerStatus} from './offline-city-picker-state';
import {translate, type Locale, type MessageKey} from './translations';

const STATUS_KEYS: Record<CityPickerStatus, MessageKey> = {
  idle:'city.idle', query_too_short:'city.short', typing:'city.typing',
  loading:'city.loading', ready:'city.results', empty:'city.empty',
  selected:'city.selected', not_native:'city.browser', busy:'city.busy',
  catalog_unavailable:'city.missing', unavailable:'city.error',
};

@Component({
  selector:'vs-offline-city-picker',
  standalone:true,
  imports:[CommonModule],
  templateUrl:'./offline-city-picker.component.html',
  styleUrls:['./offline-city-picker.component.css']
})
export class OfflineCityPickerComponent implements OnChanges, OnDestroy {
  @Input() locale: Locale = 'it';
  @Input() selectedPlace: OfflinePlaceV1 | null = null;
  @Output() readonly locationSelected = new EventEmitter<OfflinePlaceV1>();
  @Output() readonly locationEdited = new EventEmitter<void>();
  private readonly cd = inject(ChangeDetectorRef);
  readonly domIds = newOfflineCityPickerDomIds();
  readonly state = new OfflineCityPickerState(createOfflinePlaceSearch(), () => this.cd.markForCheck());

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['selectedPlace']) return;
    // The parent's temporary city is authoritative on external selection changes.
    // Preserve an active typed query when input already cleared local selection.
    if (this.selectedPlace !== null) {
      this.state.restore(this.selectedPlace);
    } else if (this.state.selected !== null) {
      // External clear: also retire pending results, but do not emit an edit back
      // to the parent (which would create a redundant output/change cycle).
      this.state.clearSelection();
    }
  }

  t(key: MessageKey): string { return translate(this.locale,key); }
  get message(): string { return this.t(STATUS_KEYS[this.state.status]); }
  get selectedDetail(): string {
    const place = this.state.selected;
    return place ? [place.region, place.countryName, place.timeZone]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .join(' · ') : '';
  }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.state.input(input.value);
    // Browser maxlength counts UTF-16 code units; state caps at 80 code points.
    // Reflect the normalized query so displayed text always matches IPC input.
    if (input.value !== this.state.query) input.value = this.state.query;
    this.locationEdited.emit();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (this.state.results.length) {
        event.preventDefault();
        this.state.move(event.key === 'ArrowDown' ? 1 : -1);
      }
      return;
    }
    if (event.key === 'Enter' && this.state.activeIndex >= 0) {
      event.preventDefault();
      this.choose(this.state.activeIndex);
    } else if (event.key === 'Escape') {
      this.state.dismiss();
    }
  }

  retry(input: HTMLInputElement): void {
    if (this.state.retry()) input.focus();
  }

  clearSelected(): void {
    if (!this.state.selected) return;
    this.state.clearSelection();
    this.locationEdited.emit();
  }

  choose(index: number): void {
    const city = this.state.choose(index);
    if (city) this.locationSelected.emit(city);
  }

  trackCity(_index: number, city: OfflinePlaceV1): number { return city.id; }

  ngOnDestroy(): void { this.state.dispose(); }
}
