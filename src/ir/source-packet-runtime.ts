import type { GlyphIR, GlyphPart, IconVariant, MotionCapabilities, SourcePartProvenance } from './glyph-types.js';
import type { AuthorAnatomyReceipt, AuthorSourceProvenance } from './author-provenance.js';

/** @internal Закрытый target packet; build проверяет каждое фиксированное поле. */
export type SourcePacketPartV1 = readonly [
  id: string, role: GlyphPart['role'], zIndex: number, d: string, fillRule: GlyphPart['fillRule'],
  anchor: GlyphPart['anchor'], anchorSource: GlyphPart['anchorSource'], topologySignature: string,
  identity: SourcePartProvenance['identity'], fingerprint: SourcePartProvenance['sourceFingerprint'],
];

/** @internal Материализация один раз; path и topology не разбираются. */
export function materializeSourceV1<TIcon extends string>(
  icon: TIcon, variant: IconVariant, file: string, parts: readonly SourcePacketPartV1[],
  d: string, svg: string, author: AuthorSourceProvenance, anatomy: AuthorAnatomyReceipt,
): GlyphIR<TIcon> {
  return {
    icon, variant, viewBox: [0, 0, 24, 24],
    parts: parts.map(p => ({
      id: p[0], role: p[1], zIndex: p[2], d: p[3], fillRule: p[4],
      paint: { kind: 'fill', fill: 'currentColor' }, anchor: p[5], anchorSource: p[6],
      topologySignature: p[7], morphGroup: null,
      provenance: { kind: 'source', identity: p[8], file, sourceFingerprint: p[9], artifactFingerprint: p[9] },
    })),
    d, svg, composition: { kind: 'layers' }, provenance: { kind: 'source', file, anatomy, author },
  };
}

/** @internal Закрытая запись шести stops; допуск требует exact отношения значений. */
export function materializeTranslationCycleV1(
  gestureId: string, partIds: readonly string[], partId: string, meaning: string, amplitude: number,
): MotionCapabilities {
  return {
    state: 'gesture-ready', partIds,
    tracks: [{ id: `translate.x.${partId}`, kind: 'translate', partIds: [partId], axis: 'x', unit: 'viewBox' }],
    gestures: [{
      id: gestureId, kind: 'cycle', meaning, partIds: [partId], progress: 'normalized-0-to-1', restProgress: 0,
      tracks: [{
        partId, kind: 'translate', axis: 'x', unit: 'viewBox', interpolation: 'linear',
        stops: [
          { at: 0, value: 0 }, { at: 0.2, value: amplitude }, { at: 0.4, value: -amplitude },
          { at: 0.6, value: amplitude / 2 }, { at: 0.8, value: -amplitude / 2 }, { at: 1, value: 0 },
        ],
      }],
    }],
    adapters: { lottie: 'lottie-web-svg-5.13', sfSymbols: 'not-exported' },
  };
}
