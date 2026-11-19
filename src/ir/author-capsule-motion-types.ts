import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorCapsuleVariationDomain } from './author-capsule-types.js';
import type { AuthorAnatomyReceipt, AuthorSourceProvenance } from './author-provenance.js';

export type BodyWidthRefusalCode = 'INVALID_REQUEST' | 'VARIANT_UNSUPPORTED' | 'VARIATION_OUTSIDE_DOMAIN';
export interface BodyWidthRefusal {
  readonly ok: false;
  readonly reason: Readonly<{ code: BodyWidthRefusalCode; message: string }>;
}
export type BodyWidthSampleResult = Readonly<{ ok: true; bodyWidth: number; d: string }> | BodyWidthRefusal;
export interface PreparedBodyWidth {
  readonly version: 1;
  readonly icon: AuthorIconId;
  readonly variant: 'outline' | 'filled';
  readonly law: 'capsule.width';
  readonly svg: string;
  readonly domain: Readonly<{ minimum: number; maximum: 1 }>;
  readonly renderTarget: Readonly<{ selector: string; attribute: 'd'; partId: string; unchangedPartIds: readonly string[] }>;
  readonly sample: (bodyWidth: number) => BodyWidthSampleResult;
}
export type PrepareBodyWidthResult = Readonly<{ ok: true; prepared: PreparedBodyWidth }> | BodyWidthRefusal;
export interface BodyWidthMotionCapabilities {
  readonly version: 1;
  readonly icon: AuthorIconId;
  readonly variant: 'outline' | 'filled';
  readonly law: 'capsule.width';
  readonly domain: AuthorCapsuleVariationDomain;
  readonly geometrySha256: string;
  readonly formats: readonly ['svg', 'prepared-width'];
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
}
export type BodyWidthMotionCapabilitiesResult = Readonly<{ ok: true; capabilities: BodyWidthMotionCapabilities }> | BodyWidthRefusal;
