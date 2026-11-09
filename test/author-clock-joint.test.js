import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorClockJoint, AuthorClockJointError } from '../scripts/lib/author-clock-joint.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { parsePathData, samplePath, pathBBox } from '../src/core/path-data.js';
import { closedSourceContourLiterals } from '../src/core/source-contours.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../semantics/figma-baseline.json', import.meta.url), 'utf8'));
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: 2, variants: 4 },
  icons: { time: manifest.icons.time, history: manifest.icons.history } } });
const hash = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const examples = [
  { icon: 'time', variant: 'outline', pathIndex: 0, contourIndex: 0, polarity: 'positive', bearing: [12, 12.0068] },
  { icon: 'time', variant: 'filled', pathIndex: 0, contourIndex: 1, polarity: 'negative', bearing: [12, 12.0049] },
  { icon: 'history', variant: 'outline', pathIndex: 1, contourIndex: 0, polarity: 'positive', bearing: [11.9639, 13.1485] },
  { icon: 'history', variant: 'filled', pathIndex: 1, contourIndex: 0, polarity: 'positive', bearing: [12.0068, 12.96] },
];
const declaration = record => ({ pathIndex: record.pathIndex, contourIndex: record.contourIndex, polarity: record.polarity,
  partIds: { minute: 'long-clock-hand', hour: 'short-clock-hand' } });
const compiled = examples.map(record => ({ ...record, source: baseline.icons[record.icon][record.variant],
  program: compileAuthorClockJoint(baseline.icons[record.icon][record.variant], declaration(record)) }));

function materialize(operand, transform = p => p) {
  let index = 0;
  return [...operand.commands].map(command => {
    const count = { M: 1, L: 1, C: 3, Z: 0 }[command];
    if (count === undefined) throw new Error('Неподдерживаемый contour operand');
    const values = operand.points.slice(index, index + count).flatMap(transform); index += count;
    return command + values.join(' ');
  }).join('');
}
function edgeRecords(d) {
  const output = []; let first, previous;
  for (const segment of parsePathData(d)) {
    if (segment.cmd === 'M') first = previous = [segment.x, segment.y];
    else if (segment.cmd === 'Z') {
      if (previous[0] !== first[0] || previous[1] !== first[1]) output.push({ kind: 'L', start: previous, end: first });
    } else {
      const end = [segment.x, segment.y];
      output.push({ kind: segment.cmd, start: previous, end,
        ...(segment.cmd === 'C' && { controls: [[segment.x1, segment.y1], [segment.x2, segment.y2]] }) });
      previous = end;
    }
  }
  return output;
}
const reverse = edges => [...edges].reverse().map(edge => ({ ...edge, start: edge.end, end: edge.start,
  ...(edge.controls && { controls: [...edge.controls].reverse() }) }));
const edgeKey = edge => JSON.stringify(edge);
function contains(polygon, point) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) &&
        point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const rotate = (bearing, degrees) => p => {
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const x = p[0] - bearing[0], y = p[1] - bearing[1];
  return [bearing[0] + c * x - s * y, bearing[1] + s * x + c * y];
};
function rebind(source, artifactSvg) {
  return { ...source, rawSvg: artifactSvg, artifactSvg, author: { ...source.author,
    masterSha256: hash(artifactSvg), pathFingerprintSha256: hash(stableJSON(authorPathEntries(artifactSvg))) } };
}
function replaceParent(source, index, d, fillRule) {
  const entries = authorPathEntries(source.artifactSvg);
  const artifactSvg = `<svg width="24" height="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${entries.map((entry, i) =>
    `<path d="${i === index ? d : entry.d}" fill="currentColor" fill-rule="${i === index ? fillRule ?? entry.fillRule : entry.fillRule}"/>`).join('')}</svg>`;
  return rebind(source, artifactSvg);
}
function encodeEdges(edges) {
  return `M${edges[0].start.join(' ')}${edges.map(edge => edge.kind + [...(edge.controls ?? []), edge.end].flat().join(' ')).join('')}Z`;
}

describe('авторские clock hands достраивают скрытый стык вместо подмены рисунка', () => {
  it.each(compiled)('$icon/$variant сохраняет все authored exterior edges и исходный master', record => {
    const { program, source } = record, exterior = program.evidence.exterior;
    const parent = authorPathEntries(source.artifactSvg)[record.pathIndex];
    expect(program.original).toEqual({ d: closedSourceContourLiterals(parent.d)[record.contourIndex], fillRule: parent.fillRule });
    expect(program.source).toMatchObject({ masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256, contourSha256: hash(program.original.d) });
    const indices = [...exterior.minuteEdgeIndices, ...exterior.hourEdgeIndices, ...exterior.sharedElbowEdgeIndices].sort((a, b) => a - b);
    expect(indices).toEqual(Array.from({ length: exterior.sourceEdgeCount }, (_, i) => i));
    const original = edgeRecords(program.original.d), canonical = exterior.reversed ? reverse(original) : original;
    const generated = new Set(program.limbs.flatMap(limb => edgeRecords(materialize(limb))).map(edgeKey));
    for (const edge of canonical) expect(generated.has(edgeKey(edge))).toBe(true);
    expect(program.limbs.map(limb => limb.id)).toEqual(['long-clock-hand', 'short-clock-hand']);
    expect(program.composition).toEqual({ kind: 'nonzero-union', winding: 1 });
    expect(Object.isFrozen(program.limbs[0].points[0])).toBe(true);
  });

  it.each(compiled)('$icon/$variant independently compares default source fill with the completed hand union', ({ program }) => {
    const original = samplePath(program.original.d, 16), limbs = program.limbs.map(limb => samplePath(materialize(limb), 16));
    const bounds = pathBBox(program.original.d);
    for (let y = 0; y < 13; y++) for (let x = 0; x < 17; x++) {
      const point = [bounds.minX + (x + .37) / 17 * (bounds.maxX - bounds.minX),
        bounds.minY + (y + .61) / 13 * (bounds.maxY - bounds.minY)];
      expect(limbs.some(limb => contains(limb, point))).toBe(contains(original, point));
    }
  });

  it.each(compiled)('$icon/$variant retains a positive shared bearing across independently changed angles', ({ program, bearing }) => {
    expect(program.bearing).toEqual(bearing);
    expect(program.evidence.connectedBearing.diskRadiusLowerBound).toBeGreaterThan(0);
    expect(program.evidence.connectedBearing.appliesTo).toBe('all-independent-rotation-angles-about-bearing');
    for (const [minuteAngle, hourAngle] of [[0, 0], [90, 7.5], [180, 15], [270, 22.5], [-143, 71], [17, -209]]) {
      const limbs = program.limbs.map((limb, i) => samplePath(materialize(limb, rotate(bearing, i ? hourAngle : minuteAngle)), 16));
      const radius = program.evidence.connectedBearing.diskRadiusLowerBound * .5;
      for (const delta of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
        for (const limb of limbs) expect(contains(limb, [bearing[0] + delta[0], bearing[1] + delta[1]])).toBe(true);
      }
    }
    expect(program.evidence.simplicity.contours).toHaveLength(3);
    expect(program.evidence.tangents.sourceLeftJoin.collinearForward).toBe(false);
  });

  it('прямой seam проходит rest equality, но при разделении открывает острый неавторский угол', () => {
    const { program } = compiled[0], { inside, left } = program.evidence.contacts;
    const cutCorner = [left[0], inside[1]], movedCorner = rotate([12, 12], 7.5)(cutCorner);
    const cutMinuteMinXAt90 = 24 - inside[1];
    const source = edgeRecords(program.original.d), exterior = program.evidence.exterior;
    const tail = exterior.minuteEdgeIndices.map(i => source[i]);
    const right = exterior.hourEdgeIndices.map(i => source[i]);
    const elbow = exterior.sharedElbowEdgeIndices.map(i => source[i]);
    const line = (start, end) => ({ kind: 'L', start, end });
    const cutMinute = encodeEdges([...tail.slice(1), line(inside, cutCorner), line(cutCorner, tail[0].end)]);
    const cutHour = encodeEdges([line(cutCorner, inside), ...right, ...elbow, line(left, cutCorner)]);
    const polygons = [cutMinute, cutHour].map(d => samplePath(d, 16)), original = samplePath(program.original.d, 16);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = [10.8 + x * .87, 5.3 + y * .91];
      expect(polygons.some(polygon => contains(polygon, p))).toBe(contains(original, p));
    }
    expect(movedCorner[0]).toBeLessThan(cutMinuteMinXAt90);
    expect(source.some(edge => edge.start[0] === cutCorner[0] && edge.start[1] === cutCorner[1])).toBe(false);
    expect(program.evidence.hiddenClosureContainment).toMatchObject({ upperLeft: 'source-left-body-half-plane', lowerRight: 'source-right-body-rectangle' });
  });

  it('History получает авторский bearing ниже canvas center, без общей координаты для семейства', () => {
    expect(compiled[2].program.bearing).toEqual([11.9639, 13.1485]);
    expect(compiled[3].program.bearing).toEqual([12.0068, 12.96]);
    expect(compiled[2].program.bearing).not.toEqual([12, 12]);
  });

  it('source winding меняет orientation operands; positive global reversal сохраняет физическую форму', () => {
    const { source, program } = compiled[0];
    const changed = replaceParent(source, 0, encodeEdges(reverse(edgeRecords(program.original.d))), 'nonzero');
    const next = compileAuthorClockJoint(changed, declaration(examples[0]));
    expect(next.evidence.sourceWinding).toBe(-1);
    expect(next.bearing).toEqual(program.bearing);
    expect(next.composition.winding).toBe(1);
  });

  it('Negative Time остаётся compiler program и не объявляет web либо evenodd motion target', () => {
    const program = compiled[1].program;
    expect(program.polarity).toBe('negative');
    expect(program.evidence.counterContainment.method).toBe('simple-disjoint-contours-exact-ray-winding');
    expect(program).not.toHaveProperty('motionAdmission');
    expect(program).not.toHaveProperty('formats');
    expect(program.composition.kind).toBe('nonzero-union');
  });

  it('source transformation и новые semantic IDs не требуют таблицы per-icon coordinates', () => {
    const { source, program } = compiled[0];
    const transformed = source.artifactSvg.replace(/\bd="([^"]*)"/g, (_, d) => {
      const mapped = edgeRecords(d).map(edge => ({ ...edge,
        start: edge.start.map((x, axis) => x * .75 + (axis ? 2 : 1)),
        end: edge.end.map((x, axis) => x * .75 + (axis ? 2 : 1)),
        ...(edge.controls && { controls: edge.controls.map(p => p.map((x, axis) => x * .75 + (axis ? 2 : 1))) }) }));
      // Эта fixture меняет только выбранную hand path; compound enclosure хранит literal.
      return d === program.original.d ? `d="${encodeEdges(mapped)}"` : `d="${d}"`;
    });
    const next = compileAuthorClockJoint(rebind(source, transformed), { ...declaration(examples[0]), partIds: { minute: 'minute-custom', hour: 'hour-custom' } });
    expect(next.bearing).toEqual([10, 11.0051]);
    expect(next.limbs.map(limb => limb.id)).toEqual(['minute-custom', 'hour-custom']);
  });

  it('fingerprint mismatch и unsupported limb topology имеют точные отказы', () => {
    const { source } = compiled[0];
    expect(() => compileAuthorClockJoint({ ...source, rawSvg: source.rawSvg + ' ' }, declaration(examples[0])))
      .toThrowError(expect.objectContaining({ code: 'SOURCE_MISMATCH' }));
    const pointer = replaceParent(source, 0, 'M7 7L13 11L11 13Z', 'nonzero');
    expect(() => compileAuthorClockJoint(pointer, declaration(examples[0])))
      .toThrowError(expect.objectContaining({ code: 'JOINT_TOPOLOGY_UNSUPPORTED' }));
    const compound = replaceParent(source, 0, 'M0 0L4 0L4 4ZM6 6L8 6L8 8Z', 'nonzero');
    expect(() => compileAuthorClockJoint(compound, declaration(examples[0])))
      .toThrowError(expect.objectContaining({ code: 'SOURCE_COMPOSITION_UNSUPPORTED' }));
  });

  it.each([false, true])('evenodd принимает независимые направления outer/counter; outer reversal %j', reverseOuter => {
    const { source, program } = compiled[1], parts = closedSourceContourLiterals(authorPathEntries(source.artifactSvg)[0].d);
    const original = parts.map(d => samplePath(d, 16));
    for (const reverseInner of [false, true]) {
      const changedParts = parts.map((d, i) => (i ? reverseInner : reverseOuter) ? encodeEdges(reverse(edgeRecords(d))) : d);
      const changed = replaceParent(source, 0, changedParts.join(''), 'evenodd');
      const next = compileAuthorClockJoint(changed, declaration(examples[1]));
      expect(next.bearing).toEqual(program.bearing);
      expect(next.limbs).toEqual(program.limbs);
      expect(next.polarity).toBe('negative');
      expect(next.evidence.counterContainment.method).toBe('simple-disjoint-contours-exact-ray-winding');
      const projected = changedParts.map(d => samplePath(d, 16));
      for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
        const p = [x + .37, y + .61], fill = paths => paths.reduce((inside, path) => inside !== contains(path, p), false);
        expect(fill(projected)).toBe(fill(original));
      }
    }
  });

  it.each([0, 1])('zero-area contour %j сохраняет точный отказ', zeroIndex => {
    const { source } = compiled[1], parts = closedSourceContourLiterals(authorPathEntries(source.artifactSvg)[0].d);
    parts[zeroIndex] = 'M11 11L12 12L13 13Z';
    expect(() => compileAuthorClockJoint(replaceParent(source, 0, parts.join(''), 'evenodd'), declaration(examples[1])))
      .toThrowError(expect.objectContaining({ code: 'SOURCE_WINDING_UNSUPPORTED' }));
  });

  it('направление обхода не заменяет доказательство вложенности counter', () => {
    const { source } = compiled[1], parts = closedSourceContourLiterals(authorPathEntries(source.artifactSvg)[0].d);
    const changed = replaceParent(source, 0, 'M0 0L2 0L1 2Z' + parts[1], 'evenodd');
    expect(() => compileAuthorClockJoint(changed, declaration(examples[1])))
      .toThrowError(expect.objectContaining({ code: 'COMPOSITION_UNPROVEN' }));
  });

  it('неверная polarity не превращается в ложную capability', () => {
    const { source } = compiled[1];
    expect(() => compileAuthorClockJoint(source, { ...declaration(examples[1]), polarity: 'positive' }))
      .toThrowError(expect.objectContaining({ code: 'SOURCE_COMPOSITION_UNSUPPORTED' }));
  });

  it.each([undefined, {}, { pathIndex: -1 }, { ...declaration(examples[0]), partIds: { minute: 'same', hour: 'same' } }])('невалидная annotation %j даёт типизированный отказ', value => {
    expect(() => compileAuthorClockJoint(compiled[0].source, value)).toThrowError(expect.objectContaining({ code: 'ANNOTATION_INVALID' }));
    try { compileAuthorClockJoint(compiled[0].source, value); } catch (error) { expect(error).toBeInstanceOf(AuthorClockJointError); }
  });
});
