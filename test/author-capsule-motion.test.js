import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { authorCapsuleMotionSymbolNames, projectAuthorCapsuleMotion, renderAuthorCapsuleMotionModule,
  authorCapsuleMotionModuleDeclaration } from '../scripts/lib/author-capsule-motion.js';
import { authorMotionTargets } from '../scripts/lib/author-motion-targets.js';
import { symbolReleaseProjection, renderSymbolModules } from '../scripts/lib/symbol-modules.js';
import { createCompiledBodyWidthPreparation, createCompiledBodyWidthCapabilities } from '../src/ir/author-capsule-motion-runtime.ts';
import { createCompiledCapsuleGlyph } from '../src/ir/author-capsule-runtime.ts';
import { parsePathData } from '../src/core/path-data.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const names = ['mic', 'mic-circle'];
const inputs = await authoredSymbolPayloads(names);
const packets = Object.fromEntries(names.map(icon => [icon, projectAuthorCapsuleMotion(inputs[icon])]));
const preparations = Object.fromEntries(names.map(icon => [icon, createCompiledBodyWidthPreparation(
  Object.fromEntries(Object.entries(packets[icon].variants).map(([variant, value]) => [variant, value.motion])))]));
const staticGlyphs = Object.fromEntries(names.map(icon => [icon, createCompiledCapsuleGlyph(icon, inputs[icon].source, inputs[icon].variation)]));
const physicalD = (source, bodyIndex) => source.composition.kind === 'compound' ? source.parts.map(part => part.d).join('') : source.parts[bodyIndex].d;
const variants = names.flatMap(icon => ['outline', 'filled'].map(variant => [icon, variant]));
const legacySource = execFileSync('git', ['show', '8e2b96e52cb65f06884a510af233865213ccf699:src/ir/author-capsule-runtime.ts'], { cwd: root, encoding: 'utf8' });
const oldBundle = await build({ stdin: { contents: legacySource, loader: 'ts', resolveDir: fileURLToPath(new URL('../src/ir', import.meta.url)) },
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
const legacy = await import(`data:text/javascript;base64,${Buffer.from(oldBundle.outputFiles[0].text).toString('base64')}`);

async function consume(icon, exports) {
  const module = renderAuthorCapsuleMotionModule(packets[icon]).replace('../ir/capsule-motion-runtime.js', './src/ir/author-capsule-motion-runtime.ts');
  const result = await build({ stdin: { contents: `export {${exports}} from 'packet';`, resolveDir: root },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent', metafile: true,
    plugins: [{ name: 'capsule-motion-consumer', setup(builder) {
      builder.onResolve({ filter: /^packet$/ }, () => ({ path: icon, namespace: 'capsule-packet' }));
      builder.onLoad({ filter: /.*/, namespace: 'capsule-packet' }, () => ({ contents: module, resolveDir: root, loader: 'js' }));
    } }],
  });
  const text = result.outputFiles[0].text;
  return { text, exports: await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`),
    retained: Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([, value]) => value.bytesInOutput > 0).map(([file]) => file) };
}

describe('prepared optical width uses one law and the actual physical render path', () => {
  it('derives motion targets from genuine variation declarations without fake rotation', () => {
    const document = read('semantics/author-anatomy.json');
    expect(authorCapsuleMotionSymbolNames(document)).toEqual(names);
    expect(authorMotionTargets(document)).toEqual({ rotations: ['refresh', 'reload'], capsules: names,
      names: ['mic', 'mic-circle', 'refresh', 'reload'] });
    expect(document.icons.timer.outline.gesture).toBeNull();
    expect(renderAuthorCapsuleMotionModule(packets.mic)).not.toContain('compileMotionEffect');
  });

  it.each(variants)('%s/%s preserves default and exactly matches legacy materialization throughout the bounded domain', (icon, variant) => {
    const source = inputs[icon].source[variant], geometry = inputs[icon].variation[variant];
    const prepared = preparations[icon](variant).prepared;
    const oldGlyph = legacy.createCompiledCapsuleGlyph(icon, inputs[icon].source, inputs[icon].variation);
    expect(preparations[icon](variant).prepared).toBe(prepared);
    expect(prepared.svg).toBe(source.svg);
    expect(prepared.sample(1).d).toBe(physicalD(source, geometry.body.index));
    expect(prepared.renderTarget).toEqual({ attribute: 'd', partId: 'microphone-body',
      selector: icon === 'mic-circle' && variant === 'filled'
        ? '[data-parts="microphone-enclosure microphone-support microphone-body"]' : '[data-part="microphone-body"]',
      unchangedPartIds: source.parts.filter(part => part.id !== 'microphone-body').map(part => part.id) });
    for (const width of [.8, .8000000000000002, .875, .9, .92, .9999999999999999, 1]) {
      const request = { variant, variation: { bodyWidth: width } };
      const varied = staticGlyphs[icon](request), old = oldGlyph(request);
      expect(varied).toEqual(old);
      expect(prepared.sample(width)).toEqual({ ok: true, bodyWidth: width, d: physicalD(old, geometry.body.index) });
      for (const [index, part] of varied.parts.entries()) if (index !== geometry.body.index) expect(part).toBe(source.parts[index]);
    }
    expect(prepared.sample(.9).d).not.toBe(prepared.sample(1).d);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.renderTarget)).toBe(true);
    expect(Object.isFrozen(prepared.sample(.9))).toBe(true);
  });

  it('preserves hollow capsule wall span and falsifies whole-body scaleX', () => {
    const source = inputs.mic.source.outline, bodyIndex = inputs.mic.variation.outline.body.index;
    const paths = width => parsePathData(staticGlyphs.mic({ variation: { bodyWidth: width } }).parts[bodyIndex].d)
      .reduce((contours, segment) => { if (segment.cmd === 'M') contours.push([]);
        contours.at(-1).push(...[segment.x, segment.x1, segment.x2].filter(Number.isFinite)); return contours; }, []);
    const spans = width => paths(width).map(xs => Math.max(...xs) - Math.min(...xs));
    const before = spans(1), after = spans(.8);
    expect(after[0] - after[1]).toBeCloseTo(before[0] - before[1], 11);
    expect((before[0] - before[1]) * .8).not.toBeCloseTo(after[0] - after[1], 3);
    expect(preparations.mic().prepared.sample(.8).d).not.toBe(source.parts[bodyIndex].d);
  });

  it('refuses malformed/unsupported requests and out-of-domain widths without clamping', () => {
    const prepare = preparations.mic, prepared = prepare().prepared;
    for (const variant of [null, {}, [], 'other', 0, false, Symbol('outline')]) expect(prepare(variant))
      .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    const outlineOnly = createCompiledBodyWidthPreparation({ outline: packets.mic.variants.outline.motion });
    expect(outlineOnly('filled')).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
    for (const width of [null, undefined, {}, [], '0.9', NaN, Infinity, -Infinity, Symbol('width')]) expect(prepared.sample(width))
      .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    for (const width of [.7999999999999999, 1.0000000000000002, 0, -1]) expect(prepared.sample(width))
      .toMatchObject({ ok: false, reason: { code: 'VARIATION_OUTSIDE_DOMAIN' } });
    expect(prepared.sample(.8).ok).toBe(true); expect(prepared.sample(1).ok).toBe(true);
  });

  it.each([
    ['controls', value => { value.variation.outline.body.contours[0].points[0][0] += .01; }],
    ['rate', value => { value.variation.outline.body.contours[0].rates[0] += .01; }],
    ['body source', value => { value.source.outline.parts[1].d += 'M0 0L1 1Z'; }],
    ['SVG target', value => { value.source.outline.svg = value.source.outline.svg.replace('microphone-body', 'other-body'); }],
    ['anatomy', value => { value.source.outline.parts[0].id = 'other-support'; }],
    ['source receipt', value => { value.source.outline.provenance.author.masterSha256 = '0'.repeat(64); }],
    ['domain', value => { value.variation.outline.domain.minimum = .7; }],
  ])('corrupt %s cannot acquire a prepared compiler target', (_, mutate) => {
    const payload = structuredClone(inputs.mic); mutate(payload);
    expect(() => projectAuthorCapsuleMotion(payload)).toThrow(TypeError);
  });

  it('packet corruption refuses before returning any sampler', () => {
    for (const mutate of [value => { value.prefix += 'M0 0'; }, value => { value.renderTarget.selector = 'path'; },
      value => { value.contours[0].rates[0] = NaN; }, value => { value.originalD += 'Z'; }]) {
      const packet = structuredClone(packets['mic-circle'].variants.filled.motion); mutate(packet);
      expect(() => createCompiledBodyWidthPreparation({ filled: packet })).toThrow(TypeError);
    }
  });

  it('PURE preparation/metadata roots retain only their real consumer representation', async () => {
    const sample = await consume('mic', 'prepareBodyWidth'), caps = await consume('mic', 'motionCapabilities');
    expect(Object.keys(sample.exports)).toEqual(['prepareBodyWidth']); expect(Object.keys(caps.exports)).toEqual(['motionCapabilities']);
    expect(sample.exports.prepareBodyWidth().prepared.sample(.9).ok).toBe(true);
    expect(caps.exports.motionCapabilities().capabilities.formats).toEqual(['svg', 'prepared-width']);
    expect(sample.text).not.toContain(inputs.mic.variation.outline.geometrySha256);
    expect(caps.text).not.toContain(inputs.mic.source.outline.parts[1].d);
    expect(caps.text).not.toContain('prepareCapsulePath');
    for (const consumer of [sample, caps]) {
      expect(consumer.retained.some(file => /src\/(?:core|motion|authoring)\//.test(file))).toBe(false);
      expect(consumer.text).not.toMatch(/createGlyphCompiler|glyphCapabilities|requestAnimationFrame|setInterval|node:fs/);
    }
  });

  it('shares exact capabilities and declares independent public runtime/type closure', () => {
    const value = packets.mic.variants.outline.capabilities;
    const caps = createCompiledBodyWidthCapabilities({ outline: value });
    expect(caps().capabilities).toBe(value);
    expect(value.geometrySha256).toBe(inputs.mic.variation.outline.geometrySha256);
    expect(authorCapsuleMotionModuleDeclaration(packets.mic)).toContain('prepareBodyWidth(variant?: MotionVariant): PrepareBodyWidthResult');
    const projection = symbolReleaseProjection(read('release/contract.json'), names, [], names, ['capsule.width'], [], [], [], [], names, names);
    expect(projection.runtimeDependencies).toContain('dist/ir/capsule-motion-runtime.js');
    expect(projection.runtimeDependencies).not.toContain('dist/ir/gesture-runtime.js');
    expect(projection.typeDependencies).toContain('dist/ir/author-capsule-motion-types.d.ts');
    for (const icon of names) expect(projection.files).toContain(`dist/gestures/${icon}.js`);
    expect(() => symbolReleaseProjection(read('release/contract.json'), names, [], [], [], [], [], [], [], names, ['other']))
      .toThrow(TypeError);
    for (const icon of names) expect(renderSymbolModules(inputs[icon]).symbol).not.toMatch(/capsule-motion|prepareBodyWidth/);
  });
});
