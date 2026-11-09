import type { AuthoredAnnulusVariation, AuthorAnnulusVariationDomain } from '../ir/author-annulus-types.js';
import type { AuthorSourceProvenance } from '../ir/author-provenance.js';

export interface EnclosureVariationRequest {
  readonly variant?: 'outline';
  readonly variation?: AuthoredAnnulusVariation;
}

/** Одно событие меняет атрибут объявленной части, сохраняя mounted state-группы. */
export interface SymbolGeometryPatch {
  readonly contract: 'labpics.symbol-geometry-patch/1';
  readonly version: 1;
  readonly group: string;
  readonly variant: 'outline';
  readonly partId: string;
  readonly attributes: Readonly<{ d: string }>;
}

export interface EnclosureVariationRefusal {
  readonly ok: false;
  readonly reason: Readonly<{
    code: 'INVALID_REQUEST' | 'VARIANT_UNSUPPORTED' | 'VARIATION_OUTSIDE_DOMAIN' | 'POSE_UNREPRESENTABLE';
    message: string;
  }>;
}

export type EnclosureVariationResult = Readonly<{ ok: true; patch: SymbolGeometryPatch }> | EnclosureVariationRefusal;

export interface EnclosureVariationCapabilities<TState extends string = string> {
  readonly version: 1;
  readonly group: string;
  readonly variant: 'outline';
  readonly law: 'annulus.counter-scale';
  readonly partId: string;
  readonly defaults: Readonly<{ enclosureEmphasis: 1 }>;
  readonly domain: AuthorAnnulusVariationDomain;
  readonly targets: Readonly<{
    svg: 'supported';
    webEffect: 'existing-state-transitions';
    lottie: 'not-exported';
    sfSymbols: 'not-exported';
  }>;
  readonly proof: Readonly<{
    geometrySha256: string;
    stateSpecSha256: string;
    sharedPartsSha256: string;
    gridSha256: string;
    source: Readonly<{ fileKey: string; version: string }>;
    members: readonly Readonly<{
      state: TState;
      icon: string;
      sourceEnclosurePartId: string;
      geometrySha256: string;
      author: AuthorSourceProvenance;
    }>[];
  }>;
}
