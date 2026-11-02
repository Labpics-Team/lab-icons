import { createHash } from 'node:crypto';
import { authorPathEntries, iconGeometry } from '../../src/core/icon-geometry.js';
import { closedSourceContourLiterals } from '../../src/core/source-contours.js';
import { createAuthorCurveCertificate } from './author-curve-certificate.js';
import { projectedContourAreas } from '../../src/core/annulus-content-geometry.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';

const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
export class AuthorCapsuleError extends Error {
  constructor(code, message) { super(`author-capsule: ${message}`); this.name = 'AuthorCapsuleError'; this.code = code; }
}
const refuse = (code, message) => { throw new AuthorCapsuleError(code, message); };
const { fraction, rational, add, sub, mul, div, max, receipt, directedNumber } =
  createAuthorExactArithmetic(() => refuse('VARIATION_UNREPRESENTABLE', 'Не представим конечный сертификат ширины.'));
const zero = rational(0), one = rational(1), u = fraction(1n, 1n << 53n), eta = fraction(1n, 1n << 1075n);
// Общая граница авторского стиля следует из просмотра, а не из clearance.
// Область и контрпример: docs/research/capsule-optical-domain-20261102.md.
const CAPSULE_SOURCE_STYLE = Object.freeze({
  id: 'lab-ui-v2.1-capsule-width', version: 1, minimum: .8,
  source: { fileKey: 'LuaiBd4anRi4DMZayKAnY2', version: '2416636003859748575' },
  evidence: {
    artifactCommit: '10a994686e34e4d1c6b03af0eeb879e6c55bd029',
    sha256: 'e00f9cc60fb56a6ac35e94fafc0b5cdc2f7d1c9fdf9b31ec67a8ca4b77b7b3d5',
    reference: 'docs/research/capsule-optical-domain-20261102.md',
    bodyWidths: [.8, .9, 1], sizes: [16, 24, 48], dpr: 1,
  },
});
// Filled counter имеет другую оптику; положительный master её не удостоверяет.
const NEGATIVE_CAPSULE_SOURCE_STYLE = Object.freeze({
  id: 'lab-ui-v2.1-negative-capsule-width', version: 1, minimum: .8,
  source: CAPSULE_SOURCE_STYLE.source,
  evidence: { reference: 'docs/research/negative-capsule-optical-domain-20261102.md',
    sha256: '709df0aa064be9525a1dfd5a48d0f8145df5924a7963b859cc3f04c510b4aa0e',
    darkSha256: '21c957bc6be1f9e7a8d2eba7155a0a2a9657817eaff5c13c6b18d6c32b71d314',
    bodyWidths: [.8, .9, 1], sizes: [16, 24, 48], dpr: 1 },
});

const { contours, coordinateError, curvePieces, certifySeparation, certifyKnockouts, certifyMaterializedContour } = createAuthorCurveCertificate(refuse);
const bounds = points => [0, 1].map(axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))]);

/** Аннотация выбирает смысл body; координаты и ограничение выводятся из master. */
export function compileAuthorCapsule(source, parts, declaration, grid, composition = { kind: 'layers' }) {
  const negative = composition?.kind === 'compound', style = negative ? NEGATIVE_CAPSULE_SOURCE_STYLE : CAPSULE_SOURCE_STYLE;
  if (!declaration || Object.keys(declaration).sort().join(',') !== 'bodyPartId,law,parameter' ||
      declaration.law !== 'capsule.width' || declaration.parameter !== 'bodyWidth') {
    refuse('LAW_UNSUPPORTED', 'Нужны capsule.width/bodyWidth и объявленный bodyPartId.');
  }
  if (!source || typeof source.rawSvg !== 'string' || !source.author || !Array.isArray(parts)) {
    refuse('SOURCE_MISMATCH', 'Нужен полный authored source record и объявленные части.');
  }
  if (source.author.fileKey !== style.source.fileKey || source.author.version !== style.source.version) {
    refuse('STYLE_SOURCE_MISMATCH', 'Оптический допуск относится к другому авторскому источнику; требуется его пересмотр.');
  }
  let parents, entries;
  try { parents = authorPathEntries(source.artifactSvg); } catch { refuse('SOURCE_MISMATCH', 'Artifact SVG не соответствует supported source контракту.'); }
  if (hash(source.rawSvg) !== source.author.masterSha256 || hash(stableJSON(parents)) !== source.author.pathFingerprintSha256 ||
      !negative && parents.length !== parts.length || parts.some((part, index) => part.identity !== 'declared' || part.zIndex !== index) ||
      new Set(parts.map(part => part.id)).size !== parts.length) {
    refuse('SOURCE_MISMATCH', 'Body anatomy не соответствует полному authored master.');
  }
  if (negative) {
    if (Object.keys(composition).sort().join(',') !== 'fillRule,kind' || composition.fillRule !== 'evenodd' ||
        parents.length !== 1 || parents[0].fillRule !== 'evenodd' || parts[0]?.role !== 'container' ||
        parts.slice(1).some(part => part.role !== 'counter') || parts.some((part, index) => part.fillRule !== null ||
          part.contourIndices?.length !== 1 || part.contourIndices[0] !== index)) {
      refuse('COMPOSITION_UNPROVEN', 'Negative capsule требует полного ordered contour договора одного evenodd parent.');
    }
    let fragments;
    try { fragments = closedSourceContourLiterals(parents[0].d); } catch { refuse('COMPOSITION_UNPROVEN', 'Нужны закрытые absolute-M contours.'); }
    if (fragments.length !== parts.length) refuse('SOURCE_MISMATCH', 'Contour anatomy не покрывает parent source.');
    entries = fragments.map((d, index) => ({ index, d, fillRule: null }));
  } else {
    if (composition?.kind !== 'layers') refuse('COMPOSITION_UNPROVEN', 'Capsule не поддерживает эту composition.');
    entries = parents;
  }
  const index = parts.findIndex(part => part.id === declaration.bodyPartId), body = parts[index];
  if (!body || body.role !== (negative ? 'counter' : 'content') || entries.length < 2 || entries.length > 16 || negative && index === 0) {
    refuse('PARTS_UNSUPPORTED', 'Body обязан быть отдельной declared content частью.');
  }
  const shape = contours(entries[index].d);
  if (shape.length > (negative ? 1 : 2) || shape.some(contour => !contour.commands.includes('C')) ||
      !negative && (shape.length === 2 && entries[index].fillRule !== 'evenodd' || shape.length === 1 && entries[index].fillRule !== 'nonzero')) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужен positive capsule либо capsule с одним самостоятельным evenodd counter.');
  }
  const dimensions = shape.map(contour => bounds(contour.points));
  if (dimensions.some(([x, y]) => x[1] - x[0] <= 0 || y[1] - y[0] <= x[1] - x[0]) ||
      shape.length === 2 && dimensions[1].some((interval, axis) => interval[0] <= dimensions[0][axis][0] || interval[1] >= dimensions[0][axis][1])) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужна вертикальная capsule и вложенные axis bounds контрформы.');
  }
  const areas = shape.map(contour => projectedContourAreas(contour.commands, contour.points, [0, 0])[0]);
  if (areas.some(value => !Number.isFinite(value) || value === 0) || shape.length === 2 && Math.sign(areas[0]) === Math.sign(areas[1])) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Counter требует противоположный winding, сохраняемый положительным x-span.');
  }
  const canvas = iconGeometry(source.artifactSvg).viewBox, size = Math.min(canvas.width, canvas.height);
  const gap = size * grid.ratios.clearanceMin, positiveSpan = negative ? gap : size * 2 * grid.ratios.strokeWidth.capRadius;
  if (![gap, positiveSpan].every(value => Number.isFinite(value) && value > 0)) refuse('POLICY_INVALID', 'Нужны owner minimum gap и terminal diameter.');
  const outerWidth = dimensions[0][0][1] - dimensions[0][0][0];
  const compiledContours = shape.map((contour, contourIndex) => {
    const [x, y] = dimensions[contourIndex], width = x[1] - x[0], pivot = (x[0] + x[1]) / 2;
    const rates = contour.points.map(point => (point[0] - pivot) * (contourIndex ? outerWidth / width : 1));
    const error = max(contour.points.map((point, i) => coordinateError(point[0], rates[i])));
    const rateSpan = sub(rational(Math.max(...rates)), rational(Math.min(...rates)));
    const minimumSpan = contourIndex ? gap : positiveSpan;
    // Сравнение high-low тоже округляется; certificate оставляет его полный бюджет.
    const spanError = add(mul(rational(2), error), add(mul(u, add(rational(width), mul(rational(2), error))), eta));
    const minimum = sub(one, div(sub(sub(rational(width), rational(minimumSpan)), spanError), rateSpan));
    return { ...contour, rates, minimumSpan, winding: Math.sign(areas[contourIndex]),
      xOrder: [...new Map(contour.points.map((point, i) => [point[0], i]))].sort((a, b) => a[0] - b[0]).map(([, i]) => i),
      minimum, error };
  });
  const geometricMinimum = directedNumber(max([zero, ...compiledContours.map(contour => contour.minimum)]), 1);
  if (!(geometricMinimum > 0 && geometricMinimum < 1)) refuse('DEFAULT_OUTSIDE_DOMAIN', 'Master не даёт ненулевой width-домен при owner span policy.');
  // Полный численный интервал сохраняется в build evidence. Consumer получает
  // его пересечение с общей оптически принятой областью текущего source style.
  const minimum = Math.max(geometricMinimum, style.minimum);
  const anatomyStatistics = { cells: 0 };
  const anatomyCertificate = negative ? certifyKnockouts(entries.map(entry => contours(entry.d)[0]), anatomyStatistics) : undefined;
  const selfStatistics = { cells: 0 };
  const selfContours = compiledContours.map(contour => certifyMaterializedContour(contour, geometricMinimum, contour.rates, selfStatistics));
  const statistics = { cells: 0 }, curves = compiledContours.map(contour => curvePieces(contour, geometricMinimum, contour.rates));
  if (curves.length === 2) for (const outer of curves[0]) for (const inner of curves[1]) certifySeparation(outer, inner, gap, statistics);
  for (const [otherIndex, entry] of entries.entries()) if (otherIndex !== index) {
    for (const contour of contours(entry.d)) for (const other of curvePieces(contour, geometricMinimum)) {
      for (const capsule of curves[0]) certifySeparation(capsule, other, gap, statistics);
    }
  }
  const proof = { method: 'exact-tensor-bernstein-separation', parameter: 'shared-width', evaluated: 'materialized-binary64-controls',
    geometricDomain: { minimum: geometricMinimum, maximum: 1 },
    cells: statistics.cells, coordinateErrorUpper: compiledContours.map(contour => receipt(contour.error)),
    selfSimplicityCertificate: { method: 'materialized-simple-closed-contours',
      geometricDomain: { minimum: geometricMinimum, maximum: 1 },
      cells: selfStatistics.cells, contours: selfContours },
    ...(anatomyCertificate && { anatomyCertificate }) };
  const domain = { kind: 'bounded-capsule-width', minimum, maximum: 1, minimumInclusive: true, maximumInclusive: true,
    policy: { gridVersion: grid.version, gridSha256: hash(stableJSON(grid)), minimumGap: gap, minimumPositiveSpan: positiveSpan,
      style: { id: style.id, version: style.version, minimum: style.minimum,
        sha256: hash(stableJSON(style)), evidenceSha256: style.evidence.sha256 } },
    certificate: { method: proof.method, sha256: hash(stableJSON(proof)) } };
  const compiled = { version: 1, law: 'capsule.width', source: { masterSha256: source.author.masterSha256,
    pathFingerprintSha256: source.author.pathFingerprintSha256 }, partIds: parts.map(part => part.id),
    body: { id: body.id, index, sourceLiteralSha256: hash(`${body.fillRule}\0${entries[index].d}`),
      contours: compiledContours.map(({ commands, points, rates, minimumSpan, winding, xOrder }) => ({ commands, points, rates, minimumSpan, winding, xOrder })) }, domain };
  const geometry = { ...compiled, geometrySha256: hash(stableJSON(compiled)) };
  return { ...geometry, packetSha256: hash(stableJSON(geometry)), evidence: proof };
}

/** Полные рациональные границы остаются build-only; runtime получает digest. */
export function projectAuthorCapsuleRuntime(compiled) {
  const { evidence: _evidence, ...runtime } = compiled;
  return runtime;
}
