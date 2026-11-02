import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomyWithEvidence } from '../scripts/lib/author-anatomy.js';
import { materializeAuthorAnnulus, projectAuthorAnnulusRuntime } from '../scripts/lib/author-annulus.js';
import { authorStateLawNames, compileAuthorStateGroups, renderStateGroupModule } from '../scripts/lib/author-state-groups.js';
import { authorStateVariationGroupNames, compileAuthorStateVariations, renderStateVariationModule } from '../scripts/lib/author-state-variations.js';
import { createCompiledEnclosureVariation, createCompiledEnclosureVariationCapabilities } from '../src/states/annulus-runtime.js';
import { createCompiledAnnulusGlyph } from '../src/ir/author-annulus-runtime.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { assembleGlyphLayers, assembleGlyphFrame } from '../src/ir/svg-assembly.js';
import { renderSymbolModules, symbolExportName } from '../scripts/lib/symbol-modules.js';
import { symbolReleaseProjection, authorContentVariationIconNames } from '../scripts/lib/symbol-modules.js';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { authorVariationIconNames, authorVariationLawNames } from '../scripts/lib/author-variation.js';
import { expandReleaseExports, validateReleaseContract, validateReleaseRuntimeDependencyGraph } from '../scripts/lib/release-contract.js';
import { bundle } from '../scripts/build-ir.mjs';
import { measureArtifact } from '../scripts/check-package-size.js';
import { bundleScenario } from '../scripts/check-consumer-size.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const capturedStates = read('semantics/author-state-groups.json');
const states = { ...capturedStates, groups: Object.fromEntries(['status-circle', 'playback-circle']
  .map(name => [name, capturedStates.groups[name]])) };
const names = [...new Set(Object.values(states.groups).flatMap(group => Object.values(group.states).map(member => member.icon)))];
const manifest = read('semantics/figma-baseline.json'), originalAnatomy = read('semantics/author-anatomy.json');
const anatomy = { ...originalAnatomy, icons: Object.fromEntries(names.map(icon => [icon, originalAnatomy.icons[icon]])) };
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
const grid = read('semantics/grid.json');
const annotations = compileAuthorAnatomyWithEvidence(baseline, anatomy, grid);
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(names.map(icon => [icon, { model: null, source: Object.fromEntries(['outline', 'filled'].map(variant =>
    [variant, annotations.contracts[`${icon}/${variant}`] ?? baseline.icons[icon][variant].sourceContract])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => ['outline', 'filled'].map(variant =>
    [symbolExportName(icon, variant), baseline.icons[icon][variant].artifactSvg]))) });
const groups = compileAuthorStateGroups(baseline, states, { compiler, grid, assembleGlyphLayers, assembleGlyphFrame });
const compile = (input = annotations, source = baseline, spec = states, declared = anatomy, compiledGroups = groups, policy = grid) =>
  compileAuthorStateVariations(compiledGroups, source, spec, declared, input, policy);
const variations = compile();
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const rebind = (input, label) => {
  const proof = input.evidence[label]; delete proof.geometrySha256;
  proof.geometrySha256 = createHash('sha256').update(stableJSON(proof)).digest('hex');
  input.contracts[label].variation = projectAuthorAnnulusRuntime(proof);
};

async function emitted(entry) {
  const output = await build({ stdin: { contents: entry, resolveDir: root, loader: 'js' }, bundle: true,
    write: false, minify: true, treeShaking: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true, logLevel: 'silent',
    plugins: [{ name: 'state-annulus-public', setup(plugin) {
      plugin.onResolve({ filter: /^test-state-variation$/ }, () => ({ path: 'status-circle', namespace: 'variation', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'variation' }, args => ({ contents: renderStateVariationModule(variations[args.path]),
        resolveDir: root, loader: 'js' }));
      plugin.onResolve({ filter: /states\/status-circle\.js$/ }, () => ({ path: 'status-circle', namespace: 'state', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'state' }, args => ({ contents: renderStateGroupModule(groups[args.path]), resolveDir: root, loader: 'js' }));
      plugin.onResolve({ filter: /state-annulus-runtime\.js$/ }, () => ({ path: `${root}/src/states/annulus-runtime.ts` }));
      plugin.onResolve({ filter: /state-runtime\.js$/ }, () => ({ path: `${root}/src/states/runtime.ts` }));
    } }],
  });
  const code = output.outputFiles[0].text;
  return { code, inputs: Object.keys(output.metafile.inputs), api: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) };
}

describe('authored shared state enclosure: one geometry law and retained state presentation', () => {
  it('derives exactly two opt-in groups from the real author/state declarations', () => {
    expect(authorStateVariationGroupNames(capturedStates, originalAnatomy)).toEqual(['playback-circle', 'status-circle']);
    expect(Object.keys(variations)).toEqual(['playback-circle', 'status-circle']);
    expect(variations['status-circle'].capabilities.proof.members).toHaveLength(6);
    const unadmitted = structuredClone(anatomy); delete unadmitted.icons['plus-circle'].outline.variation;
    expect(authorStateVariationGroupNames(states, unadmitted)).toEqual(['playback-circle']);
    expect(Object.keys(compile(annotations, baseline, states, unadmitted))).toEqual(['playback-circle']);
    expect(() => authorStateVariationGroupNames(states, { ...anatomy, source: { ...anatomy.source, version: '1' } }))
      .toThrow(expect.objectContaining({ code: 'SOURCE_MISMATCH' }));
  });

  it.each(Object.keys(variations))('%s preserves the exact raw default enclosure for every genuine member', name => {
    const data = variations[name], patch = createCompiledEnclosureVariation(data.runtime), defaults = patch();
    expect(patch({})).toBe(defaults);
    expect(patch({ variation: {} })).toBe(defaults);
    expect(patch({ variation: { enclosureEmphasis: 1 } })).toBe(defaults);
    expect(defaults.patch).toEqual({ contract: 'labpics.symbol-geometry-patch/1', version: 1, group: name, variant: 'outline',
      partId: groups[name].enclosurePartId, attributes: { d: data.runtime.defaultD } });
    expect(Object.isFrozen(defaults.patch.attributes)).toBe(true);
    for (const member of data.capabilities.proof.members) {
      expect(defaults.patch.attributes.d).toBe(rawPaths(baseline.icons[member.icon].outline.rawSvg).at(-1));
      expect(member.sourceEnclosurePartId).toBe(annotations.evidence[`${member.icon}/outline`].enclosure.id);
    }
    const capability = createCompiledEnclosureVariationCapabilities(data.capabilities);
    expect(capability()).toBe(capability());
    expect(Object.isFrozen(capability().proof.members[0].author)).toBe(true);
    expect(capability().targets).toEqual({ svg: 'supported', webEffect: 'existing-state-transitions', lottie: 'not-exported', sfSymbols: 'not-exported' });
  });

  it.each(Object.keys(variations))('%s agrees with all admitted member materializers and never changes source/content/outer', name => {
    const data = variations[name], patch = createCompiledEnclosureVariation(data.runtime);
    const before = JSON.stringify(baseline);
    for (const emphasis of [0.9, 1.1, 1.5]) {
      const result = patch({ variation: { enclosureEmphasis: emphasis } });
      expect(result.ok).toBe(true);
      expect(result.patch.attributes.d.startsWith(data.runtime.enclosure.outerD)).toBe(true);
      expect(result.patch.attributes.d).not.toBe(data.runtime.defaultD);
      for (const member of data.capabilities.proof.members) {
        const proof = annotations.evidence[`${member.icon}/outline`];
        const expected = materializeAuthorAnnulus(proof, { enclosureEmphasis: emphasis });
        expect(result.patch.attributes.d).toBe(expected.parts.at(-1).d);
        expect(expected.parts.slice(0, -1).map(part => part.d)).toEqual(rawPaths(baseline.icons[member.icon].outline.rawSvg).slice(0, -1));
        const sourceGlyphs = authorSymbolPayload(member.icon, Object.fromEntries(['outline', 'filled'].map(variant =>
          [variant, { ...baseline.icons[member.icon][variant], sourceContract: annotations.contracts[`${member.icon}/${variant}`] ??
            baseline.icons[member.icon][variant].sourceContract }])), compiler).source;
        const glyph = createCompiledAnnulusGlyph(member.icon, sourceGlyphs, annotations.contracts[`${member.icon}/outline`].variation);
        expect(glyph({ variation: { enclosureEmphasis: emphasis } }).parts.at(-1).d).toBe(result.patch.attributes.d);
      }
    }
    expect(JSON.stringify(baseline)).toBe(before);
  });

  it.each(Object.keys(variations))('%s intersects real member domains and refuses a request accepted by a weaker member', name => {
    const data = variations[name], members = data.capabilities.proof.members;
    const minima = members.map(member => annotations.evidence[`${member.icon}/outline`].domain.scale.minimum);
    const maxima = members.map(member => annotations.evidence[`${member.icon}/outline`].domain.scale.maximum);
    expect(data.runtime.domain.scale.minimum).toBe(Math.max(...minima));
    expect(data.runtime.domain.scale.maximum).toBe(Math.min(...maxima));
    const weakest = members[minima.indexOf(Math.min(...minima))], weak = annotations.evidence[`${weakest.icon}/outline`];
    expect(weak.domain.scale.minimum).toBeLessThan(data.runtime.domain.scale.minimum);
    const scale = (weak.domain.scale.minimum + data.runtime.domain.scale.minimum) / 2;
    const e = weak.enclosure, emphasis = (e.outerRadius - scale * e.referenceInnerRadius) / e.referenceThickness;
    expect(() => materializeAuthorAnnulus(weak, { enclosureEmphasis: emphasis })).not.toThrow();
    expect(createCompiledEnclosureVariation(data.runtime)({ variation: { enclosureEmphasis: emphasis } }))
      .toMatchObject({ ok: false, reason: { code: 'VARIATION_OUTSIDE_DOMAIN' } });
  });

  it.each(Object.keys(variations))('%s agrees with all members at adjacent binary64 domain boundaries', name => {
    const data = variations[name], patch = createCompiledEnclosureVariation(data.runtime);
    const outcome = operation => { try { return { ok: true, value: operation() }; } catch (error) { return { ok: false, code: error.code }; } };
    const next = (value, direction) => {
      const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
      bytes.setBigUint64(0, bytes.getBigUint64(0) + BigInt(direction)); return bytes.getFloat64(0);
    };
    let accepted = 0, refused = 0;
    const e = data.runtime.enclosure;
    for (const bound of [data.runtime.domain.scale.minimum, data.runtime.domain.scale.maximum]) {
      const middle = (e.outerRadius - e.referenceInnerRadius * bound) / e.referenceThickness;
      for (const emphasis of [next(next(middle, -1), -1), next(middle, -1), middle, next(middle, 1), next(next(middle, 1), 1)]) {
        const expected = data.capabilities.proof.members.map(member => outcome(() => materializeAuthorAnnulus(
          annotations.evidence[`${member.icon}/outline`], { enclosureEmphasis: emphasis })));
        const actual = patch({ variation: { enclosureEmphasis: emphasis } });
        expect(actual.ok).toBe(expected.every(result => result.ok));
        if (actual.ok) {
          accepted++;
          expect(expected.every(result => result.value.parts.at(-1).d === actual.patch.attributes.d)).toBe(true);
        } else { refused++; expect(actual.reason.code).toBe('VARIATION_OUTSIDE_DOMAIN'); }
      }
    }
    expect(accepted).toBeGreaterThan(0); expect(refused).toBeGreaterThan(0);
  });

  it('release projection keeps static states separate and enforces the opt-in parent and helper closure', () => {
    const base = read('release/contract.json'), groupNames = Object.keys(states.groups);
    const plain = symbolReleaseProjection(base, names, groupNames, names, ['annulus.counter-scale']);
    expect(plain.exports).not.toHaveProperty('./state-variations/*');
    const expanded = symbolReleaseProjection(base, names, groupNames, names, ['annulus.counter-scale'], [], Object.keys(variations));
    expect(validateReleaseContract(expanded)).toEqual([]);
    const entries = expandReleaseExports(expanded);
    expect(entries['./state-variations/status-circle']).toEqual({ types: './dist/state-variations/status-circle.d.ts', import: './dist/state-variations/status-circle.js' });
    expect(expanded.runtimeDependencies.filter(file => file.endsWith('annulus-geometry-runtime.js'))).toHaveLength(1);
    expect(expanded.runtimeDependencies).toContain('dist/ir/state-annulus-runtime.js');
    expect(expanded.typeDependencies).toContain('dist/ir/state-annulus-types.d.ts');
    expect(() => symbolReleaseProjection(base, names, groupNames, [], [], [], ['foreign'])).toThrow(TypeError);
    expect(() => symbolReleaseProjection(base, names, groupNames, [], [], [], ['status-circle', 'status-circle'])).toThrow(TypeError);
    const ghost = structuredClone(expanded);
    ghost.files = ghost.files.filter(file => file !== 'dist/states/status-circle.js' && file !== 'dist/states/status-circle.d.ts');
    expect(validateReleaseContract(ghost).join('\n')).toContain('state variation не имеет source state group');
    const empty = structuredClone(plain); empty.exports['./state-variations/*'] = expanded.exports['./state-variations/*'];
    expect(validateReleaseContract(empty).join('\n')).toContain('state-variations wildcard не имеет точных proven group outputs');
  });

  it('one real packet output and proven state variations reproduce the complete release projection without catalog compilation', async () => {
    const packet = Object.values(await authoredSymbolPayloads(['notifications'])).map(renderSymbolModules);
    expect(packet[0].symbol).toContain('../ir/source-packet-runtime.js');
    const captured = read('release/contract.json');
    const projected = symbolReleaseProjection(captured, Object.keys(manifest.icons), Object.keys(capturedStates.groups),
      authorVariationIconNames(originalAnatomy), authorVariationLawNames(originalAnatomy), packet,
      authorStateVariationGroupNames(capturedStates, originalAnatomy), authorContentVariationIconNames(originalAnatomy), authorStateLawNames(capturedStates));
    expect(projected).toEqual(captured);
    expect(projected.runtimeDependencies.filter(file => file.endsWith('source-packet-runtime.js'))).toHaveLength(1);
    expect(projected.runtimeDependencies.filter(file => file.endsWith('annulus-geometry-runtime.js'))).toHaveLength(1);
    const pkg = read('package.json');
    expect(pkg.files).toEqual(projected.files); expect(pkg.exports).toEqual(projected.exports);
  });

  it.each([null, [], 1, { weight: 1.1 }, { variant: 'other' }, { variation: null }, { variation: [] },
    { variation: { weight: 1.1 } }, { variation: { enclosureEmphasis: 0 } }, { variation: { enclosureEmphasis: Infinity } },
    { variation: { enclosureEmphasis: NaN } }, { variation: { enclosureEmphasis: '1' } }].map(request => [request]))('strict public refusal precedes output for %j', request => {
    expect(createCompiledEnclosureVariation(variations['status-circle'].runtime)(request))
      .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });

  it('refuses Filled even at default and reports collapse separately from group clearance', () => {
    const patch = createCompiledEnclosureVariation(variations['status-circle'].runtime);
    expect(patch({ variant: 'filled' })).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
    expect(patch({ variation: { enclosureEmphasis: 100 } })).toMatchObject({ ok: false, reason: { code: 'POSE_UNREPRESENTABLE' } });
    expect(patch({ variation: { enclosureEmphasis: 2.6 } })).toMatchObject({ ok: false, reason: { code: 'VARIATION_OUTSIDE_DOMAIN' } });
  });

  it.each([
    ['missing evidence', input => { delete input.evidence['plus-circle/outline']; }, 'ANNULUS_SOURCE_MISMATCH'],
    ['unbound geometry digest', input => { input.evidence['plus-circle/outline'].enclosure.referenceThickness *= 2; }, 'ANNULUS_SOURCE_MISMATCH'],
    ['wrong source receipts', input => { input.evidence['plus-circle/outline'].source.masterSha256 = '0'.repeat(64); }, 'ANNULUS_SOURCE_MISMATCH'],
    ['wrong grid', input => { input.evidence['plus-circle/outline'].domain.policy.gridSha256 = '0'.repeat(64); rebind(input, 'plus-circle/outline'); }, 'POLICY_MISMATCH'],
    ['different operands', input => { input.evidence['plus-circle/outline'].enclosure.referenceThickness *= 2; rebind(input, 'plus-circle/outline'); }, 'GROUP_GEOMETRY_MISMATCH'],
  ])('%s gets a build refusal despite a matching silhouette', (_, mutate, code) => {
    const input = structuredClone(annotations); mutate(input);
    expect(() => compile(input)).toThrow(expect.objectContaining({ code }));
  });

  it('rejects a changed compiled group before assigning an authored part ID to it', () => {
    const input = structuredClone(groups); input['status-circle'].enclosurePartId = 'other';
    expect(() => compile(annotations, baseline, states, anatomy, input)).toThrow(expect.objectContaining({ code: 'GROUP_SOURCE_MISMATCH' }));
  });

  it('real bundled opt-in consumer reuses state function identity and leaves motion independent of patches', async () => {
    const actual = await emitted("export * from 'test-state-variation'; export { renderStateSvg as sourceMount, compileStateEffect as sourceEffect } from '../states/status-circle.js';");
    const api = actual.api;
    expect(api.renderStateSvg).toBe(api.sourceMount); expect(api.compileStateEffect).toBe(api.sourceEffect);
    const before = api.compileStateEffect('dismissal', { duration: 200 });
    api.renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } });
    expect(api.compileStateEffect('dismissal', { duration: 200 })).toEqual(before);
    expect(before.effect.stages.every(stage => stage.property === 'opacity' && !Object.hasOwn(stage, 'from'))).toBe(true);
    expect(before.effect.unchangedPartIds).toContain(api.enclosureVariationCapabilities().partId);
    expect(api.compileStateEffect('attention', { duration: 200, reducedMotion: true }).effect.stages.every(stage => stage.duration === 0)).toBe(true);
    expect(api.exportStateTransition('attention', { duration: 200, format: 'lottie' })).toMatchObject({ ok: false, reason: { code: 'FORMAT_UNSUPPORTED' } });
  });

  it('plain state consumer excludes countershape runtime while patch-only consumer excludes content/author metadata', async () => {
    const state = await emitted("export { renderStateSvg } from '../states/status-circle.js';");
    expect(state.inputs.some(path => /annulus-(?:runtime|geometry-runtime)/.test(path))).toBe(false);
    const patch = await emitted("export { renderEnclosurePatch } from 'test-state-variation';");
    expect(patch.code).not.toContain('LuaiBd4anRi4DMZayKAnY2');
    expect(patch.code).not.toContain('state-confirmation');
    expect(patch.code).not.toContain('geometrySha256');
    expect(patch.code).not.toContain('sha256:');
    expect(patch.code).not.toContain('source-only');
    expect(patch.api.renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } }).ok).toBe(true);
  });

  it('native emitted ESM preserves real shared imports, public export surface and the previous annulus inclusion guard', async () => {
    const consumer = mkdtempSync(join(root, '.state-annulus-native-'));
    try {
      const pkg = join(consumer, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
      for (const dir of ['ir', 'states', 'state-variations']) mkdirSync(join(out, dir), { recursive: true });
      mkdirSync(join(consumer, 'measurement'));
      await Promise.all([
        bundle(root, out, 'src/states/runtime.ts', 'ir/state-runtime.js'),
        bundle(root, out, 'src/states/annulus-runtime.ts', 'ir/state-annulus-runtime.js', ['../ir/annulus-geometry-runtime.js']),
        bundle(root, out, 'src/ir/annulus-geometry-runtime.ts', 'ir/annulus-geometry-runtime.js'),
        bundle(root, consumer, 'src/ir/author-annulus-runtime.ts', 'measurement/annulus-runtime.js',
          ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js']),
      ]);
      const exports = {}, files = [];
      for (const name of Object.keys(variations)) {
        writeFileSync(join(out, `states/${name}.js`), renderStateGroupModule(groups[name]));
        writeFileSync(join(out, `state-variations/${name}.js`), renderStateVariationModule(variations[name]));
        for (const directory of ['states', 'state-variations']) {
          const file = `dist/${directory}/${name}.js`; files.push(file);
          exports[`./${directory}/${name}`] = { import: `./${file}` };
        }
      }
      const runtimeDependencies = ['dist/ir/annulus-geometry-runtime.js', 'dist/ir/state-annulus-runtime.js', 'dist/ir/state-runtime.js'];
      const contract = { packageName: '@labpics/icons', exports, files: [...files, ...runtimeDependencies], runtimeDependencies };
      const readText = file => readFileSync(join(pkg, file), 'utf8');
      expect(validateReleaseRuntimeDependencyGraph({ contract, readText })).toEqual([]);
      expect(validateReleaseRuntimeDependencyGraph({ contract: { ...contract, runtimeDependencies: [...runtimeDependencies, 'dist/ir/unused.js'] }, readText }).join('\n'))
        .toContain('runtimeDependencies не равен import closure');
      expect(measureArtifact(readFileSync(join(consumer, 'measurement/annulus-runtime.js'))).modules)
        .toEqual(['src/ir/author-annulus-runtime.ts', 'src/ir/sha256.ts', 'src/ir/svg-assembly.ts']);
      expect(measureArtifact(readFileSync(join(out, 'ir/annulus-geometry-runtime.js'))).modules).toEqual(['src/ir/annulus-geometry-runtime.ts']);
      expect(measureArtifact(readFileSync(join(out, 'ir/state-annulus-runtime.js'))).modules).toEqual(['src/states/annulus-runtime.ts']);
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports }));
      const consumerPolicy = read('release/consumer-size-ratchet.json').scenarios;
      const budgetFailures = [];
      for (const name of ['status-circle-state-variation', 'playback-circle-state-variation',
        'status-circle-enclosure-patch', 'playback-circle-enclosure-patch']) {
        const policy = consumerPolicy[name];
        const measured = await bundleScenario(policy.entry, { root: pkg });
        if (measured.bytes > policy.maxBytes || measured.gzipBytes > policy.maxGzipBytes) {
          budgetFailures.push(`${name}: ${measured.bytes}/${measured.gzipBytes}, limit ${policy.maxBytes}/${policy.maxGzipBytes}`);
        }
      }
      expect(budgetFailures).toEqual([]);
      writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      writeFileSync(join(consumer, 'consumer.mjs'), [
        "import assert from 'node:assert/strict';",
        `const names=${JSON.stringify(Object.keys(variations))};const results={};`,
        "for(const name of names){const api=await import('@labpics/icons/state-variations/'+name);const source=await import('@labpics/icons/states/'+name);",
        "for(const key of ['render','renderStateSvg','compileStateEffect','exportStateTransition','stateCapabilities'])assert.equal(api[key],source[key]);",
        "const initial=api.renderEnclosurePatch();assert.equal(initial,api.renderEnclosurePatch({variation:{enclosureEmphasis:1}}));",
        "assert(Object.isFrozen(initial.patch.attributes));assert.equal(api.renderEnclosurePatch({variation:{enclosureEmphasis:1.1}}).ok,true);",
        "assert.equal(api.renderEnclosurePatch({variant:'filled'}).reason.code,'VARIANT_UNSUPPORTED');",
        "results[name]=Object.keys(api).sort();}",
        'console.log(JSON.stringify(results));',
      ].join('\n'));
      const actual = JSON.parse(execFileSync(process.execPath, ['consumer.mjs'], { cwd: consumer, encoding: 'utf8', stdio: 'pipe', windowsHide: true }));
      const surface = read('release/export-surface.json');
      for (const [name, keys] of Object.entries(actual)) {
        expect(keys).toEqual(['compileStateEffect', 'enclosureVariationCapabilities', 'exportStateTransition', 'render', 'renderEnclosurePatch', 'renderStateSvg', 'stateCapabilities']);
        expect(keys).toEqual(surface[`./state-variations/${name}`]);
      }
    } finally {
      if (!resolve(consumer).startsWith(resolve(root) + '\\') && !resolve(consumer).startsWith(resolve(root) + '/')) throw new Error('cleanup вне owned worktree');
      rmSync(consumer, { recursive: true, force: true });
    }
  });
});
