import { createHash } from 'node:crypto';
import { authorPathEntries, sourcePathEntries, iconGeometry } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { normalizeFigmaSvg } from './figma-import.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';

const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
const NAME = /^[a-z][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const hash = text => createHash('sha256').update(text).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fields = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
function partRecords(parts, count) {
  if (!Array.isArray(parts) || parts.length !== count || count < 2 || count > 16) return false;
  for (let index = 0; index < count; index++) {
    if (!Object.hasOwn(parts, index)) return false;
    const part = parts[index];
    if (!part || typeof part !== 'object' || Object.getPrototypeOf(part) !== Object.prototype || typeof part.id !== 'string') return false;
  }
  return true;
}
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
export class AuthorAnnulusError extends Error {
  constructor(code, message) { super(`author-annulus: ${message}`); this.name = 'AuthorAnnulusError'; this.code = code; }
}
const refuse = (code, message) => { throw new AuthorAnnulusError(code, message); };

const { fraction, add, sub, mul, div, cmp, square, min, max, receipt, rational, directedNumber, directedRoot } =
  createAuthorExactArithmetic(kind => refuse('VARIATION_UNREPRESENTABLE', {
    'zero-denominator': 'Деление на ноль в сертификате.',
    'nonfinite-operand': 'Нужен конечный binary64 operand.',
    'number-bound': 'Не представима конечная граница.',
    'root-bound': 'Не представима граница радиуса.',
  }[kind]));
const radiusSquared = (point, center) => point.map((value, axis) => square(sub(rational(value), rational(center[axis])))).reduce(add);

function cardinalStructure(points) {
  if (points.some(point => point.some(value => !Number.isFinite(value))) ||
      points[0].some((value, axis) => value !== points[12][axis])) refuse('TOPOLOGY_UNSUPPORTED', 'Замыкание обязано не добавлять ребро.');
  const vertices = [points[0], points[3], points[6], points[9]], center = [vertices[0][0], vertices[1][1]];
  const direction = Math.sign(vertices[1][0] - center[0]);
  if (!direction || vertices[2][0] !== center[0] || vertices[3][1] !== center[1] ||
      !(vertices[0][1] < center[1] && vertices[2][1] > center[1] && direction * (vertices[3][0] - center[0]) < 0)) {
    refuse('CORRESPONDENCE_UNSUPPORTED', 'Нужны North/горизонтальный/South/противоположный cardinal nodes.');
  }
  for (let quarter = 0; quarter < 4; quarter++) {
    const sequence = points.slice(quarter * 3, quarter * 3 + 4);
    for (const axis of [0, 1]) {
      const sign = Math.sign(sequence[3][axis] - sequence[0][axis]);
      if (!sign || sequence.slice(1).some((point, i) => sign * (point[axis] - sequence[i][axis]) < 0)) {
        refuse('CORRESPONDENCE_UNSUPPORTED', 'Все четыре четверти требуют монотонных controls.');
      }
    }
  }
  return { center, direction, radius: center[1] - vertices[0][1] };
}
function cardinalContour(d) {
  if (d.length > 4096 || d.replace(NUMBER, '').replace(/[,\t\n\r ]/g, '') !== 'MCCCCZ') {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужен буквальный ограниченный контур MCCCCZ.');
  }
  let segments;
  try { segments = parsePathData(d); } catch { refuse('TOPOLOGY_UNSUPPORTED', 'Невалидные cubic operands.'); }
  if (segments.map(segment => segment.cmd).join('') !== 'MCCCCZ') refuse('TOPOLOGY_UNSUPPORTED', 'Неявные команды запрещены.');
  const points = segments.slice(0, -1).flatMap(segment => segment.cmd === 'M' ? [[segment.x, segment.y]]
    : [[segment.x1, segment.y1], [segment.x2, segment.y2], [segment.x, segment.y]]);
  const structure = cardinalStructure(points), { center } = structure;
  const coefficients = [], choose3 = [1, 3, 3, 1], choose6 = [1, 6, 15, 20, 15, 6, 1];
  for (let quarter = 0; quarter < 4; quarter++) {
    const local = points.slice(quarter * 3, quarter * 3 + 4).map(point => point.map((value, axis) => sub(rational(value), rational(center[axis]))));
    for (let k = 0; k <= 6; k++) {
      let coefficient = [0n, 1n];
      for (let i = 0; i <= 3; i++) {
        const j = k - i;
        if (j < 0 || j > 3) continue;
        const dot = add(mul(local[i][0], local[j][0]), mul(local[i][1], local[j][1]));
        coefficient = add(coefficient, mul(fraction(BigInt(choose3[i] * choose3[j]), BigInt(choose6[k])), dot));
      }
      coefficients.push(coefficient);
    }
  }
  const lowerSquared = min(coefficients), upperSquared = max(coefficients);
  if (lowerSquared[0] <= 0n) refuse('TOPOLOGY_UNSUPPORTED', 'Радиальный сертификат не отделён от центра.');
  return { ...structure, points, lowerSquared, upperSquared };
}
function contentRadius(entries, center) {
  const points = [];
  for (const entry of entries) {
    let segments;
    try { segments = parsePathData(entry.d); } catch { refuse('TOPOLOGY_UNSUPPORTED', 'Невалидный content path.'); }
    if (!segments.length || segments.at(-1).cmd !== 'Z') refuse('TOPOLOGY_UNSUPPORTED', 'Content требует закрытого контура.');
    for (const segment of segments) {
      if (!['M', 'L', 'C', 'Q', 'Z'].includes(segment.cmd)) refuse('TOPOLOGY_UNSUPPORTED', 'Content control-hull не поддерживает дуги.');
      if (segment.cmd !== 'Z') points.push([segment.x, segment.y]);
      if (segment.cmd === 'C' || segment.cmd === 'Q') points.push([segment.x1, segment.y1]);
      if (segment.cmd === 'C') points.push([segment.x2, segment.y2]);
    }
  }
  if (!points.length || points.some(point => point.some(value => !Number.isFinite(value)))) refuse('TOPOLOGY_UNSUPPORTED', 'Нужен конечный content hull.');
  return max(points.map(point => radiusSquared(point, center)));
}

/** Build-only admission: смысл частей объявлен владельцем master, не угадан по силуэту. */
export function compileAuthorAnnulus(source, parts, declaration, grid) {
  if (!fields(declaration, ['law', 'parameter', 'variant', 'enclosurePartId', 'source']) ||
      declaration.law !== 'annulus.counter-scale' || declaration.parameter !== 'enclosureEmphasis') {
    refuse('LAW_UNSUPPORTED', 'Нужен объявленный annulus.counter-scale/enclosureEmphasis.');
  }
  if (declaration.variant !== 'outline') refuse('AUTHOR_VARIATION_UNSUPPORTED', 'Filled не выводится из Outline-кольца.');
  const author = source?.author, expected = declaration.source;
  if (!fields(expected, ['fileKey', 'version', 'masterSha256', 'pathFingerprintSha256']) ||
      !author || author.kind !== 'figma' || Object.keys(expected).some(key => expected[key] !== author[key]) ||
      !HASH.test(expected.masterSha256) || !HASH.test(expected.pathFingerprintSha256) ||
      typeof expected.fileKey !== 'string' || !expected.fileKey || typeof expected.version !== 'string' || !expected.version ||
      typeof source.rawSvg !== 'string' || source.rawSvg.length > 65536 || hash(source.rawSvg) !== author.masterSha256) {
    refuse('SOURCE_MISMATCH', 'Нужны exact Figma file/version/master/path receipts.');
  }
  let entries;
  try {
    entries = sourcePathEntries(source.artifactSvg);
    const normalized = normalizeFigmaSvg(source.rawSvg);
    if (source.artifactSvg !== normalized.replace(/^<svg\b/, '<svg fill="currentColor"')) refuse('SOURCE_MISMATCH', 'Artifact изменил lowering raw master.');
  } catch (error) {
    if (error instanceof AuthorAnnulusError) throw error;
    refuse('SOURCE_UNSUPPORTED', 'Source paint/язык не поддержан владельцем SVG.');
  }
  if (hash(stableJSON(authorPathEntries(source.artifactSvg))) !== author.pathFingerprintSha256) refuse('SOURCE_MISMATCH', 'Path receipt не совпал.');
  const rawPaths = [...source.rawSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)].map(match => match[1]);
  if (rawPaths.length !== entries.length || rawPaths.some((d, index) => d !== entries[index].d)) refuse('SOURCE_MISMATCH', 'Raw path operands обязаны оставаться буквальными.');
  if (!partRecords(parts, entries.length) || typeof declaration.enclosurePartId !== 'string' ||
      !NAME.test(declaration.enclosurePartId) || new Set(parts.map(part => part.id)).size !== parts.length ||
      parts.some((part, index) => !NAME.test(part.id) || part.identity !== 'declared' || part.zIndex !== index ||
        part.fillRule !== entries[index].fillRule || part.role !== (index === parts.length - 1 ? 'container' : 'content')) ||
      parts.at(-1).id !== declaration.enclosurePartId) refuse('DECLARED_PARTS_REQUIRED', 'Нужны declared content и последняя container часть.');
  const enclosureIndex = entries.length - 1, enclosure = entries[enclosureIndex];
  if (enclosure.fillRule !== 'evenodd' || enclosure.d.replace(NUMBER, '').replace(/[,\t\n\r ]/g, '') !== 'MCCCCZMCCCCZ') {
    refuse('TOPOLOGY_UNSUPPORTED', 'Обрамление требует два evenodd MCCCCZ контура.');
  }
  const split = enclosure.d.indexOf('Z') + 1, outerD = enclosure.d.slice(0, split), innerD = enclosure.d.slice(split);
  const outer = cardinalContour(outerD), inner = cardinalContour(innerD), center = outer.center;
  if (inner.center.some((value, axis) => value !== center[axis]) || inner.direction === outer.direction ||
      !(outer.radius > inner.radius && inner.radius > 0)) refuse('CORRESPONDENCE_UNSUPPORTED', 'Нужны общий центр, вложенные cardinal radii и противоположный winding.');
  const box = iconGeometry(source.artifactSvg).viewBox, viewBox = [box.x, box.y, box.width, box.height];
  if (!grid || !Number.isFinite(grid.ratios?.clearanceMin) || grid.ratios.clearanceMin <= 0 ||
      !Number.isFinite(grid.ratios?.margin) || grid.ratios.margin < 0 || grid.ratios.margin >= 0.5 ||
      !Number.isFinite(grid.version) || viewBox.some(value => !Number.isFinite(value))) refuse('POLICY_INVALID', 'Нужен clearance владельца grid.');
  if (center[0] !== box.x + box.width / 2 || center[1] !== box.y + box.height / 2) {
    refuse('CORRESPONDENCE_UNSUPPORTED', 'Обрамление требует общий anchor в центре canvas.');
  }
  const margin = [box.width, box.height].map(side => mul(rational(side), rational(grid.ratios.margin)));
  if (outer.points.some(point => point.some((value, axis) => {
    const origin = rational(axis === 0 ? box.x : box.y), size = rational(axis === 0 ? box.width : box.height);
    return cmp(rational(value), add(origin, margin[axis])) < 0 || cmp(rational(value), sub(add(origin, size), margin[axis])) > 0;
  }))) refuse('DEFAULT_OUTSIDE_DOMAIN', 'Неизменяемый outer hull нарушает canvas margin.');
  const contentUpperSquared = contentRadius(entries.slice(0, -1), center);
  const outerLower = rational(directedRoot(outer.lowerSquared, -1));
  const innerLower = rational(directedRoot(inner.lowerSquared, -1));
  const innerUpper = rational(directedRoot(inner.upperSquared, 1));
  const contentUpper = rational(directedRoot(contentUpperSquared, 1));
  const gap = mul(rational(Math.min(box.width, box.height)), rational(grid.ratios.clearanceMin));
  const u = rational(Number.EPSILON / 2), one = [1n, 1n];
  const D = max(inner.points.flatMap(point => point.map((value, axis) => {
    const delta = sub(rational(value), rational(center[axis])); return delta[0] < 0n ? [-delta[0], delta[1]] : delta;
  })));
  const A = max(center.map(value => rational(Math.abs(value))));
  const S = div(outerLower, innerUpper), displacement = add(D, mul(u, D));
  const coordinateError = add(add(mul(u, mul(S, D)), mul(u, mul(S, displacement))),
    mul(u, add(A, mul(S, mul(displacement, add(one, u))))));
  const error = mul(rational(directedRoot([2n, 1n], 1)), coordinateError);
  const minimumScale = div(add(add(contentUpper, gap), error), innerLower);
  const maximumScale = div(sub(outerLower, error), innerUpper);
  if (cmp(minimumScale, one) > 0 || cmp(one, maximumScale) >= 0) refuse('DEFAULT_OUTSIDE_DOMAIN', 'Авторский default не удовлетворяет radial clearance.');
  const R = rational(outer.radius), r = rational(inner.radius), thickness = rational(outer.radius - inner.radius);
  const minimum = directedNumber(minimumScale, 1), maximum = directedNumber(maximumScale, -1);
  const domain = { kind: 'radial-bernstein', parameter: 'enclosureEmphasis', evaluated: 'actual-binary64-scale',
    scale: { minimum, minimumInclusive: true, maximum, maximumInclusive: false },
    emphasisBounds: { minimum: directedNumber(div(sub(R, mul(r, rational(maximum))), thickness), 1),
      maximum: directedNumber(div(sub(R, mul(r, rational(minimum))), thickness), -1),
      meaning: 'Границы exact scale; фактическое вычисление scale дополнительно проверяется.' },
    policy: { gridVersion: grid.version, gridSha256: hash(stableJSON(grid)), minimumGapRatio: grid.ratios.clearanceMin,
      minimumMarginRatio: grid.ratios.margin },
    proof: { outerLowerSquared: receipt(outer.lowerSquared), outerUpperSquared: receipt(outer.upperSquared),
      innerLowerSquared: receipt(inner.lowerSquared), innerUpperSquared: receipt(inner.upperSquared), contentUpperSquared: receipt(contentUpperSquared),
      minimumScale: receipt(minimumScale), maximumScale: receipt(maximumScale), minimumGap: receipt(gap),
      outerLower: receipt(outerLower), innerLower: receipt(innerLower), innerUpper: receipt(innerUpper), contentUpper: receipt(contentUpper),
      coordinateErrorUpper: receipt(coordinateError), euclideanErrorUpper: receipt(error),
      topology: 'opposite-winding-monotone-cardinal-quarters', radial: 'degree-6-bernstein', content: 'control-hull' } };
  const defaults = { rawSvg: source.rawSvg, artifactSvg: source.artifactSvg,
    parts: parts.map((part, index) => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: entries[index].d })),
    provenance: { kind: 'source', author: { ...author } } };
  const compiled = { version: 1, law: declaration.law, parameter: declaration.parameter, variant: declaration.variant,
    source: { ...author }, viewBox, domain, defaults,
    enclosure: { id: declaration.enclosurePartId, index: enclosureIndex, center, outerD, innerD, innerPoints: inner.points,
      outerRadius: outer.radius, referenceInnerRadius: inner.radius, referenceThickness: outer.radius - inner.radius } };
  return freeze({ ...compiled, geometrySha256: hash(stableJSON(compiled)) });
}

/** Build-only probe: никаких parser, fitting и повторного вывода semantics на запросе. */
export function materializeAuthorAnnulus(compiled, variation = {}) {
  if (!variation || Object.getPrototypeOf(variation) !== Object.prototype ||
      Object.keys(variation).some(key => key !== 'enclosureEmphasis') ||
      variation.enclosureEmphasis !== undefined && (typeof variation.enclosureEmphasis !== 'number' ||
        !Number.isFinite(variation.enclosureEmphasis) || variation.enclosureEmphasis <= 0)) {
    refuse('INVALID_VARIATION', 'Нужен положительный конечный enclosureEmphasis.');
  }
  const emphasis = variation.enclosureEmphasis ?? 1;
  if (emphasis === 1) return compiled.defaults;
  const enclosure = compiled.enclosure, scale = (enclosure.outerRadius - emphasis * enclosure.referenceThickness) / enclosure.referenceInnerRadius;
  if (!Number.isFinite(scale) || scale <= 0) refuse('VARIATION_UNREPRESENTABLE', 'Counter-контур схлопнулся.');
  if (scale < compiled.domain.scale.minimum || scale >= compiled.domain.scale.maximum) refuse('VARIATION_OUTSIDE_DOMAIN', 'Counter выходит за доказанный radial domain.');
  const points = enclosure.innerPoints.map(point => point.map((value, axis) => enclosure.center[axis] + scale * (value - enclosure.center[axis])));
  if (points.some(point => point.some(value => !Number.isFinite(value)))) refuse('VARIATION_UNREPRESENTABLE', 'Не конечная materialization.');
  // Положительная монотонная binary64 формула сохраняет порядок controls;
  // отдельный admission ниже обнаруживает исчезнувшие cardinal quarters.
  try { cardinalStructure(points); } catch { refuse('VARIATION_UNREPRESENTABLE', 'Materialization разрушила cardinal topology.'); }
  let operand = 0;
  const operands = points.flat(), innerD = enclosure.innerD.replace(NUMBER, () => String(operands[operand++]));
  const d = enclosure.outerD + innerD, previous = compiled.defaults.parts[enclosure.index].d;
  const replace = svg => svg.replace(`d="${previous}"`, `d="${d}"`);
  return freeze({ rawSvg: replace(compiled.defaults.rawSvg), artifactSvg: replace(compiled.defaults.artifactSvg),
    parts: compiled.defaults.parts.map((part, index) => index === enclosure.index ? { ...part, d } : part),
    provenance: { kind: 'authored-variation', author: compiled.source,
      variation: { law: compiled.law, geometrySha256: compiled.geometrySha256, parameters: { enclosureEmphasis: emphasis }, scale } } });
}
