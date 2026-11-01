import { createHash } from 'node:crypto';
import { optimize } from 'svgo';
import { sourcePathEntries } from '../../src/core/icon-geometry.js';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** XML parser снимает только объявленные IR metadata; geometry language остаётся закрытым. */
export function inspectAuthorSvg(svg, { ir = false, expectedMetadata } = {}) {
  if (expectedMetadata !== undefined && (!ir || !Array.isArray(expectedMetadata))) {
    throw new TypeError('benchmark oracle: expected metadata требует IR и упорядоченный список частей');
  }
  const metadata = [];
  const parsed = optimize(svg, { multipass: false, plugins: [{
    name: 'observe-source-symbol',
    fn: () => ({ element: { enter(node) {
      if (node.name !== 'svg' && node.name !== 'path') throw new Error(`benchmark oracle: <${node.name}> вне source layers`);
      if (node.name === 'path' && ir) {
        const expected = expectedMetadata?.[metadata.length];
        if (!node.attributes['data-part'] || (expectedMetadata === undefined
          ? node.attributes['data-role'] !== 'unclassified'
          : !expected || node.attributes['data-part'] !== expected.id || node.attributes['data-role'] !== expected.role)) {
          throw new Error('benchmark oracle: источник имеет выдуманную semantic anatomy или другую part identity');
        }
        metadata.push({ id: node.attributes['data-part'], role: node.attributes['data-role'] });
        delete node.attributes['data-part'];
        delete node.attributes['data-role'];
      }
    } } }),
  }] }).data;
  if (expectedMetadata !== undefined && metadata.length !== expectedMetadata.length) {
    throw new Error('benchmark oracle: неполная semantic anatomy');
  }
  const paths = sourcePathEntries(parsed);
  return {
    svgSha256: sha256(svg),
    pathFingerprintSha256: sha256(stableJSON(paths)),
    paths,
    metadata,
    complexity: { svgBytes: Buffer.byteLength(svg), paths: paths.length, pathDataBytes: paths.reduce((sum, path) => sum + Buffer.byteLength(path.d), 0), commands: paths.reduce((sum, path) => sum + (path.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g)?.length ?? 0), 0) },
  };
}

/** Неравенство сохраняется как confound, но неподтверждённый новый рисунок всегда RED. */
export function validateAuthorObservation(observation, expected) {
  if (observation.icon !== expected.icon || observation.variant !== expected.variant ||
      observation.sourceFile !== expected.master || observation.compositionKind !== 'layers') {
    throw new Error('benchmark oracle: source identity или layer composition изменена');
  }
  if (observation.author?.pathFingerprintSha256 !== expected.pathFingerprintSha256 ||
      observation.pathFingerprintSha256 !== expected.pathFingerprintSha256 ||
      observation.staticArtifactSha256 !== expected.artifactSha256 ||
      stableJSON(observation.author) !== stableJSON(expected.author)) {
    throw new Error('benchmark oracle: consumer не соответствует точному Figma master/manifest');
  }
  if (sha256(stableJSON(observation.parts)) !== expected.partsSha256 ||
      stableJSON(observation.metadata) !== stableJSON(observation.parts.map(({ id, role }) => ({ id, role })))) {
    throw new Error('benchmark oracle: утрачены contours, winding, z-order или stable part identity');
  }
  if (stableJSON(observation.anatomy ?? null) !== stableJSON(expected.anatomy ?? null)) {
    throw new Error('benchmark oracle: anatomy не соответствует проверенной source annotation');
  }
}

/** Движение ожидается из проверенной декларации, не из capabilities потребителя. */
export function expectedAuthorMotion(contract) {
  const gestures = contract.anatomy ? contract.gestures : [];
  return {
    state: contract.anatomy ? 'gesture-ready' : 'source-only',
    partIds: contract.anatomy ? contract.parts.map(part => part.id) : [],
    tracks: gestures.flatMap(gesture => gesture.tracks.map(track => ({
      id: `rotate.${track.partId}`, kind: 'rotate', partIds: [track.partId], anchor: track.anchor,
    }))),
    gestures,
    adapters: { lottie: 'not-exported', sfSymbols: 'not-exported' },
  };
}

export function expectedAuthorEffectTargets(gesture) {
  return gesture.tracks.map(track => ({
    partId: track.partId,
    rotation: { from: track.from, to: track.to, unit: 'degrees' },
    style: { transformBox: 'view-box', transformOrigin: `${track.anchor[0] * 100}% ${track.anchor[1] * 100}%` },
    keyframes: [{ offset: 0, transform: `rotate(${track.from}deg)` }, { offset: 1, transform: `rotate(${track.to}deg)` }],
  }));
}

export function validateAuthorAdmission(glyph, caps, record, contract) {
  const anatomy = contract.anatomy ?? null;
  if (caps.icon !== glyph.icon || caps.variant !== glyph.variant || caps.modelState !== null ||
      caps.supportedAxes.length || Object.keys(caps.axes).length ||
      stableJSON(caps.author) !== stableJSON(record.author) ||
      stableJSON(caps.anatomy ?? null) !== stableJSON(anatomy) ||
      stableJSON(glyph.provenance.anatomy ?? null) !== stableJSON(anatomy) ||
      stableJSON(caps.motion) !== stableJSON(expectedAuthorMotion(contract))) {
    throw new Error('benchmark oracle: неподтверждённые current capabilities или anatomy');
  }
  if (glyph.parts.length !== contract.parts.length || glyph.parts.some((part, index) => {
    const expected = contract.parts[index];
    return part.provenance.kind !== 'source' || part.provenance.identity !== expected.identity ||
      part.morphGroup !== null || part.role !== expected.role ||
      (anatomy && (part.anchorSource !== 'declared' || stableJSON(part.anchor) !== stableJSON(expected.anchor)));
  })) throw new Error('benchmark oracle: source identity или declared anchor не соответствует anatomy');
}

/** Число DOM path включает mask payload: это объявленная структурная сложность, не ink area. */
export function svgComplexity(svg) {
  let paths = 0, pathDataBytes = 0, commands = 0;
  optimize(svg, { multipass: false, plugins: [{ name: 'measure-path-complexity', fn: () => ({ element: { enter(node) {
    if (node.name === 'path') {
      paths++;
      const d = node.attributes.d ?? '';
      pathDataBytes += Buffer.byteLength(d);
      commands += d.match(/[MmLlHhVvCcSsQqTtAaZz]/g)?.length ?? 0;
    }
  } } }) }] });
  return { svgBytes: Buffer.byteLength(svg), paths, pathDataBytes, commands };
}

export function validateRetainedPair(baseline, candidate) {
  if (baseline.svgSha256 !== candidate.svgSha256 || baseline.completedBytes !== candidate.completedBytes || baseline.completed !== candidate.completed) {
    throw new Error('benchmark oracle: retained lane меняет полезный SVG output');
  }
}
