import type {NatalDraftState} from './natal-draft-state';
import type {NatalPreviewAnchor} from './natal-preview-freshness';
import {isNatalPreviewCurrent} from './natal-preview-freshness';
import type {CivilTimeResolution} from './timezone-civil';
import {
  prepareProvisionalNatalCandidate,
  type DeclaredProviderCoverage,
  type NatalCandidateResult,
} from './natal-calculation-candidate';
import {LatestCalculationQueue} from './native/calculation-queue';

/** This adapter cannot call native IPC: it owns a fixed, unavailable-only test port. */
export type NatalOfflinePreviewOutcome = Readonly<{
  kind: 'unavailable' | 'unsupported' | 'invalid_reply' | 'transport_error';
}>;
export type NatalOfflinePreviewSubmission =
  | Readonly<{status:'queued'; requestSeq:number}>
  | Readonly<{status: 'queue_unavailable' | 'queue_rejected'}>
  | Exclude<NatalCandidateResult,{status:'provisional_only'}>;

/**
 * Integration harness for the actual LatestCalculationQueue and the current natal
 * form. It can never produce sky data, invoke Tauri, or inject a production port.
 * No user data is included in notifications or saved beyond the in-memory queue.
 */
export class NatalOfflineQueuePreview {
  private readonly queue:LatestCalculationQueue<never>;
  private disposed=false;
  private nextPreviewKey=0;

  constructor(sessionId:string, notify:(outcome:NatalOfflinePreviewOutcome)=>void) {
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

  submit(
    draft:NatalDraftState,
    anchor:NatalPreviewAnchor|null,
    resolution:CivilTimeResolution|null,
    selectedUtc:string|null,
    coverage:DeclaredProviderCoverage|null,
  ):NatalOfflinePreviewSubmission {
    if(this.disposed)return {status:'queue_unavailable'};
    // A newly edited form must cancel old requests *even if* it is invalid.
    this.queue.invalidate();
    let candidate:NatalCandidateResult;
    try {
      candidate=prepareProvisionalNatalCandidate(
        draft,anchor,isNatalPreviewCurrent,resolution,selectedUtc,coverage);
    }catch {
      return {status:'stale_preview'};
    }
    if(candidate.status!=='provisional_only')return candidate;
    // Ephemeral demo correlation only, NOT a stable scientific fingerprint.
    const key='natal_preview_'+(++this.nextPreviewKey);
    const requestSeq=this.queue.submit({
      intent:'preview',utcIso:candidate.instantUtc,
      latMicro:candidate.latMicro,lngMicro:candidate.lngMicro,
      timeZone:candidate.timeZone,calculationKey:key,
    });
    return requestSeq===null?{status:'queue_rejected'}:{status:'queued',requestSeq};
  }

  /** Call immediately on edits, tab dismissal or mode changes. */
  invalidate():void {if(!this.disposed)this.queue.invalidate();}
  dispose():void {
    if(this.disposed)return;
    this.disposed=true;
    this.queue.dispose();
  }
}
