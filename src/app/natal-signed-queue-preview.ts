import type {NatalDraftState} from './natal-draft-state';
import type {NatalPreviewAnchor} from './natal-preview-freshness';
import {isNatalPreviewCurrent} from './natal-preview-freshness';
import type {CivilTimeResolution} from './timezone-civil';
import {
  prepareProvisionalNatalCandidate,
  type DeclaredProviderCoverage,
  type NatalCandidateResult,
  type ProvisionalNatalCandidate,
} from './natal-calculation-candidate';
import {LatestCalculationQueue} from './native/calculation-queue';
import {SessionCalculationKeyV1} from './session-calculation-key';
import type {NatalOfflinePreviewOutcome} from './natal-offline-queue-preview';

export type SignedNatalSubmission =
  | Readonly<{status:'queued';requestSeq:number}>
  | Readonly<{status:'queue_unavailable'|'queue_rejected'|'superseded'|'identity_unavailable'}>
  | Exclude<NatalCandidateResult,{status:'provisional_only'}>;

type Pending = {
  readonly generation:number;
  readonly draft:NatalDraftState;
  readonly anchor:NatalPreviewAnchor|null;
  readonly resolution:CivilTimeResolution|null;
  readonly selectedUtc:string|null;
  readonly coverage:DeclaredProviderCoverage|null;
  readonly candidate:ProvisionalNatalCandidate;
  readonly resolve:(result:SignedNatalSubmission)=>void;
};

/**
 * Offline-only integration: one HMAC signing job active, at most one replaceable
 * pending signing job, and the ORIGINAL latest-only queue. No native IPC here.
 */
export class NatalSignedQueuePreview {
  private readonly queue:LatestCalculationQueue<never>;
  private readonly keyring:SessionCalculationKeyV1;
  private generation=0;
  private disposed=false;
  private signing=false;
  private active:Pending|null=null;
  private pending:Pending|null=null;

  private constructor(sessionId:string,keyring:SessionCalculationKeyV1,
    notify:(outcome:NatalOfflinePreviewOutcome)=>void) {
    this.keyring=keyring;
    this.queue=new LatestCalculationQueue<never>(sessionId,
      async request=>({
        protocolVersion:1,sessionId:request.sessionId,
        requestSeq:request.requestSeq,calculationKey:request.calculationKey,
        status:'unavailable',
      }),
      (_value):_value is never=>false,
      outcome=>notify({kind:outcome.kind==='ready'?'invalid_reply':outcome.kind}),
    );
  }

  /** Crypto may be substituted with a mock only in isolated tests. Never accepts an IPC port. */
  static async create(sessionId:string,notify:(outcome:NatalOfflinePreviewOutcome)=>void,
    cryptoProvider:Pick<Crypto,'subtle'>=globalThis.crypto):Promise<NatalSignedQueuePreview> {
    // Validate session ID before generating a new key, so no orphaned key is left.
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(sessionId)) throw new Error('Invalid calculation session');
    const keyring=await SessionCalculationKeyV1.create(cryptoProvider);
    try {return new NatalSignedQueuePreview(sessionId,keyring,notify);}
    catch {keyring.dispose();throw new Error('Calculation session unavailable');}
  }

  submit(draft:NatalDraftState,anchor:NatalPreviewAnchor|null,
    resolution:CivilTimeResolution|null,selectedUtc:string|null,
    coverage:DeclaredProviderCoverage|null):Promise<SignedNatalSubmission> {
    if(this.disposed)return Promise.resolve({status:'queue_unavailable'});
    const generation=++this.generation;
    // Must happen before any await, including for invalid new input.
    this.queue.invalidate();
    this.cancelWaiting({status:'superseded'});
    let candidate:NatalCandidateResult;
    try {
      candidate=prepareProvisionalNatalCandidate(draft,anchor,isNatalPreviewCurrent,
        resolution,selectedUtc,coverage);
    }catch {return Promise.resolve({status:'stale_preview'});}
    if(candidate.status!=='provisional_only')return Promise.resolve(candidate);

    return new Promise<SignedNatalSubmission>(resolve=>{
      this.pending={generation,draft,anchor,resolution,selectedUtc,coverage,
        candidate:Object.freeze({...candidate}),resolve};
      this.drain();
    });
  }

  private cancelWaiting(result:SignedNatalSubmission):void {
    this.active?.resolve(result);
    this.pending?.resolve(result);
    this.pending=null;
  }

  private drain():void {
    if(this.disposed||this.signing||!this.pending)return;
    const task=this.pending;
    this.pending=null;
    this.active=task;
    this.signing=true;
    // The microtask also coalesces a burst that arrives in the same JS turn.
    void Promise.resolve().then(async():Promise<SignedNatalSubmission>=>{
      if(this.disposed||task.generation!==this.generation)return {status:'superseded'};
      let key:string;
      try {key=await this.keyring.forPreview(task.candidate);}
      catch {return {status:'identity_unavailable'};}
      if(this.disposed)return {status:'queue_unavailable'};
      if(task.generation!==this.generation)return {status:'superseded'};
      // Revalidate after async signing: state, preview and timezone candidates
      // may have been changed *without* notifying the queue while it awaited.
      let current:NatalCandidateResult;
      try {
        current=prepareProvisionalNatalCandidate(task.draft,task.anchor,
          isNatalPreviewCurrent,task.resolution,task.selectedUtc,task.coverage);
      }catch {return {status:'stale_preview'};}
      if(current.status!=='provisional_only')return current;
      if(JSON.stringify(current)!==JSON.stringify(task.candidate))return {status:'stale_preview'};
      const requestSeq=this.queue.submit({intent:'preview',
        utcIso:task.candidate.instantUtc,latMicro:task.candidate.latMicro,
        lngMicro:task.candidate.lngMicro,timeZone:task.candidate.timeZone,
        calculationKey:key});
      return requestSeq===null?{status:'queue_rejected'}:{status:'queued',requestSeq};
    }).catch(():SignedNatalSubmission=>({status:'identity_unavailable'}))
      .then(value=>task.resolve(value)).finally(()=>{
        if(this.active===task)this.active=null;
        this.signing=false;
        this.drain();
      });
  }

  invalidate():void {
    if(this.disposed)return;
    this.generation++;
    this.queue.invalidate();
    this.cancelWaiting({status:'superseded'});
  }

  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    this.generation++;
    this.cancelWaiting({status:'queue_unavailable'});
    this.queue.dispose();
    this.keyring.dispose();
  }
}
