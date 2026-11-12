import {CommonModule} from '@angular/common';
import {ChangeDetectorRef, Component, Input, OnChanges, OnDestroy, SimpleChanges, inject} from '@angular/core';
import type {OfflinePlaceV1} from './native/offline-places-contract';
import {CivilCalculationSession} from './native/civil-calculation-session';
import {NatalFormState} from './natal-form-state';
import {NATAL_INPUT_TEXT, type NatalTextKey} from './natal-input-messages';
import type {Locale} from './translations';

/** Explicitly non-scientific UI: verify UTC without replacing the synthetic chart. */
@Component({
  selector:'vs-natal-input', standalone:true, imports:[CommonModule],
  templateUrl:'./natal-input.component.html',
  styleUrls:['./natal-input.component.css'],
})
export class NatalInputComponent implements OnChanges, OnDestroy {
  @Input() locale:Locale='it';
  @Input() selectedPlace:OfflinePlaceV1|null=null;
  private readonly cd=inject(ChangeDetectorRef);
  readonly state:NatalFormState;
  constructor(){
    // Preview-only bounded port. No Tauri IPC, network, storage or invented planets.
    const session=new CivilCalculationSession('natal_preview',async request=>({
      protocolVersion:1,sessionId:request.sessionId,requestSeq:request.requestSeq,
      calculationKey:request.calculationKey,status:'unavailable',
    }), outcome=>this.state.handleOutcome(outcome));
    this.state=new NatalFormState(session,()=>this.cd.markForCheck());
  }
  ngOnChanges(changes:SimpleChanges):void {
    if(changes['selectedPlace'])this.state.setPlace(this.selectedPlace);
  }
  t(key:NatalTextKey):string{return NATAL_INPUT_TEXT[this.locale][key];}
  get statusText():string {return this.t(this.state.status);}
  onDate(event:Event):void {this.state.editDate((event.target as HTMLInputElement).value);}
  onTime(event:Event):void {this.state.editTime((event.target as HTMLInputElement).value);}
  onVerify(event:Event):void {event.preventDefault();this.state.verify();}
  choose(utc:string):void {this.state.verify(utc);}
  offset(seconds:number):string {
    const sign=seconds<0?'-':'+';
    const absolute=Math.abs(seconds);
    const h=String(Math.floor(absolute/3600)).padStart(2,'0');
    const m=String(Math.floor((absolute%3600)/60)).padStart(2,'0');
    const s=absolute%60;
    return sign+h+':'+m+(s?':'+String(s).padStart(2,'0'):'');
  }
  ngOnDestroy():void {this.state.dispose();}
}
