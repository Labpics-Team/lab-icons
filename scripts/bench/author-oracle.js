import { createHash } from 'node:crypto';
import { optimize } from 'svgo';
import { authorPathEntries, sourcePathEntries } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** XML parser снимает только объявленные IR metadata; geometry language остаётся закрытым. */
export function inspectAuthorSvg(svg, { ir = false, expectedMetadata, composition } = {}) {
  if (expectedMetadata !== undefined && (!ir || !Array.isArray(expectedMetadata))) {
    throw new TypeError('benchmark oracle: expected metadata требует IR и упорядоченный список частей');
  }
  const compound = composition?.kind === 'compound';
  if (composition !== undefined && (compound
    ? !ir || composition.fillRule !== 'evenodd' || Object.keys(composition).sort().join(',') !== 'fillRule,kind' ||
      !expectedMetadata?.length
    : composition.kind !== 'layers' || Object.keys(composition).join(',') !== 'kind')) {
    throw new TypeError('benchmark oracle: нужна объявленная source composition и metadata общего parent');
  }
  const metadata = [];
  const parsed = optimize(svg, { multipass: false, plugins: [{
    name: 'observe-source-symbol',
    fn: () => ({ element: { enter(node) {
      if (node.name !== 'svg' && node.name !== 'path') throw new Error(`benchmark oracle: <${node.name}> вне source layers`);
      if (node.name === 'path' && ir) {
        if (compound) {
          if (metadata.length || node.attributes['data-part'] !== undefined || node.attributes['data-role'] !== undefined ||
              node.attributes['data-parts'] !== expectedMetadata.map(part => part.id).join(' ') ||
              node.attributes['data-roles'] !== expectedMetadata.map(part => part.role).join(' ')) {
            throw new Error('benchmark oracle: compound parent утратил ordered contour metadata или стал независимыми слоями');
          }
          metadata.push(...expectedMetadata.map(({ id, role }) => ({ id, role })));
          delete node.attributes['data-parts'];
          delete node.attributes['data-roles'];
          return;
        }
        const expected = expectedMetadata?.[metadata.length];
        if (node.attributes['data-parts'] !== undefined || node.attributes['data-roles'] !== undefined ||
            !node.attributes['data-part'] || (expectedMetadata === undefined
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
  if (compound && (paths.length !== 1 || paths[0].fillRule !== composition.fillRule)) {
    throw new Error('benchmark oracle: compound source требует один точный evenodd fill owner');
  }
  return {
    svgSha256: sha256(svg),
    pathFingerprintSha256: sha256(stableJSON(paths)),
    paths,
    metadata,
    complexity: { svgBytes: Buffer.byteLength(svg), paths: paths.length, pathDataBytes: paths.reduce((sum, path) => sum + Buffer.byteLength(path.d), 0), commands: paths.reduce((sum, path) => sum + (path.d.match(/[MmLlHhVvCcSsQqTtAaZz]/g)?.length ?? 0), 0) },
  };
}

/** Parts следуют независимому author contract; DOM path не становится contour. */
export function expectedAuthorObservation(icon, variant, record, contract) {
  const source = inspectAuthorSvg(record.artifactSvg);
  if (source.pathFingerprintSha256 !== record.normalizedSource.pathFingerprintSha256) {
    throw new Error(`${icon}/${variant}: author fingerprint не совпадает с manifest`);
  }
  const composition = contract.composition ?? { kind: 'layers' };
  let parts;
  if (composition.kind === 'compound') {
    if (composition.fillRule !== 'evenodd' || source.paths.length !== 1 || source.paths[0].fillRule !== 'evenodd' ||
        contract.parts.length < 2 || new Set(contract.parts.map(part => part.id)).size !== contract.parts.length) {
      throw new Error('benchmark oracle: source compound не соответствует одному evenodd parent');
    }
    const parent = source.paths[0].d;
    let cursor = 0;
    parts = contract.parts.map((part, index) => {
      const span = part.sourceSpan;
      if (!Array.isArray(span) || span.length !== 2 || span.some(value => !Number.isSafeInteger(value)) ||
          span[0] !== cursor || span[1] <= span[0] || span[1] > parent.length ||
          stableJSON(part.contourIndices) !== stableJSON([index]) || part.zIndex !== index || part.fillRule !== null ||
          part.role !== (index === 0 ? 'container' : 'counter')) {
        throw new Error('benchmark oracle: source compound теряет ordered contour coverage');
      }
      const d = parent.slice(span[0], span[1]), segments = parsePathData(d);
      if (!/^[\t\n\r ]*M/.test(d) || /m/.test(d) || segments.length < 2 || segments[0].cmd !== 'M' ||
          segments.at(-1).cmd !== 'Z' || segments.filter(segment => segment.cmd === 'M' || segment.cmd === 'Z').length !== 2) {
        throw new Error('benchmark oracle: source compound span не является целым замкнутым contour');
      }
      cursor = span[1];
      return { id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d };
    });
    if (cursor !== parent.length) throw new Error('benchmark oracle: source compound не покрывает весь parent');
  } else {
    if (composition.kind !== 'layers' || source.paths.length !== contract.parts.length) {
      throw new Error('benchmark oracle: source layers утратили независимые path owners');
    }
    parts = contract.parts.map((part, index) => {
      if (part.fillRule !== source.paths[index].fillRule) throw new Error('benchmark oracle: source layer изменил fill rule');
      return { id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: source.paths[index].d };
    });
  }
  return { icon, variant, master: record.master, author: record.author, anatomy: contract.anatomy ?? null, composition,
    artifactSha256: sha256(record.artifactSvg), pathFingerprintSha256: source.pathFingerprintSha256,
    priorGeometryFingerprint: record.normalizedSource.priorGeometryFingerprint, partsSha256: sha256(stableJSON(parts)) };
}

/** Снимает фактический packet после измерения; допуск задаёт независимый manifest. */
export function observeAuthorGlyph(glyph, staticSvg, renderedSvg = glyph.svg) {
  const parts = glyph.parts.map(({ id, role, zIndex, fillRule, d }) => ({ id, role, zIndex, fillRule, d }));
  return { icon: glyph.icon, variant: glyph.variant, sourceFile: glyph.provenance.file,
    compositionKind: glyph.composition.kind, composition: glyph.composition, author: glyph.provenance.author, anatomy: glyph.provenance.anatomy ?? null,
    staticArtifactSha256: sha256(staticSvg), parts,
    ...inspectAuthorSvg(renderedSvg, { ir: true, composition: glyph.composition, expectedMetadata: parts.map(({ id, role }) => ({ id, role })) }) };
}

/** Неравенство сохраняется как confound, но неподтверждённый новый рисунок всегда RED. */
export function validateAuthorObservation(observation, expected) {
  const composition = expected.composition ?? { kind: 'layers' };
  if (observation.icon !== expected.icon || observation.variant !== expected.variant ||
      observation.sourceFile !== expected.master || observation.compositionKind !== composition.kind ||
      stableJSON(observation.composition ?? { kind: observation.compositionKind }) !== stableJSON(composition)) {
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

/** Проверяет представимость raw source, не строя Lottie contours или target. */
function sourceSupportsLottie(svg, compositionKind, parts) {
  if (compositionKind !== 'layers' || !parts.length || new Set(parts.map(part => part.id)).size !== parts.length) return false;
  try {
    const entries = authorPathEntries(svg);
    if (entries.length !== parts.length) return false;
    return entries.every((entry, index) => {
      if (entry.fillRule !== parts[index].fillRule) return false;
      const segments = parsePathData(entry.d);
      if (!segments.length || segments.some(segment => Object.values(segment).some(value => typeof value === 'number' && !Number.isFinite(value)))) return false;
      let open = false, start, cursor;
      for (const segment of segments) {
        if (segment.cmd === 'M') {
          if (open) return false;
          open = true; start = cursor = [segment.x, segment.y];
        } else if (segment.cmd === 'Z') {
          if (!open) return false;
          open = false; cursor = start;
        } else {
          const end = [segment.x, segment.y];
          // Совпадающие endpoints дуги не рисуют ничего, в том числе после Z.
          if (segment.cmd === 'A' && segment.rx !== 0 && segment.ry !== 0 && cursor && cursor[0] === end[0] && cursor[1] === end[1]) continue;
          if (!open) return false;
          if (segment.cmd === 'A') {
            if (segment.rx !== 0 && segment.ry !== 0 && (cursor[0] !== end[0] || cursor[1] !== end[1])) return false;
          } else if (segment.cmd === 'C' || segment.cmd === 'Q') {
            // Относительные tangents должны оставаться конечными в Number.
            const controls = segment.cmd === 'C' ? [[segment.x1, segment.y1], [segment.x2, segment.y2]] : [
              cursor.map((value, axis) => value + ([segment.x1, segment.y1][axis] - value) * 2 / 3),
              end.map((value, axis) => value + ([segment.x1, segment.y1][axis] - value) * 2 / 3),
            ];
            if (controls.some((control, position) => control.some((value, axis) =>
              !Number.isFinite(value) || !Number.isFinite(value - (position === 0 ? cursor : end)[axis])))) return false;
          } else if (segment.cmd !== 'L') return false;
          cursor = end;
        }
      }
      return !open;
    });
  } catch { return false; }
}

/** Source fixture и shipped package различаются только явно заданным target-контекстом. */
export function expectedAuthorMotion(contract, context = { kind: 'source' }) {
  if (!context || !['source', 'package'].includes(context.kind) ||
      Object.keys(context).some(key => !(context.kind === 'source' ? ['kind'] : ['kind', 'svg', 'compositionKind']).includes(key)) ||
      (context.kind === 'package' && (typeof context.svg !== 'string' || typeof context.compositionKind !== 'string'))) {
    throw new TypeError('benchmark oracle: нужен явный source/package контекст с raw SVG и composition для package');
  }
  const ready = Boolean(contract.anatomy && contract.gestures?.length);
  const gestures = ready ? contract.gestures : [];
  const lottie = context.kind === 'package' && ready && sourceSupportsLottie(context.svg, context.compositionKind, contract.parts)
    ? 'lottie-web-svg-5.13' : 'not-exported';
  return {
    state: ready ? 'gesture-ready' : contract.anatomy ? 'semantic-parts' : 'source-only',
    partIds: contract.anatomy ? contract.parts.map(part => part.id) : [],
    tracks: [...new Map(gestures.flatMap(gesture => gesture.tracks.map(track => {
      const id = track.kind === 'translate' ? `${track.kind}.${track.axis}.${track.partId}` : `${track.kind}.${track.partId}`;
      return [id, { id, kind: track.kind, partIds: [track.partId],
        ...(track.kind === 'rotate' ? { anchor: track.anchor }
          : track.kind === 'translate' ? { axis: track.axis, unit: track.unit } : {}) }];
    }))).values()],
    gestures,
    adapters: { lottie, sfSymbols: 'not-exported' },
  };
}

/** Наличие частей ещё не означает наличие принятого жеста. */
export function expectedAuthorMotionRefusal(contract, gestureId) {
  const motion = expectedAuthorMotion(contract);
  if (motion.state !== 'gesture-ready') return 'SEMANTIC_MOTION_UNAVAILABLE';
  return motion.gestures.some(gesture => gesture.id === gestureId) ? null : 'GESTURE_UNSUPPORTED';
}

export function expectedAuthorEffectTargets(gesture) {
  return gesture.tracks.map(track => track.kind === 'opacity' ? {
    partId: track.partId, property: 'opacity', from: track.stops[0].value, to: track.stops.at(-1).value,
  } : track.kind === 'translate' ? {
    partId: track.partId, property: track.axis, from: track.stops[0].value, to: track.stops.at(-1).value, unit: 'viewBox',
  } : {
    partId: track.partId,
    rotation: { from: track.from, to: track.to, unit: 'degrees' },
    style: { transformBox: 'view-box', transformOrigin: `${track.anchor[0] * 100}% ${track.anchor[1] * 100}%` },
    keyframes: [{ offset: 0, transform: `rotate(${track.from}deg)` }, { offset: 1, transform: `rotate(${track.to}deg)` }],
  });
}

/** Независимая full-timeline projection от декларации, без импорта motion compiler. */
export function expectedAuthorEffect(gesture, duration = 360) {
  const opacity = gesture.tracks.every(track => track.kind === 'opacity');
  const translation = gesture.tracks.every(track => track.kind === 'translate');
  const targets = expectedAuthorEffectTargets(gesture);
  if (!opacity && !translation) return { version: 1, targets };
  const stages = gesture.tracks.flatMap(track => track.stops.slice(1).map((stop, index) => {
    const at = track.stops[index].at * duration;
    return { partId: track.partId, property: opacity ? 'opacity' : track.axis,
      ...(translation ? { unit: 'viewBox' } : {}), to: stop.value, at, duration: stop.at * duration - at };
  })).sort((a, b) => a.at - b.at || (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
  return { version: opacity ? 2 : 3, targets, stages };
}

export function validateAuthorAdmission(glyph, caps, record, contract, context = { kind: 'source' }) {
  const anatomy = contract.anatomy ?? null;
  if (caps.icon !== glyph.icon || caps.variant !== glyph.variant || caps.modelState !== null ||
      caps.supportedAxes.length || Object.keys(caps.axes).length ||
      stableJSON(caps.author) !== stableJSON(record.author) ||
      stableJSON(caps.anatomy ?? null) !== stableJSON(anatomy) ||
      stableJSON(glyph.provenance.anatomy ?? null) !== stableJSON(anatomy) ||
      stableJSON(caps.motion) !== stableJSON(expectedAuthorMotion(contract, context))) {
    throw new Error('benchmark oracle: неподтверждённые current capabilities или anatomy');
  }
  if (glyph.parts.length !== contract.parts.length || glyph.parts.some((part, index) => {
    const expected = contract.parts[index];
    return part.provenance.kind !== 'source' || part.provenance.identity !== expected.identity ||
      part.morphGroup !== null || part.role !== expected.role ||
      (anatomy && expected.anchor ? part.anchorSource !== 'declared' || stableJSON(part.anchor) !== stableJSON(expected.anchor)
        : part.anchorSource !== 'geometry-bbox-center');
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
