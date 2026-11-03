import { compactDataLiteral, jsonDataLiteral } from './generated-module.js';
import { runtimeModuleSpecifiers } from './release-contract.js';

/** Runtime target существует только при настоящем import из compiler output. */
export function sourcePacketRuntimeTargets(outputs) {
  const used = outputs.some(output => Object.values(output).some(text => typeof text === 'string' &&
    runtimeModuleSpecifiers(text).specifiers.includes('../ir/source-packet-runtime.js')));
  return used ? [{ entry: 'src/ir/source-packet-runtime.ts', runtime: 'source-packet-runtime.js' }] : [];
}

const SOURCE_KEYS = ['icon', 'variant', 'viewBox', 'parts', 'd', 'svg', 'composition', 'provenance'];
const PART_KEYS = ['id', 'role', 'zIndex', 'd', 'fillRule', 'paint', 'anchor', 'anchorSource', 'topologySignature', 'morphGroup', 'provenance'];
const PART_PROVENANCE_KEYS = ['kind', 'identity', 'file', 'sourceFingerprint', 'artifactFingerprint'];
const keysEqual = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value)) === JSON.stringify(keys);
const equal = (left, right) => jsonDataLiteral(left) === jsonDataLiteral(right);

/** Build-only admission; extension records и другой paint сохраняют literal layout. */
export function sourcePacketEligible(shape, icon, variant) {
  if (!keysEqual(shape, SOURCE_KEYS) || shape.icon !== icon || shape.variant !== variant ||
      !equal(shape.viewBox, [0, 0, 24, 24]) || !equal(shape.composition, { kind: 'layers' }) ||
      !keysEqual(shape.provenance, ['kind', 'file', 'anatomy', 'author']) || shape.provenance.kind !== 'source' ||
      typeof shape.provenance.file !== 'string' || !shape.provenance.author || !shape.provenance.anatomy ||
      typeof shape.d !== 'string' || typeof shape.svg !== 'string' || !Array.isArray(shape.parts) || !shape.parts.length) return false;
  return shape.parts.every(part => keysEqual(part, PART_KEYS) && equal(part.paint, { kind: 'fill', fill: 'currentColor' }) &&
    part.morphGroup === null && typeof part.d === 'string' && part.d.length &&
    keysEqual(part.provenance, PART_PROVENANCE_KEYS) && part.provenance.kind === 'source' &&
    part.provenance.file === shape.provenance.file && part.provenance.sourceFingerprint === part.provenance.artifactFingerprint);
}

/** Отношения принадлежат build projection; callback не выводит семантику из пути. */
export function translationCyclePacket(motion) {
  if (!motion || typeof motion !== 'object') return null;
  const gesture = motion.gestures?.[0], track = gesture?.tracks?.[0], amplitude = track?.stops?.[1]?.value;
  if (typeof gesture?.id !== 'string' || typeof gesture?.meaning !== 'string' || typeof track?.partId !== 'string' ||
      !Number.isFinite(amplitude) || amplitude <= 0 || amplitude / 2 <= 0 ||
      !Array.isArray(motion.partIds) || motion.partIds.some(id => typeof id !== 'string')) return null;
  const partId = track.partId;
  const reconstructed = {
    state: 'gesture-ready', partIds: motion.partIds,
    tracks: [{ id: `translate.x.${partId}`, kind: 'translate', partIds: [partId], axis: 'x', unit: 'viewBox' }],
    gestures: [{
      id: gesture.id, kind: 'cycle', meaning: gesture.meaning, partIds: [partId], progress: 'normalized-0-to-1', restProgress: 0,
      tracks: [{ partId, kind: 'translate', axis: 'x', unit: 'viewBox', interpolation: 'linear', stops: [
        { at: 0, value: 0 }, { at: 0.2, value: amplitude }, { at: 0.4, value: -amplitude },
        { at: 0.6, value: amplitude / 2 }, { at: 0.8, value: -amplitude / 2 }, { at: 1, value: 0 },
      ] }],
    }],
    adapters: { lottie: 'lottie-web-svg-5.13', sfSymbols: 'not-exported' },
  };
  return equal(motion, reconstructed) ? [gesture.id, motion.partIds, partId, gesture.meaning, amplitude] : null;
}

/** Полная source materialization заключена в PURE, включая exact string operands. */
export function sourcePacketExpression(shape, geometry, metadata, stringExpression, wrap = true) {
  const parts = shape.parts.map((part, index) => `[${[
    compactDataLiteral(part.id), compactDataLiteral(part.role), compactDataLiteral(part.zIndex), geometry[index][1],
    compactDataLiteral(part.fillRule), compactDataLiteral(part.anchor), compactDataLiteral(part.anchorSource),
    compactDataLiteral(part.topologySignature), compactDataLiteral(part.provenance.identity), compactDataLiteral(part.provenance.sourceFingerprint),
  ].join(',')}]`);
  const arguments_ = [compactDataLiteral(shape.icon), compactDataLiteral(shape.variant), compactDataLiteral(shape.provenance.file),
    `[${parts.join(',')}]`, stringExpression(shape.d, geometry), stringExpression(shape.svg, geometry),
    metadata.get('author') ?? compactDataLiteral(shape.provenance.author), metadata.get('anatomy') ?? compactDataLiteral(shape.provenance.anatomy)];
  const expression = `materializeSourceV1(${arguments_.join(',')})`;
  return wrap ? `/* @__PURE__ */ (() => ${expression})()` : expression;
}

export const cyclePacketExpression = (packet, annotate = true) =>
  `${annotate ? '/* @__PURE__ */ ' : ''}materializeTranslationCycleV1(${packet.map(compactDataLiteral).join(',')})`;
