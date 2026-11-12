import {CommonModule} from '@angular/common';
import {Component, EventEmitter, Input, Output} from '@angular/core';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {OfflineCityPickerComponent} from './offline-city-picker.component';
import {NatalDraftState, type NatalInputKey, type NatalIssue} from './natal-draft-state';
import {previewIanaCivilTime} from './timezone-moment-preview';
import type {CivilTimeResolution, UtcCandidate} from './timezone-civil';
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
  timeResult: CivilTimeResolution | null = null;
  chosenIndex: number | null = null;

  get selectedUtc(): UtcCandidate | null {
    return this.chosenIndex === null ? null : this.timeResult?.candidates[this.chosenIndex] ?? null;
  }
  private invalidateTimezonePreview(): void {
    this.timeResult=null;
    this.chosenIndex=null;
  }
  chooseUtc(index:number): void {
    if(this.timeResult?.status !== 'ambiguous' || !Number.isInteger(index) ||
       index < 0 || index >= this.timeResult.candidates.length) return;
    this.chosenIndex=index;
  }

  t(key: MessageKey): string {return translate(this.locale,key);}
  edit(field: NatalInputKey, event: Event): void {
    const target=event.target as HTMLInputElement;
    this.draft.update(field,target.value);
    this.invalidateTimezonePreview();
  }
  setKnownTime(event: Event): void {
    const target=event.target as HTMLInputElement;
    this.draft.setBirthTimeKnown(target.checked);
    this.invalidateTimezonePreview();
  }
  chooseCity(place: OfflinePlaceV1): void {
    this.draft.setPlace(place);
    this.invalidateTimezonePreview();
    this.cityChanged.emit(place);
  }
  editCity(): void {
    this.draft.setPlace(null);
    this.invalidateTimezonePreview();
    this.cityChanged.emit(null);
  }
  preview(): void {
    this.invalidateTimezonePreview();
    if(!this.draft.showPreview() || !this.draft.preview) return;
    const p=this.draft.preview;
    if(!p.civil.birthTimeKnown) return;
    this.timeResult=previewIanaCivilTime(p.civil,p.place.timeZone);
    // A repeated local hour requires explicit selection by the user.
    if(this.timeResult.status === 'unique') this.chosenIndex=0;
  }
  clear(): void {
    this.draft.clear();
    this.invalidateTimezonePreview();
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
