import type { GlyphCapabilities, GlyphIR, GlyphRequest, SourceGlyphProvenance } from './compiler.js';
import type { AuthorIconId } from './author-catalog.generated.js';

export type { AuthorIconId } from './author-catalog.generated.js';

/** Привязка анатомии к мастеру; конструктивную модель или оси не удостоверяет. */
export interface AuthorAnatomyReceipt {
  readonly version: 1;
  readonly annotationSha256: string;
  readonly masterSha256: string;
  readonly pathFingerprintSha256: string;
}

/** Хеши относятся к закреплённым bytes/node/version, не к геометрической модели. */
export interface AuthorSourceProvenance {
  readonly kind: 'figma';
  readonly fileKey: string;
  readonly version: string;
  readonly nodeId: string;
  readonly nodeSha256: string;
  readonly masterSha256: string;
  readonly normalizedSha256: string;
  readonly pathFingerprintSha256: string;
}

export type AuthorSymbolGlyphRequest = Omit<GlyphRequest<AuthorIconId>, 'icon'>;

export interface AuthorSourceGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
  readonly provenance: SourceGlyphProvenance & Readonly<{ author: AuthorSourceProvenance }>;
}

export interface AuthorSourceCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends GlyphCapabilities<TIcon> {
  readonly modelState: null;
  readonly supportedAxes: readonly [];
  readonly axes: Readonly<Record<string, never>>;
  readonly author: AuthorSourceProvenance;
}
