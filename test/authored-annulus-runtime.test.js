import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomyWithEvidence } from '../scripts/lib/author-anatomy.js';
import { materializeAuthorAnnulus } from '../scripts/lib/author-annulus.js';
import { renderSymbolModules, symbolExportName, variationModuleDeclaration, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledAnnulusGlyph } from '../src/ir/author-annulus-runtime.js';
import { createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { compileLottieGeometry } from '../scripts/lib/lottie-geometry.js';
import { createLottieSymbol } from '../src/lottie/runtime.js';
import { parsePathData } from '../src/core/path-data.js';
import { authorVariationCapability, authorVariationIconNames, authorVariationLawNames } from '../scripts/lib/author-variation.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const names = ['plus-circle', 'minus-circle'], fullManifest = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...fullManifest, counts: { families: 2, variants: 4 },
  icons: Object.fromEntries(names.map(icon => [icon, fullManifest.icons[icon]])) } });
const fullSpec = read('semantics/author-anatomy.json'), spec = { ...fullSpec,
  icons: Object.fromEntries(names.map(icon => [icon, fullSpec.icons[icon]])) };
const { contracts, evidence } = compileAuthorAnatomyWithEvidence(baseline, spec, grid);
const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(['outline', 'filled'].map(variant => [variant,
  { ...baseline.icons[icon][variant], sourceContract: contracts[`${icon}/${variant}`] ?? baseline.icons[icon][variant].sourceContract }]))]));
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(names.map(icon => [icon, { model: null,
    source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => ['outline', 'filled'].map(variant =>
    [symbolExportName(icon, variant), sources[icon][variant].artifactSvg]))) });

function control(icon) {
  const payload = authorSymbolPayload(icon, sources[icon], compiler), packet = contracts[`${icon}/outline`].variation;
  const capabilities = { outline: { ...payload.capabilities.outline, variation: authorVariationCapability(packet) },
    filled: payload.capabilities.filled };
  return { ...payload, capabilities, variation: { outline: packet },
    glyph: createCompiledAnnulusGlyph(icon, payload.source, packet), glyphCapabilities: createCompiledCapabilities(capabilities) };
}

async function consumer(input, entry) {
  const projections = renderSymbolModules(input), resolved = [];
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'author-annulus-public-consumer', setup(plugin) {
      plugin.onResolve({ filter: /^test-(symbol|variation)$/ }, args => ({ path: args.path, namespace: 'entry', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'entry' }, args => ({ contents: args.path === 'test-symbol' ? projections.symbol : projections.variation,
        loader: 'js', resolveDir: root }));
      plugin.onResolve({ filter: /symbol-data\/[a-z0-9-]+\.js$/ }, () => ({ path: 'data', namespace: 'data', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'data' }, () => ({ contents: projections.data, loader: 'js', resolveDir: root }));
      plugin.onResolve({ filter: /(?:annulus|symbol|variation)-runtime\.js$/ }, args => {
        resolved.push(args.path);
        const source = args.path.endsWith('/annulus-runtime.js') ? 'author-annulus-runtime' :
          args.path.endsWith('/variation-runtime.js') ? 'authored-variation' : 'symbol-runtime';
        return { path: fileURLToPath(new URL(`../src/ir/${source}.ts`, import.meta.url)) };
      });
    } }], metafile: true });
  const code = output.outputFiles[0].text;
  return { code, module: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`),
    resolved, loaded: Object.keys(output.metafile.inputs), projections };
}

describe('authored annulus opt-in: certified build packet → real public consumer', () => {
  it('release projection follows real declared laws and does not force dots runtime into annulus imports', () => {
    const projection = symbolReleaseProjection(read('release/contract.json'), names, [],
      authorVariationIconNames(spec), authorVariationLawNames(spec));
    expect(projection.runtimeDependencies).toContain('dist/ir/annulus-runtime.js');
    expect(projection.runtimeDependencies).not.toContain('dist/ir/variation-runtime.js');
    expect(projection.typeDependencies).toContain('dist/ir/author-annulus-types.d.ts');
    expect(projection.files).toContain('dist/variations/plus-circle.js');
    expect(projection.files).toContain('dist/ir/symbol-data/minus-circle.js');
    expect(() => symbolReleaseProjection(read('release/contract.json'), names, [], names, ['invented.law'])).toThrow(TypeError);
  });
  it.each(names)('%s keeps shared exact default and independent Filled refusal', icon => {
    const module = control(icon), source = module.source.outline;
    expect(module.glyph()).toBe(source);
    expect(module.glyph({ variation: {} })).toBe(source);
    expect(module.glyph({ modelMode: 'source-only', variation: { enclosureEmphasis: 1 } })).toBe(source);
    expect(module.glyph({ variant: 'filled' })).toBe(module.source.filled);
    for (const variation of [{}, { enclosureEmphasis: 1 }, { enclosureEmphasis: 1.1 }]) {
      expect(() => module.glyph({ variant: 'filled', variation })).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    }
    expect(module.glyphCapabilities().variation).toMatchObject({ version: 1, law: 'annulus.counter-scale', defaults: { enclosureEmphasis: 1 } });
    expect(module.glyphCapabilities('filled')).not.toHaveProperty('variation');
    expect(module.glyphCapabilities().supportedAxes).toEqual([]);
    expect(module.glyphCapabilities().modelState).toBeNull();
  });

  it.each(names)('%s reproduces full certified materializer and preserves original outer/content', icon => {
    const module = control(icon), packet = module.variation.outline, proof = evidence[`${icon}/outline`], source = module.glyph();
    for (const emphasis of [0.5, 0.9, 1.1, 1.5, 2]) {
      const expected = materializeAuthorAnnulus(proof, { enclosureEmphasis: emphasis });
      const actual = module.glyph({ variation: { enclosureEmphasis: emphasis } });
      expect(actual.parts.map(part => part.d)).toEqual(expected.parts.map(part => part.d));
      expect(actual.parts[0]).toBe(source.parts[0]);
      expect(actual.parts[1].d.startsWith(packet.enclosure.outerD)).toBe(true);
      expect(actual.parts[1].topologySignature).toBe(source.parts[1].topologySignature);
      expect(actual.parts[1].anchor).toBe(source.parts[1].anchor);
      expect(actual.svg).toContain(`d="${actual.parts[1].d}"`);
      expect(actual.provenance.variation).toMatchObject(expected.provenance.variation);
      expect(actual.parts[1].provenance.artifactFingerprint).not.toBe(source.parts[1].provenance.artifactFingerprint);
      expect(actual.parts[1].provenance.fingerprintBasis).toBe('literal-path');
      expect(actual.parts[1].provenance.artifactFingerprint).toBe(`sha256:${createHash('sha256')
        .update(`${actual.parts[1].fillRule}\0${actual.parts[1].d}`).digest('hex')}`);
      expect(Object.isFrozen(actual.parts[1].provenance.variation.parameters)).toBe(true);
      const commands = parsePathData(actual.parts[1].d).map(segment => segment.cmd).join('');
      expect(commands).toBe('MCCCCZMCCCCZ');
    }
  });

  it.each(names)('%s rejects invalid, numeric-boundary and precise source-only requests', icon => {
    const module = control(icon), proof = evidence[`${icon}/outline`];
    for (const variation of [null, [], { enclosureEmphasis: null }, { enclosureEmphasis: 0 }, { enclosureEmphasis: -1 },
      { enclosureEmphasis: Infinity }, { enclosureEmphasis: NaN }, { weight: 1.1 }, { dotScale: 1.1 }]) {
      expect(() => module.glyph({ variation })).toThrow(expect.objectContaining({ code: 'INVALID_VARIATION' }));
    }
    const boundary = proof.domain.emphasisBounds;
    for (const emphasis of [boundary.minimum * 0.99, 2.6]) {
      expect(() => module.glyph({ variation: { enclosureEmphasis: emphasis } }))
        .toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
    }
    expect(() => module.glyph({ variation: { enclosureEmphasis: 100 } })).toThrow(expect.objectContaining({ code: 'VARIATION_UNREPRESENTABLE' }));
    expect(() => module.glyph({ modelMode: 'source-only', variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    expect(() => module.glyph({ axes: { weight: 1.1 }, variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
  });

  it.each(names)('%s agrees with the certified build at adjacent binary64 boundary requests', icon => {
    const module = control(icon), proof = evidence[`${icon}/outline`];
    const { outerRadius: R, referenceInnerRadius: r, referenceThickness: T } = proof.enclosure;
    const next = (value, direction) => {
      const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
      bytes.setBigUint64(0, bytes.getBigUint64(0) + BigInt(direction)); return bytes.getFloat64(0);
    };
    const outcome = operation => {
      try { return { ok: true, value: operation() }; } catch (error) { return { ok: false, code: error.code }; }
    };
    let accepted = 0, refused = 0;
    for (const bound of [proof.domain.scale.minimum, proof.domain.scale.maximum]) {
      const middle = (R - r * bound) / T;
      for (const emphasis of [next(next(middle, -1), -1), next(middle, -1), middle, next(middle, 1), next(next(middle, 1), 1)]) {
        const variation = { enclosureEmphasis: emphasis };
        const expected = outcome(() => materializeAuthorAnnulus(proof, variation));
        const actual = outcome(() => module.glyph({ variation }));
        expect(actual.ok).toBe(expected.ok);
        if (expected.ok) {
          expect(actual.value.parts.map(part => part.d)).toEqual(expected.value.parts.map(part => part.d));
          accepted++;
        } else { expect(actual.code).toBe(expected.code); refused++; }
      }
    }
    expect(accepted).toBeGreaterThan(0); expect(refused).toBeGreaterThan(0);
  });

  it.each(names)('%s retains honest motion and Lottie refusal without a fabricated fade', icon => {
    const module = control(icon), glyph = module.glyph({ variation: { enclosureEmphasis: 1.1 } });
    expect(compileSymbolEffect(glyph, module.glyphCapabilities(), `${icon}.presence`, { duration: 300 }))
      .toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    expect(compileLottieGeometry(glyph)).toMatchObject({ ok: false, reason: { code: 'AUTHOR_SOURCE_REQUIRED' } });
    const target = createLottieSymbol(module, Object.fromEntries(['outline', 'filled'].map(variant => [variant, compileLottieGeometry(module.source[variant])])));
    expect(target.exportLottie()).toMatchObject({ ok: true });
    expect(target.exportLottie({ variation: { enclosureEmphasis: 1.1 } }))
      .toMatchObject({ ok: false, reason: { code: 'VARIATION_UNSUPPORTED' } });
  });

  it.each(names)('%s public projection excludes dots engine, keeps source identity and refuses undeclared variants', async icon => {
    const input = control(icon), actual = await consumer(input,
      'export { glyph, glyphCapabilities, outline, filled } from "test-variation"; export { glyph as sourceGlyph } from "test-symbol";');
    const module = actual.module;
    expect(module.glyph()).toBe(module.sourceGlyph());
    expect(module.glyph({ variant: 'filled' })).toBe(module.sourceGlyph({ variant: 'filled' }));
    expect(module.glyph({ variation: { enclosureEmphasis: 1.1 } })).toEqual(input.glyph({ variation: { enclosureEmphasis: 1.1 } }));
    expect(() => module.sourceGlyph({ variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    expect(module.glyphCapabilities('filled')).not.toHaveProperty('variation');
    expect(actual.projections.symbol).not.toContain('annulus-runtime');
    expect(actual.projections.data).not.toContain('radial-bernstein');
    expect(actual.code).not.toContain('dots.affine');
    expect(actual.loaded.some(path => path.endsWith('authored-variation.ts'))).toBe(false);
    expect(variationModuleDeclaration(icon, 'annulus.counter-scale')).toContain('AuthorAnnulusVariationGlyphRequest');
  });

  it('ordinary and static imports remove the entire variation law and capability-only removes materialization', async () => {
    const input = control('plus-circle');
    const source = await consumer(input, 'export { glyph } from "test-symbol";');
    expect(source.module.glyph()).toEqual(input.source.outline);
    expect(source.code).not.toMatch(/radial-bernstein|VARIATION_OUTSIDE_DOMAIN|enclosureEmphasis/);
    const staticOnly = await consumer(input, 'export { outline } from "test-variation";');
    expect(staticOnly.code).not.toMatch(/radial-bernstein|VARIATION_OUTSIDE_DOMAIN|enclosureEmphasis|AUTHOR_PARITY_REQUIRED/);
    const capability = await consumer(input, 'export { glyphCapabilities } from "test-variation";');
    expect(capability.module.glyphCapabilities().variation.law).toBe('annulus.counter-scale');
    expect(capability.code).not.toMatch(/VARIATION_UNREPRESENTABLE|Uint32Array/);
  });

  it('compiled source/version/part identity drift refuses before the public factory is exposed', () => {
    const input = control('plus-circle');
    const drift = structuredClone(input.variation.outline); drift.source.masterSha256 = '0'.repeat(64);
    expect(() => createCompiledAnnulusGlyph('plus-circle', input.source, drift))
      .toThrow(expect.objectContaining({ code: 'VARIATION_SOURCE_MISMATCH' }));
    const wrongPart = structuredClone(input.variation.outline); wrongPart.partIds.reverse();
    expect(() => createCompiledAnnulusGlyph('plus-circle', input.source, wrongPart))
      .toThrow(expect.objectContaining({ code: 'VARIATION_SOURCE_MISMATCH' }));
    expect(() => renderSymbolModules({ ...input, variation: { outline: input.variation.outline, filled: input.variation.outline } }))
      .toThrow(/law не соответствует/);
    const projection = structuredClone({ icon: input.icon, source: input.source, capabilities: input.capabilities,
      staticSvg: input.staticSvg, variation: input.variation });
    projection.capabilities.outline.variation.domain = structuredClone(projection.capabilities.outline.variation.domain);
    projection.capabilities.outline.variation.domain.scale.maximum += 0.001;
    expect(() => renderSymbolModules(projection)).toThrow(/compiled domain и capability не совпадают/);
  });
});
