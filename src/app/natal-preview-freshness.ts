import type {NatalDraftPreview, NatalDraftState} from './natal-draft-state';

/** A preview is bound both to a mutation revision and the exact source snapshot. */
export type NatalPreviewAnchor = Readonly<{
  revision: number;
  preview: NatalDraftPreview;
}>;

export function captureNatalPreviewAnchor(draft: NatalDraftState): NatalPreviewAnchor | null {
  return draft.preview ? {revision: draft.inputRevision, preview: draft.preview} : null;
}

function equalSnapshot(a: NatalDraftPreview, b: NatalDraftPreview): boolean {
  const x=a.civil, y=b.civil, p=a.place, q=b.place;
  return a.protocolVersion===b.protocolVersion && a.name===b.name &&
    a.utcResolution===b.utcResolution &&
    x.year===y.year && x.month===y.month && x.day===y.day &&
    x.hour===y.hour && x.minute===y.minute && x.birthTimeKnown===y.birthTimeKnown &&
    p.source===q.source && p.sourceId===q.sourceId && p.name===q.name &&
    p.countryName===q.countryName && p.countryCode===q.countryCode &&
    p.stateId===q.stateId && p.region===q.region &&
    p.latMicro===q.latMicro && p.lngMicro===q.lngMicro && p.timeZone===q.timeZone;
}

/**
 * Do not display or accept a UTC preview derived from stale or mutated input.
 * Revalidate because the prototype currently exposes public mutable draft fields,
 * which can bypass the normal inputRevision increment through direct assignment.
 * Never logs, stores or forwards birth details.
 */
export function isNatalPreviewCurrent(
  draft: NatalDraftState, anchor: NatalPreviewAnchor | null,
): boolean {
  if (!anchor || draft.inputRevision !== anchor.revision || draft.preview !== anchor.preview) {
    return false;
  }
  const current=draft.validate();
  return current.ok && equalSnapshot(current.preview,anchor.preview);
}
