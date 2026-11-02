import { createHash } from 'node:crypto';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { closedSourceContourLiterals } from '../../src/core/source-contours.js';
import { topologySignature } from '../../src/core/anatomy-gen.js';

/** Индексы принадлежат build contract, публичная анатомия получает stable IDs. */
export function projectAuthorSourceContours(source, declarations, composition, refuse) {
  if (!composition || Object.keys(composition).sort().join(',') !== 'fillRule,kind' || composition.kind !== 'compound') {
    refuse('ANNOTATION_INVALID', 'Нужен явный compound fill owner.');
  }
  const entries = authorPathEntries(source.artifactSvg), originals = authorPathEntries(source.normalizedSvg);
  if (composition.fillRule !== 'evenodd' || entries.length !== 1 || originals.length !== 1 ||
      entries[0].fillRule !== 'evenodd' || originals[0].fillRule !== 'evenodd' || declarations.length < 2 || declarations.length > 16 ||
      declarations[0].role !== 'container' || declarations.slice(1).some(part => part.role !== 'counter')) {
    refuse('PARTS_INVALID', 'Нужен один evenodd parent, его container и явно объявленные counter части.');
  }
  let literals, raw;
  try { literals = closedSourceContourLiterals(entries[0].d); raw = closedSourceContourLiterals(originals[0].d); }
  catch { refuse('PARTS_INVALID', 'Contour selection требует закрытые absolute-M fragments.'); }
  if (literals.length !== raw.length || declarations.some(part => part.pathIndex !== 0 || !Array.isArray(part.contourIndices) ||
      part.contourIndices.length !== 1 || !Number.isSafeInteger(part.contourIndices[0])) ||
      declarations.flatMap(part => part.contourIndices).some((index, position) => index !== position) || declarations.length !== literals.length) {
    refuse('PARTS_INVALID', 'Каждый contour одного parent должен покрываться ровно один раз в авторском порядке.');
  }
  const fingerprint = d => `sha256:${createHash('sha256').update(`null\0${JSON.stringify(parsePathData(d))}`).digest('hex')}`;
  let offset = 0;
  return declarations.map((part, index) => {
    const sourceSpan = [offset, offset += literals[index].length];
    return { ...source.sourceContract.parts[0], id: part.id, identity: 'declared', role: part.role,
      zIndex: index, fillRule: null, contourIndices: [...part.contourIndices], sourceSpan,
      topologySignature: topologySignature(literals[index]),
      sourceFingerprint: fingerprint(raw[index]), artifactFingerprint: fingerprint(literals[index]) };
  });
}
