// VirgoStars Desktop macOS v0.0.4 source snapshot: fail-closed compatibility gate.
// The public Functions package at its pinned revision does NOT export the legacy
// grouped Arabic-part API or the stellar contact matcher used by Windows locally.
// Never fabricate orbital, interpretive, or mathematical values to make a build pass.
export interface RegoloPart {
  readonly nome: string;
  readonly descrizione: string;
  readonly longitude: number;
  readonly nomePianetaCardinale: string;
  readonly nomePianetaHighlight: string;
  readonly lngOffs: number;
}
export type MacArabicParts = Readonly<{
  essenziali: readonly RegoloPart[];
  abumashar: readonly (readonly RegoloPart[])[];
}>;
export function calculateRegoloArabicParts(_input: unknown): MacArabicParts {
  throw new Error('UNSUPPORTED_MAC_PREVIEW: independent Regolo Arabic-parts parity not established');
}
export function calculateVirgoStarsStarContacts(_input: unknown): Readonly<{axis:string|null; conjunctions:readonly string[]}> {
  throw new Error('UNSUPPORTED_MAC_PREVIEW: fixed-star contact method not present in pinned public library');
}
