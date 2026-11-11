import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output, inject} from '@angular/core';
import {offlinePlaceSearch} from './native/offline-places';
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
export class OfflineCityPickerComponent implements OnDestroy {
  @Input() locale: Locale = 'it';
  @Output() readonly locationSelected = new EventEmitter<OfflinePlaceV1>();
  @Output() readonly locationEdited = new EventEmitter<void>();
  private readonly cd = inject(ChangeDetectorRef);
  readonly state = new OfflineCityPickerState(offlinePlaceSearch, () => this.cd.markForCheck());

  t(key: MessageKey): string { return translate(this.locale,key); }
  get message(): string { return this.t(STATUS_KEYS[this.state.status]); }

  onInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.state.input(input.value);
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

  choose(index: number): void {
    const city = this.state.choose(index);
    if (city) this.locationSelected.emit(city);
  }

  trackCity(_index: number, city: OfflinePlaceV1): number { return city.id; }

  ngOnDestroy(): void { this.state.dispose(); }
}
