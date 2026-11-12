import type {OfflinePlaceV1} from './native/offline-places-contract';
import type {CivilCalculationDispatchResult} from './native/civil-calculation-dispatch';
import type {CalculationOutcome} from './native/calculation-queue';

export interface NatalSessionPort {
  submit(
    input: Readonly<{date:string;time:string;timeZone:string}>,
    location: Readonly<{latMicro:number;lngMicro:number}>,
    key:string, selectedUtc?:string|null,
  ): CivilCalculationDispatchResult;
  invalidate():void;
  dispose():void;
}
export type NatalFormStatus = 'idle'|'city_required'|'zone_required'|'choice_required'|
  'pending'|'unavailable'|'unsupported'|'invalid_reply'|'transport_error'|
  'nonexistent'|'invalid'|'selection_invalid'|'location_invalid'|
  'calculation_key_invalid'|'queue_unavailable';
export type NatalUtcChoice = Readonly<{instantUtc:string;offsetSeconds:number}>;

/** Transient form state: no persistence, no native ephemeris, no real chart rendering. */
export class NatalFormState {
  date='';
  time='';
  place:OfflinePlaceV1|null=null;
  status:NatalFormStatus='idle';
  choices:readonly NatalUtcChoice[]=[];
  instantUtc:string|null=null;
  private pendingSeq:number|null=null;
  private keySeq=0;
  private disposed=false;

  private readonly session:NatalSessionPort;
  private readonly changed:()=>void;
  constructor(session:NatalSessionPort,changed:()=>void=()=>{}) {
    this.session=session;this.changed=changed;
  }

  editDate(value:string):void {
    if(this.disposed)return;
    this.date=value.slice(0,10);
    this.reset();
  }
  editTime(value:string):void {
    if(this.disposed)return;
    this.time=value.slice(0,8);
    this.reset();
  }
  setPlace(place:OfflinePlaceV1|null):void {
    if(this.disposed)return;
    const same=this.place?.id===place?.id && this.place?.timeZone===place?.timeZone &&
      this.place?.latMicro===place?.latMicro && this.place?.lngMicro===place?.lngMicro;
    if(same)return;
    this.place=place;
    this.reset();
  }
  private reset():void {
    this.session.invalidate();
    this.pendingSeq=null;
    this.choices=[];
    this.instantUtc=null;
    this.status='idle';
    this.changed();
  }
  verify(selectedUtc:string|null=null):void {
    if(this.disposed)return;
    const place=this.place;
    if(!place){this.reset();this.status='city_required';this.changed();return;}
    if(!place.timeZone){this.reset();this.status='zone_required';this.changed();return;}
    // Only choices displayed for the current unchanged form can be submitted.
    if(selectedUtc!==null && (this.status!=='choice_required' ||
        !this.choices.some(choice=>choice.instantUtc===selectedUtc)))return;
    this.pendingSeq=null;
    this.instantUtc=null;
    const key='ui_preview_'+(++this.keySeq);
    let result:CivilCalculationDispatchResult;
    try {
      result=this.session.submit({date:this.date,time:this.time,timeZone:place.timeZone},
        {latMicro:place.latMicro,lngMicro:place.lngMicro},key,selectedUtc);
    } catch {
      this.status='queue_unavailable';this.choices=[];this.changed();return;
    }
    this.choices=result.status==='choice_required'?result.choices:[];
    this.status=result.status==='submitted'?'pending':result.status;
    if(result.status==='submitted'){
      this.pendingSeq=result.requestSeq;
      this.instantUtc=result.selection.instantUtc;
    }
    this.changed();
  }
  handleOutcome(outcome:CalculationOutcome<never>):void {
    if(this.disposed || this.status!=='pending' || this.pendingSeq!==outcome.request.requestSeq)return;
    this.pendingSeq=null;
    this.status=outcome.kind==='ready'?'invalid_reply':outcome.kind;
    this.changed();
  }
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    this.session.dispose();
    this.choices=[];
    this.instantUtc=null;
    this.pendingSeq=null;
    this.place=null;
    this.date='';this.time='';
  }
}
