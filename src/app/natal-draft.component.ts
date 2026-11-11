import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import {NatalDraftState, type NatalInputKey, type NatalIssue} from './natal-draft-state';
import {translate, type Locale, type MessageKey} from './translations';

/** Explicit in-memory preview; saving real subjects requires reviewed local storage. */
@Component({
  selector:'vs-natal-draft',
  standalone:true,
  imports:[CommonModule, OfflineCityPickerComponent],
  templateUrl:'./natal-draft.component.html',
  styleUrls:['./natal-draft.component.css'],
})
export class NatalDraftComponent {
  @Input() locale: Locale = 'it';
  @Input({required:true}) draft!: NatalDraftState;
  @Output() readonly cityChanged = new EventEmitter<OfflinePlaceV1 | null>();

  t(key: MessageKey): string {return translate(this.locale,key);}
  edit(field: NatalInputKey, event: Event): void {
    const target=event.target as HTMLInputElement;
    this.draft.update(field,target.value);
  }
  setKnownTime(event: Event): void {
    const target=event.target as HTMLInputElement;
    this.draft.setBirthTimeKnown(target.checked);
  }
  chooseCity(place: OfflinePlaceV1): void {
    this.draft.setPlace(place);
    this.cityChanged.emit(place);
  }
  editCity(): void {
    this.draft.setPlace(null);
    this.cityChanged.emit(null);
  }
  preview(): void { this.draft.showPreview(); }
  clear(): void {
    this.draft.clear();
    this.cityChanged.emit(null);
  }
  hasIssue(kind: NatalIssue): boolean { return this.draft.issues.includes(kind); }
  get issueKeys(): readonly MessageKey[] {
    const keys: Record<NatalIssue,MessageKey> = {
      name:'natal.error.name',date:'natal.error.date',time:'natal.error.time',
      place:'natal.error.place',time_zone:'natal.error.zone',
    };
    return this.draft.issues.map(x => keys[x]);
  }
}
