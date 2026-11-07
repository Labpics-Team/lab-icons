import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAuthorCurveCertificate } from '../scripts/lib/author-curve-certificate.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';

const proof = createAuthorCurveCertificate((code, message) => { throw Object.assign(new Error(message), { code }); });
const svg = readFileSync(new URL('../masters/figma/2416636003859748575/Filled/mic-circle.svg', import.meta.url), 'utf8');
const source = proof.contours(authorPathEntries(normalizeFigmaSvg(svg))[0].d);
const shape = d => proof.contours(d)[0];
describe('source containment uses exact curved ray crossings', () => {
  const enclosing = shape('M10 0C15.5 0 20 4.5 20 10C20 15.5 15.5 20 10 20C4.5 20 0 15.5 0 10C0 4.5 4.5 0 10 0Z');
  it.each([
    'M9 10L9 12L11 12L11 10Z',
    'M15.125 5.125L15.125 6.125L16.125 6.125L16.125 5.125Z',
  ])('keeps contained controls at a shared ray endpoint or interior curved root: %s', d => {
    expect(proof.certifySourceContainment(enclosing, shape(d), { cells: 0 }))
      .toMatchObject({ version: 1, method: 'simple-disjoint-contours-exact-ray-winding', sourceWinding: 1 });
  });
  it('keeps clockwise outer authorship with the opposite exact winding', () => {
    const reverse = shape('M10 0C4.5 0 0 4.5 0 10C0 15.5 4.5 20 10 20C15.5 20 20 15.5 20 10C20 4.5 15.5 0 10 0Z');
    expect(proof.certifySourceContainment(reverse, shape('M9 10L9 12L11 12L11 10Z'), { cells: 0 }).sourceWinding).toBe(-1);
  });
  it.each([0, 20])('does not count tangential lower/upper extrema as an interior at Y=%s', y => {
    expect(() => proof.certifySourceContainment(enclosing, shape(`M-2 ${y}L-2 ${y + 1}L-1 ${y + 1}L-1 ${y}Z`), { cells: 0 }))
      .toThrowError(expect.objectContaining({ code: 'COMPOSITION_UNPROVEN' }));
  });
  it('refuses a simple outer beyond the monotone-Y proof language', () => {
    const nonmonotoneY = shape('M0 0C3 3 6 -3 10 0L10 20L0 20Z');
    expect(() => proof.certifySourceContainment(nonmonotoneY, shape('M2 5L2 7L4 7L4 5Z'), { cells: 0 }))
      .toThrowError(expect.objectContaining({ code: 'COMPOSITION_UNPROVEN' }));
  });
});

describe('evenodd counter admission uses containment, simplicity and distinct boundaries', () => {
  it('admits actual author enclosure/support/body without deriving holes from winding', () => {
    const evidence = proof.certifyKnockouts(source, { cells: 0 });
    expect(evidence.method).toBe('simple-disjoint-knockouts-in-inscribed-polygon'); expect(evidence.cells).toBeGreaterThan(0);
  });
  it.each([
    ['overlapping holes refill their intersection', ['M8 8L12 8L12 12L8 12Z', 'M10 10L14 10L14 14L10 14Z'], 'SELF_INTERSECTION_UNPROVEN'],
    ['nested holes refill the inner island', ['M8 8L16 8L16 16L8 16Z', 'M10 10L14 10L14 14L10 14Z'], 'COMPOSITION_UNPROVEN'],
    ['outside enclosure', ['M20 3L21 3L21 4L20 4Z'], 'COMPOSITION_UNPROVEN'],
    ['self-crossed contour', ['M9 9L15 15L9 15L15 9Z'], 'SELF_INTERSECTION_UNPROVEN'],
  ])('refuses %s rather than silently replacing evenodd with subtraction', (_, holes, code) => {
    expect(() => proof.certifyKnockouts([source[0], ...holes.map(shape)], { cells: 0 })).toThrowError(expect.objectContaining({ code }));
  });
  it('refuses an enclosure with controls inside the endpoint polygon', () => {
    const altered = structuredClone(source); altered[0].points[1] = [13, 8];
    expect(() => proof.certifyKnockouts(altered, { cells: 0 })).toThrowError(expect.objectContaining({ code: 'COMPOSITION_UNPROVEN' }));
  });
  it('refuses a fifth closing edge instead of certifying it as four cubic quadrants', () => {
    const altered = structuredClone(source); altered[0].points.at(-1)[0] -= .5;
    expect(() => proof.certifyKnockouts(altered, { cells: 0 })).toThrowError(expect.objectContaining({ code: 'COMPOSITION_UNPROVEN' }));
  });
});
