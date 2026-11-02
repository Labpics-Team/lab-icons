import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomyWithEvidence } from '../scripts/lib/author-anatomy.js';
import { compileAuthorAnnulus, materializeAuthorAnnulus } from '../scripts/lib/author-annulus.js';
import { authorVariationIconNames, authorVariationLawNames } from '../scripts/lib/author-variation.js';
import { renderSymbolModules, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { expandReleaseExports } from '../scripts/lib/release-contract.js';
import { createCompiledAnnulusGlyph } from '../src/ir/author-annulus-runtime.js';
import { createCompiledGlyph } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const ids = {
  'checkmark-circle': ['confirmation-mark', 'confirmation-enclosure'],
  'close-circle': ['dismissal-mark', 'status-enclosure'],
  'question-circle': ['question-dot', 'question-stem', 'status-enclosure'],
  'alert-circle': ['attention-dot', 'attention-stem', 'status-enclosure'],
  'play-circle': ['play-mark', 'playback-enclosure'],
  'pause-circle': ['pause-first-bar', 'pause-second-bar', 'playback-enclosure'],
};
const names = Object.keys(ids), captured = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const sourceNames = [...names, 'mic-circle'];
const baseline = loadAuthorBaseline(root, { manifest: { ...captured,
  counts: { families: sourceNames.length, variants: sourceNames.length * 2 },
  icons: Object.fromEntries(sourceNames.map(icon => [icon, captured.icons[icon]])) } });
const fullSpec = read('semantics/author-anatomy.json'), spec = { ...fullSpec,
  icons: Object.fromEntries(names.filter(icon => Object.hasOwn(fullSpec.icons, icon)).map(icon => [icon, fullSpec.icons[icon]])) };
const { contracts, evidence } = compileAuthorAnatomyWithEvidence(baseline, spec, grid);
const payloads = await authoredSymbolPayloads(names);
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
const metadata = parts => parts.map(({ id, role, fillRule, zIndex }) => ({ id, role, fillRule, zIndex }));

describe('declared circle states reuse the exact annulus law without silhouette admission', () => {
  it.each(names)('%s admits its own source default and preserves declared identities', icon => {
    const proof = evidence[`${icon}/outline`], source = baseline.icons[icon].outline;
    expect(proof).toBeDefined();
    expect(proof.defaults.rawSvg).toBe(source.rawSvg);
    expect(proof.defaults.artifactSvg).toBe(source.artifactSvg);
    expect(materializeAuthorAnnulus(proof, { enclosureEmphasis: 1 })).toBe(proof.defaults);
    expect(proof.defaults.parts.map(part => part.d)).toEqual(rawPaths(source.rawSvg));
    expect(proof.defaults.parts.map(part => part.id)).toEqual(ids[icon]);
    expect(contracts[`${icon}/outline`].parts.every(part => part.identity === 'declared')).toBe(true);
    expect(proof.domain.scale.minimum).toBeLessThan(1);
    expect(proof.domain.scale.maximum).toBeGreaterThan(1);
    expect(contracts[`${icon}/filled`]).toBeUndefined();
    expect(baseline.icons[icon].filled.sourceContract.variation).toBeUndefined();
  });

  it.each(names)('%s changes the counter through the real runtime and retains every content path', icon => {
    const payload = payloads[icon], proof = evidence[`${icon}/outline`];
    expect(proof).toBeDefined();
    const glyph = createCompiledAnnulusGlyph(icon, payload.source, contracts[`${icon}/outline`].variation);
    const sourceGlyph = createCompiledGlyph(icon, payload.source);
    expect(glyph()).toBe(sourceGlyph());
    expect(glyph({ variation: { enclosureEmphasis: 1 } })).toBe(sourceGlyph());
    expect(glyph({ variant: 'filled' })).toBe(sourceGlyph({ variant: 'filled' }));
    expect(() => glyph({ variant: 'filled', variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    expect(() => sourceGlyph({ variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    for (const emphasis of [0.9, 1.1, 2]) {
      const changed = glyph({ variation: { enclosureEmphasis: emphasis } });
      const expected = materializeAuthorAnnulus(proof, { enclosureEmphasis: emphasis });
      expect(changed.parts.map(part => part.d)).toEqual(expected.parts.map(part => part.d));
      expect(changed.parts.at(-1).d).not.toBe(sourceGlyph().parts.at(-1).d);
      expect(changed.parts.at(-1).d.slice(0, proof.enclosure.outerD.length)).toBe(proof.enclosure.outerD);
      for (let index = 0; index < changed.parts.length - 1; index++) {
        expect(changed.parts[index]).toBe(sourceGlyph().parts[index]);
        expect(changed.parts[index].d).toBe(rawPaths(baseline.icons[icon].outline.rawSvg)[index]);
      }
      expect(metadata(changed.parts)).toEqual(metadata(sourceGlyph().parts));
      expect(changed.parts.map(part => part.id)).toEqual(ids[icon]);
      expect(changed.provenance.variation.parameters).toEqual({ enclosureEmphasis: emphasis });
    }
    const output = renderSymbolModules(payload);
    expect(output.variation).toContain('annulus-runtime.js');
    expect(output.symbol).not.toContain('annulus-runtime.js');
    expect(payload.capabilities.outline.variation.targets.webEffect).toBe('existing-part-gestures');
  });

  it('retains the existing confirmation gesture and does not invent gestures for other states', () => {
    expect(spec.icons['checkmark-circle'].outline.gesture).toEqual({
      law: 'confirmation.presence', purpose: 'confirmation', partId: 'confirmation-mark' });
    const payload = payloads['checkmark-circle'], glyph = createCompiledGlyph(payload.icon, payload.source);
    expect(payload.capabilities.outline.motion.gestures).toHaveLength(1);
    expect(payload.capabilities.outline.motion.gestures[0]).toMatchObject({
      id: 'checkmark-circle.presence', partIds: ['confirmation-mark'], restProgress: 1 });
    expect(compileSymbolEffect(glyph(), payload.capabilities.outline, 'checkmark-circle.presence', { duration: 300 }).ok).toBe(true);
    for (const icon of names.filter(icon => icon !== 'checkmark-circle')) {
      expect(contracts[`${icon}/outline`].gestures).toEqual([]);
      expect(payloads[icon].capabilities.outline.motion.gestures).toEqual([]);
    }
  });

  it('derives new opt-in package entries from the same declarations', () => {
    expect(authorVariationIconNames(spec)).toEqual([...names].sort());
    expect(authorVariationLawNames(spec)).toEqual(['annulus.counter-scale']);
    const projection = symbolReleaseProjection(read('release/contract.json'), names, [],
      authorVariationIconNames(spec), authorVariationLawNames(spec));
    const exports = expandReleaseExports(projection);
    for (const icon of names) {
      expect(exports[`./variations/${icon}`]).toEqual({
        types: `./dist/variations/${icon}.d.ts`, import: `./dist/variations/${icon}.js` });
      expect(projection.files).toContain(`dist/variations/${icon}.js`);
    }
  });

  it('refuses mic-circle despite its identical ring and does not unify content-dependent domains', () => {
    const source = baseline.icons['mic-circle'].outline;
    expect(rawPaths(source.rawSvg).at(-1)).toBe(rawPaths(baseline.icons['checkmark-circle'].outline.rawSvg).at(-1));
    const parts = source.sourceContract.parts.map((part, index) => ({ ...part,
      id: index === source.sourceContract.parts.length - 1 ? 'mic-enclosure' : `mic-content-${index}`,
      identity: 'declared', role: index === source.sourceContract.parts.length - 1 ? 'container' : 'content' }));
    // Только тестовый кандидат: равный силуэт не даёт production-аннотацию микрофону.
    const declaration = { law: 'annulus.counter-scale', parameter: 'enclosureEmphasis', variant: 'outline',
      enclosurePartId: 'mic-enclosure', source: Object.fromEntries(
        ['fileKey', 'version', 'masterSha256', 'pathFingerprintSha256'].map(key => [key, source.author[key]])) };
    expect(() => compileAuthorAnnulus(source, parts, declaration, grid))
      .toThrow(expect.objectContaining({ code: 'DEFAULT_OUTSIDE_DOMAIN' }));
    expect(fullSpec.icons['mic-circle']).toBeUndefined();
    expect(evidence['checkmark-circle/outline'].domain.scale.minimum)
      .not.toBe(evidence['play-circle/outline'].domain.scale.minimum);
    expect(evidence['checkmark-circle/outline'].domain.proof.contentUpperSquared)
      .not.toEqual(evidence['play-circle/outline'].domain.proof.contentUpperSquared);
  });
});
