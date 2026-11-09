import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceProvenance } from './author-provenance.js';

export interface ClockHandsRefusal {
  readonly ok: false;
  readonly reason: Readonly<{ code: 'INVALID_REQUEST' | 'VARIANT_UNSUPPORTED' | 'COMPOSITION_UNSUPPORTED'; message: string }>;
}
export type ClockHandsSample = Readonly<{ ok: true; elapsedHours: number; d: string }> | ClockHandsRefusal;
export interface PreparedClockHands {
  readonly version: 1;
  readonly icon: AuthorIconId;
  readonly variant: 'outline' | 'filled';
  readonly law: 'joint.authored-elbow';
  readonly svg: string;
  readonly reference: 'authored-pose';
  readonly parameter: 'elapsed-hours';
  readonly renderTarget: Readonly<{ selector: string; attribute: 'd'; partIds: readonly string[]; unchangedPartIds: readonly string[] }>;
  readonly sample: (elapsedHours: number) => ClockHandsSample;
}
export type PrepareClockHandsResult = Readonly<{ ok: true; prepared: PreparedClockHands }> | ClockHandsRefusal;
export interface ClockHandsCapabilities {
  readonly version: 1;
  readonly icon: AuthorIconId;
  readonly variant: 'outline' | 'filled';
  readonly law: 'joint.authored-elbow';
  readonly parameter: 'elapsed-hours';
  readonly reference: 'authored-pose';
  readonly formats: readonly ['svg', 'prepared-clock-hands'];
  readonly author: AuthorSourceProvenance;
  readonly geometrySha256: string;
  readonly gesture: Readonly<{ id: 'clock.advance-hour'; kind: 'state'; meaning: string;
    from: 0; to: 1; unit: 'elapsed-hours' }>;
}
export type ClockHandsCapabilitiesResult = Readonly<{ ok: true; capabilities: ClockHandsCapabilities }> | ClockHandsRefusal;
