import { createHash } from 'node:crypto';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { jsonDataLiteral } from './generated-module.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const TOPOLOGY = ['M', 'C', 'C', 'C', 'C', 'Z'];
const DOTS = ['dot-leading', 'dot-middle', 'dot-trailing'];
const NAME = /^[a-z][a-z0-9-]*$/;
const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;
export class AuthorContourStateError extends Error {
  constructor(code, message) { super(`author-contour-states: ${message}`); this.name = 'AuthorContourStateError'; this.code = code; }
}
const refuse = (code, message) => { throw new AuthorContourStateError(code, message); };
const fields = (value, expected) => value && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const { add, sub, mul, div, cmp, square, max, rational, upperRoot, receipt: quotient } =
  createAuthorExactArithmetic(kind => {
    if (kind === 'zero-denominator') throw new RangeError('Division by zero');
    refuse('SOURCE_UNSUPPORTED', kind === 'nonfinite-operand' ? 'Не конечный operand.' : 'Невозможно ограничить радиус контрольных точек.');
  });

function contour(part, entry) {
  // Общий parser нормализует relative и неявные команды; packet хранит точную строку.
  if (entry.d.length > 4096 || entry.d.replace(NUMBER, '').replace(/[,\t\n\r ]/g, '') !== TOPOLOGY.join('')) {
    refuse('CORRESPONDENCE_UNAVAILABLE', 'Нужны буквальные MCCCCZ в ограниченной точной строке контура.');
  }
  const segments = parsePathData(entry.d);
  if (segments.map(item => item.cmd).join('') !== TOPOLOGY.join('') || part.fillRule !== 'nonzero' ||
      part.paint.kind !== 'fill' || part.provenance.kind !== 'source' || part.provenance.identity !== 'declared') {
    refuse('CORRESPONDENCE_UNAVAILABLE', 'Нужны объявленные заполненные части MCCCCZ без отверстий.');
  }
  const points = segments.slice(0, -1).flatMap(item => item.cmd === 'M' ? [[item.x, item.y]]
    : [[item.x1, item.y1], [item.x2, item.y2], [item.x, item.y]]);
  if (points.some(point => point.some(value => !Number.isFinite(value))) ||
      points[0].some((value, axis) => value !== points[12][axis])) {
    refuse('CORRESPONDENCE_UNAVAILABLE', 'Нужен конечный замкнутый кубический контур.');
  }
  const vertices = [points[0], points[3], points[6], points[9]];
  const center = [vertices[0][0], vertices[1][1]];
  if (vertices[2][0] !== center[0] || vertices[3][1] !== center[1] ||
      !(vertices[0][1] > center[1] && vertices[1][0] > center[0] && vertices[2][1] < center[1] && vertices[3][0] < center[0])) {
    refuse('CORRESPONDENCE_UNAVAILABLE', 'Крайние узлы должны идти в порядке South/East/North/West.');
  }
  // Покоординатно монотонные четверти имеют непересекающиеся внутренности квадрантов.
  // Выпуклая интерполяция сохраняет эти неравенства для всего p∈[0,1].
  for (const [quarter, signs] of [[0, [1, -1]], [1, [-1, -1]], [2, [-1, 1]], [3, [1, 1]]]) {
    const sequence = points.slice(quarter * 3, quarter * 3 + 4);
    for (const axis of [0, 1]) {
      if (sequence.slice(1).some((point, index) => signs[axis] * (point[axis] - sequence[index][axis]) < 0)) {
        refuse('CORRESPONDENCE_UNAVAILABLE', 'C-операнды не подтверждают одинаковые монотонные четверти.');
      }
    }
  }
  const radiusSquared = max(points.map(point => add(square(sub(rational(point[0]), rational(center[0]))),
    square(sub(rational(point[1]), rational(center[1]))))));
  return { id: part.id, points, center, radiusUpper: upperRoot(radiusSquared), d: entry.d };
}

/** Соответствие dots.orient компилируется из закреплённых авторских частей. */
export function compileAuthorContourStateGroup(baseline, name, group, { compiler, grid, document }) {
  if (!NAME.test(name) || !fields(group, ['law', 'defaultState', 'partIds', 'states']) || group.law !== 'dots.orient' ||
      !['horizontal', 'vertical'].includes(group.defaultState) || JSON.stringify(group.partIds) !== JSON.stringify(DOTS) ||
      !fields(group.states, ['horizontal', 'vertical'])) refuse('SPEC_INVALID', 'Нужны dots.orient и явно упорядоченные части точек.');
  if (!grid || !Number.isFinite(grid.ratios?.margin) || !Number.isFinite(grid.ratios?.clearanceMin) ||
      grid.ratios.margin < 0 || grid.ratios.margin >= 0.5 || grid.ratios.clearanceMin <= 0) {
    refuse('POLICY_INVALID', 'Нужен актуальный margin/clearance владельца сетки.');
  }
  const members = {}, contours = {}, states = [];
  let variant;
  for (const state of ['horizontal', 'vertical']) {
    const member = group.states[state];
    if (!fields(member, ['icon', 'variant', 'masterSha256', 'pathFingerprintSha256']) ||
        member.icon !== `ellipsis-${state}` || !['outline', 'filled'].includes(member.variant) ||
        variant !== undefined && variant !== member.variant) refuse('SPEC_INVALID', 'Нельзя смешивать независимые начертания.');
    variant = member.variant;
    const source = baseline.icons?.[member.icon]?.[variant];
    const glyph = source && compiler.glyph({ icon: member.icon, variant, modelMode: 'source-only' });
    const entries = source && authorPathEntries(source.artifactSvg);
    if (!source || createHash('sha256').update(source.rawSvg).digest('hex') !== member.masterSha256 ||
        createHash('sha256').update(stableJSON(entries)).digest('hex') !== member.pathFingerprintSha256 ||
        source.author.masterSha256 !== member.masterSha256 || source.author.pathFingerprintSha256 !== member.pathFingerprintSha256 ||
        source.author.fileKey !== baseline.source.fileKey || source.author.version !== baseline.source.version ||
        glyph.provenance.kind !== 'source' || !glyph.provenance.anatomy || glyph.composition.kind !== 'layers' ||
        JSON.stringify(glyph.viewBox) !== '[0,0,24,24]' || glyph.parts.length !== 3 || entries.length !== 3 ||
        glyph.parts.some((part, index) => part.id !== DOTS[index] || part.role !== 'content' || part.zIndex !== index ||
          part.d !== entries[index].d || part.fillRule !== entries[index].fillRule)) {
      refuse('MASTER_MISMATCH', 'Авторские части, закреплённые хэши и заливка не совпадают.');
    }
    const rawPaths = [...source.rawSvg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => {
      const value = /(?:^|\s)d\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
      return value?.[1] ?? value?.[2];
    });
    if (rawPaths.length !== entries.length || rawPaths.some((d, index) => d !== entries[index].d)) {
      refuse('CORRESPONDENCE_UNAVAILABLE', 'Точные raw endpoints не должны нормализоваться перед передачей.');
    }
    members[state] = glyph;
    contours[state] = glyph.parts.map((part, index) => contour(part, entries[index]));
    states.push({ id: state, icon: member.icon, author: source.author });
  }
  const all = [...contours.horizontal, ...contours.vertical];
  const maxCoordinate = max(all.flatMap(part => part.points.flatMap(point => point.map(value => rational(Math.abs(value))))));
  // Для (1-p)*a+p*b: вычитание, два умножения и сумма ≤8u*max|operand|.
  const rounding = mul(maxCoordinate, mul(rational(Number.EPSILON), [4n, 1n]));
  // Диск ограничивает евклидову ошибку: две координаты дают √2·rounding.
  const roundingNorm = mul(rounding, rational(upperRoot([2n, 1n])));
  const margin = mul(rational(24), rational(grid.ratios.margin));
  const clearance = mul(rational(24), rational(grid.ratios.clearanceMin));
  for (const part of all) {
    const [south, east, north, west] = [part.points[0], part.points[3], part.points[6], part.points[9]];
    const [cx, cy] = part.center;
    const spans = [sub(rational(east[0]), rational(cx)), sub(rational(cx), rational(west[0])),
      sub(rational(south[1]), rational(cy)), sub(rational(cy), rational(north[1]))];
    if (spans.some(span => cmp(span, mul(rounding, [2n, 1n])) <= 0)) {
      refuse('INTERVAL_UNSAFE', 'Каждый радиус от центра до крайнего узла должен превышать двойную ошибку интерполяции.');
    }
  }
  for (const part of all) for (const point of part.points) for (const value of point) {
    if (cmp(rational(value), add(margin, rounding)) < 0 || cmp(rational(value), sub(rational(24), add(margin, rounding))) > 0) {
      refuse('INTERVAL_UNSAFE', 'Оболочка контрольных точек не подтверждает поля на всём интервале.');
    }
  }
  const separation = [];
  for (const [index, next] of [[0, 1], [1, 2], [0, 2]]) {
    const h = contours.horizontal, v = contours.vertical;
    if (h[index].center[1] !== h[next].center[1] || v[index].center[0] !== v[next].center[0]) {
      refuse('CORRESPONDENCE_UNAVAILABLE', 'Нужны горизонтальная и вертикальная оси центров точек.');
    }
    const dx = sub(rational(h[next].center[0]), rational(h[index].center[0]));
    const dy = sub(rational(v[next].center[1]), rational(v[index].center[1]));
    if (dx[0] <= 0 || dy[0] <= 0) refuse('CORRESPONDENCE_UNAVAILABLE', 'Порядок центров точек нарушен.');
    // min_p (dx²(1-p)² + dy²p²) = dx²dy²/(dx²+dy²), точная дробь.
    const distanceSquared = div(mul(square(dx), square(dy)), add(square(dx), square(dy)));
    const radii = add(max([rational(h[index].radiusUpper), rational(v[index].radiusUpper)]),
      max([rational(h[next].radiusUpper), rational(v[next].radiusUpper)]));
    const required = add(add(radii, clearance), mul(roundingNorm, [2n, 1n]));
    if (cmp(distanceSquared, square(required)) < 0) refuse('INTERVAL_UNSAFE', 'Диски контрольных точек нарушают минимальный зазор.');
    separation.push({ pair: [DOTS[index], DOTS[next]], minimumCenterDistanceSquared: quotient(distanceSquared),
      requiredDistanceSquared: quotient(square(required)) });
  }
  const targets = DOTS.map((partId, index) => ({ partId, property: 'd', commands: TOPOLOGY,
    vectors: [contours.horizontal[index].points.flat(), contours.vertical[index].points.flat()],
    endpoints: [contours.horizontal[index].d, contours.vertical[index].d] }));
  const proof = { law: 'dots.orient', source: { ...document.source },
    specSha256: createHash('sha256').update(stableJSON({ schemaVersion: document.schemaVersion, source: document.source, name, group })).digest('hex'),
    geometrySha256: hash(targets),
    topology: 'ordered-monotone-cardinal-quarters', interval: 'control-hull-disks',
    gridVersion: grid.version, gridSha256: hash(grid), roundingUpper: quotient(rounding), roundingNormUpper: quotient(roundingNorm), separation };
  return { schemaVersion: 3, kind: 'contour-interpolation', group: name, variant, defaultState: group.defaultState,
    states, staticSvg: { horizontal: members.horizontal.svg, vertical: members.vertical.svg }, targets, proof };
}

export function renderContourStateGroupModule(payload) {
  if (!NAME.test(payload?.group) || payload.kind !== 'contour-interpolation') refuse('SPEC_INVALID', 'Нужна группа интерполяции контура.');
  const stateNames = payload.states.map(state => state.id);
  const renderer = { variant: payload.variant, defaultState: payload.defaultState, states: stateNames, staticSvg: payload.staticSvg };
  const effects = { variant: payload.variant, group: payload.group, defaultState: payload.defaultState, states: stateNames,
    targets: payload.targets, geometrySha256: payload.proof.geometrySha256 };
  const capabilities = { group: payload.group, variant: payload.variant, defaultState: payload.defaultState,
    transition: 'contour-interpolation', morph: 'topology-proven', partIds: payload.targets.map(target => target.partId),
    states: payload.states, formats: { static: ['svg'], transition: ['web-effect'] }, variation: 'exact-default-only', proof: payload.proof };
  return [
    '/** GENERATED: доказанное соответствие независимых авторских контуров. */',
    "import { createCompiledContourStateRenderer, createCompiledContourStateEffects, createCompiledContourStateCapabilities } from '../ir/contour-runtime.js';",
    `const renderer = /* @__PURE__ */ createCompiledContourStateRenderer(${jsonDataLiteral(renderer)});`,
    `const effects = /* @__PURE__ */ createCompiledContourStateEffects(${jsonDataLiteral(effects)});`,
    `const capabilities = /* @__PURE__ */ createCompiledContourStateCapabilities(${jsonDataLiteral(capabilities)});`,
    'export function render(state, options) { return renderer(state, options); }',
    'export function renderStateSvg(state, options) { return renderer(state, options); }',
    'export function compileStateEffect(state, request) { return effects.compileStateEffect(state, request); }',
    'export function exportStateTransition(state, request) { return effects.exportStateTransition(state, request); }',
    'export function stateCapabilities() { return capabilities(); }', '',
  ].join('\n');
}
export function contourStateGroupDeclaration(document, name) {
  return [
    "import type { ContourStateRenderRequest, ContourStateEffectRequest, ContourStateExportRequest, StateSvgResult, ContourStateEffectResult, ContourStateCapabilities } from '../ir/contour-state-types.js';",
    `export type State = ${Object.keys(document.groups[name].states).sort().map(state => JSON.stringify(state)).join(' | ')};`,
    'export declare function render(state?: State, options?: ContourStateRenderRequest): StateSvgResult;',
    'export declare function renderStateSvg(state?: State, options?: ContourStateRenderRequest): StateSvgResult;',
    'export declare function compileStateEffect(state: State, request: ContourStateEffectRequest): ContourStateEffectResult;',
    'export declare function exportStateTransition(state: State, request: ContourStateExportRequest): ContourStateEffectResult;',
    'export declare function stateCapabilities(): ContourStateCapabilities<State>;', '',
  ].join('\n');
}
