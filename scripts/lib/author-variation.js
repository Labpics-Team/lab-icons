import { createHash } from 'node:crypto';
import { authorPathEntries, iconGeometry } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export class AuthorVariationError extends Error {
  constructor(code, message) {
    super(`author-variation: ${message}`);
    this.name = 'AuthorVariationError';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new AuthorVariationError(code, message); };

/** Имена opt-in outputs выводятся из того же author spec, что компилирует закон. */
export function authorVariationIconNames(spec) {
  if (!spec?.icons || typeof spec.icons !== 'object' || Array.isArray(spec.icons)) refuse('LAW_UNSUPPORTED', 'Нужен author anatomy spec.');
  return Object.entries(spec.icons).filter(([icon, variants]) => {
    const present = ['outline', 'filled'].map(variant => !!variants?.[variant]?.variation);
    const dots = Object.values(variants ?? {}).some(declaration => declaration?.variation?.law === 'dots.affine');
    if (dots && present[0] !== present[1]) refuse('LAW_UNSUPPORTED', `${icon}: текущий dots.affine требует обеих независимых авторских форм.`);
    return present.some(Boolean);
  }).map(([icon]) => icon).sort();
}

/** Release выбирает только laws, действительно объявленные тем же author spec. */
export function authorVariationLawNames(spec) {
  return [...new Set(authorVariationIconNames(spec).flatMap(icon => ['outline', 'filled']
    .flatMap(variant => spec.icons[icon][variant]?.variation ? [spec.icons[icon][variant].variation.law] : [])))].sort();
}

/** Capability — проекция принятого law packet, а не вторая декларация формы. */
export function authorVariationCapability(compiled) {
  let defaults, webEffect;
  if (compiled?.law === 'dots.affine') {
    defaults = { dotScale: 1, spacingScale: 1 }; webEffect = 'existing-part-gestures';
  } else if (compiled?.law === 'annulus.counter-scale') {
    defaults = { enclosureEmphasis: 1 }; webEffect = 'existing-part-gestures';
  } else refuse('LAW_UNSUPPORTED', 'Для этого compiled law нет публичной capability.');
  return { version: 1, law: compiled.law, geometrySha256: compiled.geometrySha256, defaults, domain: compiled.domain,
    targets: { svg: 'supported', webEffect, lottie: 'not-exported', sfSymbols: 'not-exported' } };
}

/** Части и их смысл принадлежат закреплённому master, не path-вводу потребителя. */
export function compileAuthorVariation(source, parts, declaration, grid) {
  if (!declaration || Object.keys(declaration).sort().join(',') !== 'axis,law' ||
      declaration.law !== 'dots.affine' || !['x', 'y'].includes(declaration.axis)) {
    refuse('LAW_UNSUPPORTED', 'Нужны объявленные dots.affine и продольная ось.');
  }
  const entries = authorPathEntries(source.artifactSvg);
  if (typeof source.rawSvg !== 'string' ||
      createHash('sha256').update(source.rawSvg).digest('hex') !== source.author.masterSha256 ||
      createHash('sha256').update(stableJSON(entries)).digest('hex') !== source.author.pathFingerprintSha256) {
    refuse('SOURCE_MISMATCH', 'Геометрия не совпадает с точным master и path receipt.');
  }
  if (parts.length !== 3 || entries.length !== 3 ||
      parts.some((part, index) => part.identity !== 'declared' || part.role !== 'content' ||
        part.zIndex !== index || part.fillRule !== 'nonzero' || entries[index].fillRule !== 'nonzero') ||
      new Set(parts.map(part => part.id)).size !== 3) {
    refuse('POSITIVE_PARTS_REQUIRED', 'Нужны ровно три независимые положительные авторские dot части.');
  }
  const axis = declaration.axis === 'x' ? 0 : 1, cross = 1 - axis;
  let winding;
  const geometry = entries.map((entry, index) => {
    const segments = parsePathData(entry.d);
    if (segments.map(segment => segment.cmd).join('') !== 'MCCCCZ') {
      refuse('TOPOLOGY_UNSUPPORTED', 'Одна dot часть требует один закрытый четырёхкубический контур.');
    }
    const start = segments[0], end = segments[4];
    if (start.x !== end.x || start.y !== end.y) refuse('TOPOLOGY_UNSUPPORTED', 'Авторский cubic обязан замкнуться без нового ребра.');
    const points = segments.slice(0, -1).flatMap(segment => segment.cmd === 'M'
      ? [[segment.x, segment.y]] : [[segment.x1, segment.y1], [segment.x2, segment.y2], [segment.x, segment.y]]);
    if (points.some(point => point.some(value => !Number.isFinite(value)))) refuse('TOPOLOGY_UNSUPPORTED', 'Нужны конечные controls.');
    const low = [0, 1].map(a => Math.min(...points.map(point => point[a])));
    const high = [0, 1].map(a => Math.max(...points.map(point => point[a])));
    const pivot = low.map((value, a) => (value + high[a]) / 2);
    const vertices = segments.slice(0, -1).map(segment => [segment.x, segment.y]);
    const area = vertices.reduce((total, point, i) => {
      const next = vertices[(i + 1) % vertices.length];
      return total + point[0] * next[1] - next[0] * point[1];
    }, 0);
    const sign = Math.sign(area);
    if (!sign || winding !== undefined && sign !== winding || low.some((value, a) => value >= high[a])) {
      refuse('TOPOLOGY_UNSUPPORTED', 'Контуры требуют ненулевые размеры и согласованный winding.');
    }
    winding = sign;
    return { id: parts[index].id, points, pivot, low, high };
  });
  if (geometry.some(part => part.pivot[cross] !== geometry[1].pivot[cross]) ||
      geometry.some((part, i) => i && part.pivot[axis] <= geometry[i - 1].pivot[axis])) {
    refuse('CORRESPONDENCE_UNSUPPORTED', 'Объявленные dots должны идти по одной оси в авторском порядке.');
  }
  const canvas = iconGeometry(source.artifactSvg).viewBox;
  const viewBox = [canvas.x, canvas.y, canvas.width, canvas.height];
  const [x, y, width, height] = viewBox, origin = [x, y], size = [width, height];
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || width <= 0 || height <= 0 ||
      !Number.isFinite(grid.ratios.margin) || !Number.isFinite(grid.ratios.clearanceMin) ||
      grid.ratios.margin < 0 || grid.ratios.margin >= 0.5 || grid.ratios.clearanceMin <= 0) {
    refuse('POLICY_INVALID', 'Нужны конечные canvas, margin и clearanceMin владельца сетки.');
  }
  const margin = size.map(side => side * grid.ratios.margin);
  const gap = Math.min(...size) * grid.ratios.clearanceMin;
  const middle = geometry[1].pivot[axis];
  const constraints = [];
  for (const [i, part] of geometry.entries()) {
    const q = part.pivot[axis] - middle;
    part.offset = q;
    for (const a of [0, 1]) {
      constraints.push({ kind: 'margin', dotScale: part.low[a] - part.pivot[a], spacingScale: a === axis ? q : 0,
        minimum: origin[a] + margin[a] - (a === axis ? middle : part.pivot[a]) });
      constraints.push({ kind: 'margin', dotScale: part.pivot[a] - part.high[a], spacingScale: a === axis ? -q : 0,
        minimum: (a === axis ? middle : part.pivot[a]) - origin[a] - size[a] + margin[a] });
    }
    if (i) {
      const left = geometry[i - 1];
      constraints.push({ kind: 'gap', dotScale: (part.low[axis] - part.pivot[axis]) - (left.high[axis] - left.pivot[axis]),
        spacingScale: part.pivot[axis] - left.pivot[axis], minimum: gap });
    }
  }
  if (constraints.some(constraint => constraint.dotScale + constraint.spacingScale < constraint.minimum)) {
    refuse('DEFAULT_OUTSIDE_DOMAIN', 'Авторский default не удовлетворяет заявленным margin/gap.');
  }
  const policy = { gridVersion: grid.version, gridSha256: sha256(grid), marginRatio: grid.ratios.margin,
    minimumGapRatio: grid.ratios.clearanceMin };
  const domain = { kind: 'convex-linear', bound: 'control-hull', positive: ['dotScale', 'spacingScale'], constraints, policy };
  const compiled = { version: 1, law: declaration.law, axis, viewBox, domain,
    source: { masterSha256: source.author.masterSha256, pathFingerprintSha256: source.author.pathFingerprintSha256 },
    parts: geometry.map(({ id, points, pivot, offset }) => ({ id, points, pivot, offset })) };
  return { ...compiled, geometrySha256: sha256({ masterSha256: source.author.masterSha256,
    pathFingerprintSha256: source.author.pathFingerprintSha256, compiled }) };
}
