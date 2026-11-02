import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { bundle } from '../scripts/build-ir.mjs';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { authorVariationIconNames, authorVariationLawNames } from '../scripts/lib/author-variation.js';
import { authorContentVariationIconNames, contentVariationModuleDeclaration, renderSymbolModules, symbolModuleDeclaration, variationModuleDeclaration,
  symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { expandReleaseExports, validateReleaseContract } from '../scripts/lib/release-contract.js';

const root = fileURLToPath(new URL('..', import.meta.url)), anchor = '749706af0aa6b4d371cd5842fe616c2d55f7c4e8';
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const names = ['alert-circle', 'checkmark-circle', 'close-circle', 'minus-circle', 'pause-circle', 'play-circle', 'plus-circle', 'question-circle'];
const dots = ['ellipsis-horizontal', 'ellipsis-vertical'], inputs = await authoredSymbolPayloads([...names, ...dots]);
const anatomy = read('semantics/author-anatomy.json');
const fixture = mkdtempSync(join(root, '.content-optin-native-')), pkg = join(fixture, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
for (const directory of ['ir/symbol-data', 'symbols', 'variations', 'content-variations']) mkdirSync(join(out, directory), { recursive: true });

// Разрешаются только верхнеуровневые imports, generated строки остаются exact.
const previous = execFileSync('git', ['show', `${anchor}:scripts/lib/symbol-modules.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
const transport = previous.replace(/^import .* from '([^']+)';$/gm, (declaration, specifier) =>
  declaration.replace(specifier, pathToFileURL(join(root, 'scripts/lib', specifier)).href));
const old = await import(`data:text/javascript;base64,${Buffer.from(transport).toString('base64')}`);
const snapshots = Object.fromEntries([...names, ...dots].map(name => [name, renderSymbolModules(inputs[name])]));
const targets = [
  ['src/ir/request.ts', 'ir/request.js', []],
  ['src/ir/author-request-runtime.ts', 'ir/author-request-runtime.js', ['./request.js']],
  ['src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js', './author-request-runtime.js']],
  ['src/ir/author-annulus-runtime.ts', 'ir/annulus-runtime.js', ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js']],
  ['src/ir/author-content-runtime.ts', 'ir/content-runtime.js', ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './content-geometry-runtime.js']],
  ['src/ir/content-geometry-runtime.ts', 'ir/content-geometry-runtime.js', ['./annulus-geometry-runtime.js']],
  ['src/ir/annulus-geometry-runtime.ts', 'ir/annulus-geometry-runtime.js', []],
];
try {
  const compiled = await Promise.allSettled(targets.map(([entry, target, external]) => bundle(root, out, entry, target, external)));
  const failed = compiled.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  for (const name of names) {
    const modules = snapshots[name];
    writeFileSync(join(out, 'ir/symbol-data', `${name}.js`), modules.data);
    writeFileSync(join(out, 'symbols', `${name}.js`), modules.symbol);
    writeFileSync(join(out, 'variations', `${name}.js`), modules.variation);
    writeFileSync(join(out, 'content-variations', `${name}.js`), modules.contentVariation);
    writeFileSync(join(out, 'content-variations', `${name}.d.ts`), contentVariationModuleDeclaration(name));
  }
  const exports = expandReleaseExports(read('release/contract.json'));
  for (const name of names) {
    if (!exports[`./content-variations/${name}`]) throw new Error(`Отсутствует публичная release проекция ${name}`);
  }
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', sideEffects: false,
    exports: Object.fromEntries(names.flatMap(name => ['symbols', 'variations', 'content-variations'].map(directory =>
      [`./${directory}/${name}`, exports[`./${directory}/${name}`]]))) }));
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
} catch (error) {
  rmSync(fixture, { recursive: true, force: true }); throw error;
}
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const native = async name => {
  const consumer = join(fixture, `consumer-${name}.mjs`);
  writeFileSync(consumer, `export * as source from '@labpics/icons/symbols/${name}';\nexport * as ring from '@labpics/icons/variations/${name}';\nexport * as content from '@labpics/icons/content-variations/${name}';\n`);
  return import(pathToFileURL(consumer).href);
};
const sha = value => createHash('sha256').update(value).digest('hex');

describe('content opt-in owns its payload without charging existing imports', () => {
  it('removing all optional content laws keeps the public type dependency closure', () => {
    const projection = symbolReleaseProjection(read('release/contract.json'), names, [], names, ['annulus.counter-scale'], [], [], []);
    const glyphTypes = readFileSync(join(root, 'src/ir/glyph-types.ts'), 'utf8');
    expect(glyphTypes).toContain("from './author-content-types.js'");
    expect(projection.files).toContain('dist/ir/glyph-types.d.ts');
    expect(projection.files).toContain('dist/ir/author-content-types.d.ts');
    expect(projection.runtimeDependencies).not.toContain('dist/ir/content-runtime.js');
    expect(projection.runtimeDependencies).not.toContain('dist/ir/content-geometry-runtime.js');
    expect(Object.keys(projection.exports).some(key => key.startsWith('./content-variations/'))).toBe(false);
  });
  it('declares exactly the truthful eight participants and adds only explicit release entries', () => {
    expect(authorContentVariationIconNames(anatomy)).toEqual(names);
    const base = read('release/contract.json');
    const oldProjection = symbolReleaseProjection(base, [...names, ...dots], [], authorVariationIconNames(anatomy), authorVariationLawNames(anatomy));
    const projection = symbolReleaseProjection(base, [...names, ...dots], [], authorVariationIconNames(anatomy), authorVariationLawNames(anatomy), [], [], names);
    expect(validateReleaseContract(projection)).toEqual([]);
    expect(Object.keys(expandReleaseExports(projection)).filter(name => name.startsWith('./content-variations/')))
      .toEqual(names.map(name => `./content-variations/${name}`));
    for (const [key, value] of Object.entries(oldProjection.exports)) expect(projection.exports[key]).toEqual(value);
    for (const dependency of oldProjection.runtimeDependencies) expect(projection.runtimeDependencies).toContain(dependency);
    expect(projection.runtimeDependencies.filter(file => !oldProjection.runtimeDependencies.includes(file)))
      .toEqual(['dist/ir/content-geometry-runtime.js', 'dist/ir/content-runtime.js']);
    expect(() => symbolReleaseProjection(base, names, [], names, ['annulus.counter-scale'], [], [], ['foreign']))
      .toThrow(TypeError);
    expect(() => symbolReleaseProjection(base, names, [], names, ['annulus.counter-scale'], [], [], ['plus-circle', 'plus-circle']))
      .toThrow(TypeError);
  });

  it.each([...names, ...dots])('%s preserves old generator bytes, declaration bytes and capabilities exactly', name => {
    const input = inputs[name], output = snapshots[name], baseline = old.renderSymbolModules(input);
    for (const field of ['symbol', 'data', 'variation']) {
      expect(output[field], field).toBe(baseline[field]);
      if (output[field]) expect(sha(output[field]), field).toBe(sha(baseline[field]));
      expect(output[field]).not.toMatch(/contentScale|content-runtime|content-geometry/);
    }
    expect(symbolModuleDeclaration(name)).toBe(old.symbolModuleDeclaration(name));
    expect(variationModuleDeclaration(name, input.variation.outline.law)).toBe(old.variationModuleDeclaration(name, input.variation.outline.law));
    expect(input.capabilities.outline.variation.law).toBe(input.variation.outline.law);
    expect(input.capabilities.outline.variation.defaults).not.toHaveProperty('contentScale');
    if (names.includes(name)) {
      expect(input.capabilities.filled).not.toHaveProperty('variation');
      expect(output.contentVariation).toContain('content-runtime.js');
    }
    else expect(output).not.toHaveProperty('contentVariation');
  });

  it('the emitter refuses content packets without the same admitted Outline master', () => {
    const input = inputs['plus-circle'];
    expect(() => renderSymbolModules({ ...input, variation: undefined })).toThrow(TypeError);
    expect(() => renderSymbolModules({ ...input, contentVariation: { ...input.contentVariation, filled: input.contentVariation.outline } }))
      .toThrow(TypeError);
    const drift = structuredClone(input); drift.contentVariation.outline.source.masterSha256 = '0'.repeat(64);
    expect(() => renderSymbolModules(drift)).toThrow(TypeError);
  });

  it.each(names)('%s runs the new public entry with exact defaults and independent Filled refusals', async name => {
    const { source, ring, content } = await native(name);
    expect(Object.keys(content).sort()).toEqual(read('release/export-surface.json')[`./content-variations/${name}`]);
    expect(content.outline).toBe(source.outline); expect(content.filled).toBe(source.filled);
    expect(content.glyph()).toBe(source.glyph());
    expect(content.glyph({ variation: { contentScale: 1, enclosureEmphasis: 1 } })).toBe(source.glyph());
    expect(content.glyph({ variant: 'filled' })).toBe(source.glyph({ variant: 'filled' }));
    expect(content.glyphCapabilities('filled')).toBe(source.glyphCapabilities('filled'));
    expect(content.glyphCapabilities('filled')).not.toHaveProperty('variation');
    expect(ring.glyphCapabilities().variation.law).toBe('annulus.counter-scale');
    expect(ring.glyphCapabilities().variation.defaults).not.toHaveProperty('contentScale');
    const capabilities = content.glyphCapabilities();
    expect(capabilities.variation).toMatchObject({ law: 'annulus.content-counter-scale', defaults: { contentScale: 1, enclosureEmphasis: 1 } });
    expect(capabilities.supportedAxes).toEqual([]); expect(capabilities.modelState).toBeNull();
    for (const variation of [{}, { contentScale: 1 }, { contentScale: 0.9, enclosureEmphasis: 1.1 }]) {
      expect(() => content.glyph({ variant: 'filled', variation })).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    }
    expect(() => source.glyph({ variation: { contentScale: 0.9 } })).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    expect(() => ring.glyph({ variation: { contentScale: 0.9 } })).toThrow(expect.objectContaining({ code: 'INVALID_VARIATION' }));
    const changed = content.glyph({ variation: { contentScale: 0.9, enclosureEmphasis: 1.1 } }), original = source.glyph();
    expect(changed.parts.map(part => part.id)).toEqual(original.parts.map(part => part.id));
    for (let index = 0; index < changed.parts.length - 1; index++) expect(changed.parts[index].d).not.toBe(original.parts[index].d);
    expect(changed.parts.at(-1).d).not.toBe(original.parts.at(-1).d);
  });

  it('two individually admitted public requests refuse their unsafe joint clearance', async () => {
    const { content } = await native('plus-circle'), original = content.glyph();
    const contentRequest = { variation: { contentScale: 1.3 } };
    const ringRequest = { variation: { enclosureEmphasis: 2.2 } };
    const jointRequest = { variation: { contentScale: 1.3, enclosureEmphasis: 2.2 } };
    const contentOnly = content.glyph(contentRequest), ringOnly = content.glyph(ringRequest);
    expect(contentOnly.provenance.variation.parameters).toEqual({ contentScale: 1.3, enclosureEmphasis: 1 });
    expect(ringOnly.provenance.variation.parameters).toEqual({ contentScale: 1, enclosureEmphasis: 2.2 });
    expect(contentOnly.parts.at(-1)).toBe(original.parts.at(-1));
    expect(contentOnly.parts[0].d).not.toBe(original.parts[0].d);
    expect(ringOnly.parts[0]).toBe(original.parts[0]);
    expect(ringOnly.parts.at(-1).d).not.toBe(original.parts.at(-1).d);
    const domain = content.glyphCapabilities().variation.domain, enclosureScale = ringOnly.provenance.variation.scale;
    const contentClearance = 1 - 1.3 * domain.clearance.contentScale;
    const ringClearance = enclosureScale - domain.clearance.contentScale;
    const jointClearance = enclosureScale - 1.3 * domain.clearance.contentScale;
    expect(contentClearance).toBeGreaterThanOrEqual(domain.clearance.minimum);
    expect(ringClearance).toBeGreaterThanOrEqual(domain.clearance.minimum);
    expect(jointClearance).toBeLessThan(domain.clearance.minimum);
    let refusal;
    try { content.glyph(jointRequest); } catch (error) { refusal = error; }
    expect(refusal).toEqual(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
    process.stdout.write(JSON.stringify({ entry: '@labpics/icons/content-variations/plus-circle',
      content: { request: contentRequest, accepted: true, clearance: contentClearance },
      enclosure: { request: ringRequest, accepted: true, enclosureScale, clearance: ringClearance },
      joint: { request: jointRequest, accepted: false, code: refusal.code, clearance: jointClearance },
      boundary: { rate: domain.clearance.contentScale, minimum: domain.clearance.minimum,
        comparison: domain.clearance.comparison } }) + '\n');
  });

  it('a static import from either entry removes all content operands and runtime code', async () => {
    const compile = async directory => {
      const compiled = await build({ absWorkingDir: fixture, stdin: { contents: `import { outline } from '@labpics/icons/${directory}/question-circle'; console.log(outline);`, resolveDir: fixture },
        bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', treeShaking: true, minify: true, metafile: true, logLevel: 'silent' });
      return { text: compiled.outputFiles[0].text, retained: Object.entries(Object.values(compiled.metafile.outputs)[0].inputs)
        .filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file) };
    };
    const [source, content] = await Promise.all([compile('symbols'), compile('content-variations')]);
    expect(content.text).toBe(source.text);
    expect(content.retained).not.toEqual(expect.arrayContaining([expect.stringMatching(/content-(?:geometry-)?runtime/)]));
    expect(content.text).not.toMatch(/contentScale|geometrySha256|VARIATION_OUTSIDE_DOMAIN/);
  });
});
