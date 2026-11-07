import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy, compileAuthorAnatomyWithEvidence } from '../scripts/lib/author-anatomy.js';
import { materializeAuthorAnnulus, projectAuthorAnnulusRuntime } from '../scripts/lib/author-annulus.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(file, new URL('..', import.meta.url)), 'utf8'));
const names = ['plus-circle', 'minus-circle'], manifest = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: 2, variants: 4 },
  icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
const document = read('semantics/author-anatomy.json');
const spec = { ...document, icons: Object.fromEntries(names.map(icon => [icon, document.icons[icon]])) };
const originalFilled = Object.fromEntries(names.map(icon => [icon, baseline.icons[icon].filled.sourceContract]));
const result = compileAuthorAnatomyWithEvidence(baseline, spec, grid);
const compile = (input = spec, source = baseline) => compileAuthorAnatomyWithEvidence(source, input, grid);

describe('real annulus author declarations → production source contract → compact runtime projection', () => {
  it.each(names)('%s has independent authored sign/enclosure parts and untouched Filled source', icon => {
    const contract = result.contracts[`${icon}/outline`], source = baseline.icons[icon].outline;
    expect(contract.parts.map(({ id, role }) => ({ id, role }))).toEqual([
      { id: icon === 'plus-circle' ? 'increase-mark' : 'decrease-mark', role: 'content' },
      { id: 'status-enclosure', role: 'container' },
    ]);
    expect(contract.parts.every(part => part.identity === 'declared')).toBe(true);
    expect(contract.parts.map(part => part.fillRule)).toEqual(['nonzero', 'evenodd']);
    expect(contract.gestures).toEqual([]);
    expect(contract.anatomy).toMatchObject({ masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256 });
    expect(result.contracts[`${icon}/filled`]).toBeUndefined();
    expect(baseline.icons[icon].filled.sourceContract).toBe(originalFilled[icon]);
    expect(originalFilled[icon].variation).toBeUndefined();
    expect(originalFilled[icon].parts.every(part => part.identity === 'geometry-derived')).toBe(true);
    expect(compileAuthorAnatomy(baseline, spec, grid)).toEqual(result.contracts);
  });
  it.each(names)('%s derives a single source receipt and keeps full certificate in build evidence', icon => {
    const key = `${icon}/outline`, declaration = spec.icons[icon].outline, { variation } = result.contracts[key], proof = result.evidence[key];
    expect(Object.keys(declaration.variation).sort()).toEqual(['enclosurePartId', 'law', 'parameter']);
    expect(proof.source).toMatchObject({ ...spec.source, masterSha256: declaration.masterSha256,
      pathFingerprintSha256: declaration.pathFingerprintSha256 });
    expect(proof.domain.proof).toHaveProperty('outerLowerSquared.numerator');
    expect(proof.domain.emphasisBounds).toHaveProperty('meaning');
    expect(proof.defaults.rawSvg).toBe(baseline.icons[icon].outline.rawSvg);
    expect(variation).toEqual(projectAuthorAnnulusRuntime(proof));
    expect(variation.geometrySha256).toBe(proof.geometrySha256);
    expect(Object.isFrozen(variation.enclosure.innerPoints[0])).toBe(true);
    const changed = materializeAuthorAnnulus(proof, { enclosureEmphasis: 1.1 });
    expect(changed.parts[0].d).toBe(authorPathEntries(baseline.icons[icon].outline.artifactSvg)[0].d);
    expect(changed.parts[1].d.startsWith(variation.enclosure.outerD)).toBe(true);
  });
  it.each(names)('%s projects only fixed geometry, actual-scale admission and source/part identity', icon => {
    const packet = result.contracts[`${icon}/outline`].variation;
    expect(Object.keys(packet).sort()).toEqual(['domain', 'enclosure', 'geometrySha256', 'law', 'partIds', 'source', 'version']);
    expect(Object.keys(packet.enclosure).sort()).toEqual(['center', 'id', 'index', 'innerPoints', 'outerD', 'outerRadius', 'referenceInnerRadius', 'referenceThickness']);
    expect(Object.keys(packet.source).sort()).toEqual(['masterSha256', 'pathFingerprintSha256']);
    expect(Object.keys(packet.domain).sort()).toEqual(['evaluated', 'kind', 'parameter', 'scale']);
    expect(packet.domain).toMatchObject({ evaluated: 'actual-binary64-scale', scale: { minimumInclusive: true, maximumInclusive: false } });
    expect(packet.enclosure.innerPoints).toHaveLength(12);
    const json = JSON.stringify(packet);
    expect(json).not.toMatch(/rawSvg|artifactSvg|defaults|numerator|denominator|coordinateError|emphasisBounds|<svg|<path/);
    expect(JSON.parse(json)).toEqual(packet);
  });
  it('rejects duplicated variation receipts, wrong semantics and unsupported Filled admission', () => {
    const duplicated = structuredClone(spec); duplicated.icons['plus-circle'].outline.variation.source = { ...spec.source };
    expect(() => compile(duplicated)).toThrow(expect.objectContaining({ code: 'ANNOTATION_INVALID' }));
    const unsupported = structuredClone(spec); unsupported.icons['plus-circle'].outline.variation.parameter = 'weight';
    expect(() => compile(unsupported)).toThrow(expect.objectContaining({ code: 'LAW_UNSUPPORTED' }));
    const filled = structuredClone(spec); filled.icons['plus-circle'].filled = { ...structuredClone(spec.icons['plus-circle'].outline),
      masterSha256: baseline.icons['plus-circle'].filled.author.masterSha256,
      pathFingerprintSha256: baseline.icons['plus-circle'].filled.author.pathFingerprintSha256,
      parts: [{ pathIndex: 0, id: 'status-enclosure', role: 'container' }] };
    expect(() => compile(filled)).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
  });
  it('rejected source/version/master mismatches do not expose a partial evidence result', () => {
    const version = structuredClone(spec); version.source.version += '-other';
    expect(() => compile(version)).toThrow(expect.objectContaining({ code: 'SOURCE_MISMATCH' }));
    const master = structuredClone(spec); master.icons['minus-circle'].outline.masterSha256 = '0'.repeat(64);
    expect(() => compile(master)).toThrow(expect.objectContaining({ code: 'MASTER_MISMATCH' }));
    const roles = structuredClone(spec); roles.icons['plus-circle'].outline.parts[1].role = 'content';
    expect(() => compile(roles)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
  });
});
