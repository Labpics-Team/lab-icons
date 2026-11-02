import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileAuthorCapsule } from '../scripts/lib/author-capsule.js';
import { createAuthorCurveCertificate } from '../scripts/lib/author-curve-certificate.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { closedSourceContourLiterals } from '../src/core/source-contours.js';
import { createAuthorExactArithmetic } from '../scripts/lib/author-exact-arithmetic.js';

const raw = readFileSync(new URL('../masters/figma/2416636003859748575/Filled/mic-circle.svg', import.meta.url), 'utf8');
const original = authorPathEntries(normalizeFigmaSvg(raw))[0].d, fragments = closedSourceContourLiterals(original);
const grid = JSON.parse(readFileSync(new URL('../semantics/grid.json', import.meta.url), 'utf8'));
const witness = 'M10.00052 6Q10.50052 8 9.000519999999998 10L10.12552 10C10.12552 9 10.12552 7 10.12552 6Z';
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
const certificate = createAuthorCurveCertificate((code, message) => { throw Object.assign(new Error(message), { code }); });
const sourceEnclosure = certificate.contours('M10 0C15.5 0 20 4.5 20 10C20 15.5 15.5 20 10 20C4.5 20 0 15.5 0 10C0 4.5 4.5 0 10 0Z')[0];
const arithmetic = createAuthorExactArithmetic(() => { throw new Error('Exact oracle arithmetic failed'); });
const parts = ['container', 'counter', 'counter'].map((role, index) => ({ id: ['enclosure', 'support', 'body'][index],
  identity: 'declared', zIndex: index, role, fillRule: null, contourIndices: [index] }));
function compile(body) {
  const d = fragments[0] + fragments[1] + body;
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
  return compileAuthorCapsule({ rawSvg: svg, artifactSvg: svg, author: { fileKey: 'LuaiBd4anRi4DMZayKAnY2', version: '2416636003859748575',
    masterSha256: hash(svg), pathFingerprintSha256: hash(stableJSON(authorPathEntries(svg))) } }, parts,
  { law: 'capsule.width', parameter: 'bodyWidth', bodyPartId: 'body' }, grid, { kind: 'compound', fillRule: 'evenodd' });
}
function compilePositive(body) {
  const support = 'M20 20L21 20L21 21L20 21Z';
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="${body}"/><path fill="currentColor" d="${support}"/></svg>`;
  return compileAuthorCapsule({ rawSvg: svg, artifactSvg: svg, author: { fileKey: 'LuaiBd4anRi4DMZayKAnY2', version: '2416636003859748575',
    masterSha256: hash(svg), pathFingerprintSha256: hash(stableJSON(authorPathEntries(svg))) } },
  ['body', 'support'].map((id, zIndex) => ({ id, identity: 'declared', zIndex, role: 'content', fillRule: 'nonzero' })),
  { law: 'capsule.width', parameter: 'bodyWidth', bodyPartId: 'body' }, grid);
}

describe('capsule width certifies the materialized contour, including binary64 perturbations', () => {
  it('rejects the independently reproduced Q/C crossing although the source is simple', () => {
    expect(() => certificate.certifyKnockouts([certificate.contours(fragments[0])[0], certificate.contours(fragments[1])[0],
      certificate.contours(witness)[0]], { cells: 0 })).not.toThrow();
    // Независимый точный oracle читает уже воспроизведённые binary64 controls,
    // а не повторяет interval proof: Q(.25) находится справа от vertical C.
    const { rational: r, add, mul, sub, receipt } = arithmetic;
    const q = add(add(mul(r(9 / 16), r(9.95052)), mul(r(6 / 16), r(10.35052))), mul(r(1 / 16), r(9.150519999999998)));
    expect(receipt(sub(r(10.050519999999999), q))).toEqual({ numerator: '-1', denominator: '2251799813685248' });
    expect(() => compile(witness)).toThrowError(expect.objectContaining({ code: 'SELF_INTERSECTION_UNPROVEN' }));
  });
  it.each([.8, .9, 1])('keeps the actual author contour and materialized controls at width %s', width => {
    const compiled = compile(fragments[2]), body = compiled.body.contours[0];
    expect(compiled.domain.minimum).toBe(.8);
    expect(compiled.evidence.selfSimplicityCertificate).toMatchObject({ version: 2, method: 'materialized-simple-closed-contours',
      geometricDomain: compiled.evidence.geometricDomain });
    expect(() => certificate.certifyKnockouts([certificate.contours(fragments[0])[0], certificate.contours(fragments[1])[0],
      { commands: body.commands, points: body.points.map((point, i) => [point[0] + (width - 1) * body.rates[i], point[1]]) }], { cells: 0 })).not.toThrow();
  });
  it.each([.02, .125])('keeps legal separated Q/C neighbors with horizontal gap %s', gap => {
    const legal = witness.replaceAll('10.12552', String(10.12552 + gap));
    expect(compile(legal).evidence.selfSimplicityCertificate).toMatchObject({ method: 'materialized-simple-closed-contours' });
  });
  it.each([
    'M10 4C9.7 14 9.3 14 9 4L11 4C10.7 14 10.3 14 10 4Z',
    'M10 4C9.1 14 7.9 14 7 4L13 4C12.1 14 10.9 14 10 4Z',
  ])('refuses a three-piece body whose far endpoint touches an adjacent line: %s', d => {
    expect(() => compilePositive(d)).toThrowError(expect.objectContaining({ code: 'SELF_INTERSECTION_UNPROVEN' }));
    expect(() => certificate.certifyKnockouts([sourceEnclosure, certificate.contours(d)[0]], { cells: 0 }))
      .toThrowError(expect.objectContaining({ code: 'SELF_INTERSECTION_UNPROVEN' }));
  });
  it('keeps a legal three-piece neighbor with a separated far endpoint', () => {
    const d = 'M10 4.001C9.1 14 7.9 14 7 4L13 4C12.1 14 10.9 14 10 4.001Z';
    expect(compilePositive(d).evidence.selfSimplicityCertificate.contours).toEqual([{ segments: 3, adjacentPairs: 3 }]);
    expect(() => certificate.certifyKnockouts([sourceEnclosure, certificate.contours(d)[0]], { cells: 0 })).not.toThrow();
  });
  it('keeps an ordinary three-edge triangle instead of banning three-piece contours', () => {
    const triangle = certificate.contours('M10 6L9 8L11 8Z')[0];
    expect(certificate.certifyMaterializedContour(triangle, .8, triangle.points.map(point => point[0] - 10), { cells: 0 }))
      .toEqual({ segments: 3, adjacentPairs: 3 });
    expect(() => certificate.certifyKnockouts([certificate.contours(fragments[0])[0], triangle], { cells: 0 })).not.toThrow();
  });
});
