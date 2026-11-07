import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { compileAuthorStateGroups, renderStateGroupModule } from '../scripts/lib/author-state-groups.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { statePackageExpectations, stateArtifactConsumerSource, verifyInstalledStateGroup } from '../scripts/lib/state-artifact-consumer.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledContourStateRenderer, createCompiledContourStateEffects, createCompiledContourStateCapabilities } from '../src/ir/contour-runtime.js';
import { prepareContourStateEffect } from '../src/motion/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const names = ['ellipsis-horizontal', 'ellipsis-vertical'], variants = ['outline', 'filled'];
const manifest = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 }, icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
const anatomy = read('semantics/author-anatomy.json');
const contracts = compileAuthorAnatomy(baseline, { ...anatomy, icons: Object.fromEntries(names.map(icon => [icon, anatomy.icons[icon]])) }, grid);
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(names.map(icon => [icon, { model: null,
    source: Object.fromEntries(variants.map(variant => [variant, contracts[`${icon}/${variant}`]])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => variants.map(variant => [symbolExportName(icon, variant), baseline.icons[icon][variant].artifactSvg]))),
});
const fullSpec = read('semantics/author-state-groups.json');
const spec = { ...fullSpec, groups: Object.fromEntries(Object.entries(fullSpec.groups).filter(([, group]) => group.law === 'dots.orient')) };
// Независимое ожидание закрепляется раньше компиляции; producer payload в него не передаётся.
const expected = statePackageExpectations(baseline, spec, grid);
const payloads = compileAuthorStateGroups(baseline, spec, { compiler, grid });
function groupFor(name) {
  const payload = payloads[name], states = payload.states.map(state => state.id);
  const render = createCompiledContourStateRenderer({ variant: payload.variant, defaultState: payload.defaultState, states, staticSvg: payload.staticSvg });
  return { render, renderStateSvg: render, ...createCompiledContourStateEffects({ variant: payload.variant, group: payload.group, defaultState: payload.defaultState,
    states, targets: payload.targets, geometrySha256: payload.proof.geometrySha256 }),
  stateCapabilities: createCompiledContourStateCapabilities({ group: payload.group, variant: payload.variant, defaultState: payload.defaultState,
    transition: 'contour-interpolation', morph: 'topology-proven', partIds: payload.targets.map(target => target.partId), states: payload.states,
    formats: { static: ['svg'], transition: ['web-effect'] }, variation: 'exact-default-only', proof: payload.proof }) };
}

describe('contour installed artifact: настоящий public consumer и различающий oracle', () => {
  it.each(Object.keys(spec.groups))('%s выполняет исходные endpoints, JSON sampler, reverse и отказы', name => {
    expect(() => verifyInstalledStateGroup(groupFor(name), expected[name], prepareContourStateEffect)).not.toThrow();
    expect(expected[name].law).toBe('dots.orient');
    expect(expected[name].targets.map(target => target.endpoints)).toEqual(spec.groups[name].partIds.map((_, index) =>
      ['horizontal', 'vertical'].map(state => [...baseline.icons[`ellipsis-${state}`][expected[name].variant].rawSvg.matchAll(/\bd="([^"]+)"/g)][index][1])));
  });
  it('исходные ожидания не зависят от producer payload; каждый опасный мутант обнаруживается', () => {
    const name = 'ellipsis-orientation-filled', group = groupFor(name), receipt = expected[name];
    const mutations = [
      { ...group, stateCapabilities: () => ({ ...group.stateCapabilities(), morph: 'unavailable' }) },
      { ...group, stateCapabilities: () => ({ ...group.stateCapabilities(), formats: { static: ['svg'], transition: ['lottie'] } }) },
      { ...group, stateCapabilities: () => ({ ...group.stateCapabilities(), proof: { ...group.stateCapabilities().proof, geometrySha256: '0'.repeat(64) } }) },
      { ...group, stateCapabilities: () => ({ ...group.stateCapabilities(), proof: { ...group.stateCapabilities().proof, separation: [] } }) },
      { ...group, render: state => { const result = group.render(state); return { ...result, svg: result.svg.replace(/\bd="M[^ ]+/, 'd="M0') }; } },
      { ...group, compileStateEffect: (state, request) => { const result = structuredClone(group.compileStateEffect(state, request)); if (result.ok) result.effect.targets[0].vectors[0][2] += 0.1; return result; } },
      { ...group, compileStateEffect: (state, request) => { const { variation, ...remaining } = request; return group.compileStateEffect(state, remaining); } },
    ];
    for (const mutant of mutations) expect(() => verifyInstalledStateGroup(mutant, receipt, prepareContourStateEffect)).toThrow('state artifact: contour');
    const endpointOnly = effect => { const prepared = prepareContourStateEffect(effect); return prepared.ok ? { ok: true,
      sample: p => prepared.sample(p === 0 || p === 1 ? p : 0) } : prepared; };
    expect(() => verifyInstalledStateGroup(group, receipt, endpointOnly)).toThrow('forward/reverse numeric family pose');
    const malformedFrame = effect => { const prepared = prepareContourStateEffect(effect); return prepared.ok ? { ok: true,
      sample: p => { const pose = prepared.sample(p); return p === 0 || p === 1 || !pose.ok ? pose : { ...pose,
        parts: pose.parts.map(part => ({ ...part, d: part.d + 'junk' })) }; } } : prepared; };
    expect(() => verifyInstalledStateGroup(group, receipt, malformedFrame)).toThrow('forward/reverse numeric family pose');
    expect(() => verifyInstalledStateGroup(group, receipt)).toThrow('public sampler missing');
    expect(() => statePackageExpectations(baseline, spec)).toThrow('требует политику сетки');
  });
  it('generated source исполняется отдельным Node процессом через public exports', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-icons-contour-artifact-'));
    try {
      const pkg = join(directory, 'node_modules/@labpics/icons'), dist = join(pkg, 'dist');
      for (const part of ['ir', 'motion', 'states']) mkdirSync(join(dist, part), { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: read('package.json').exports }));
      await build({ entryPoints: [join(root, 'src/ir/contour-runtime.ts')], outfile: join(dist, 'ir/contour-runtime.js'), bundle: true,
        format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
      await build({ entryPoints: [join(root, 'src/motion/index.ts')], outfile: join(dist, 'motion/index.js'), bundle: true,
        external: ['../ir/contour-runtime.js'], format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
      for (const [name, payload] of Object.entries(payloads)) writeFileSync(join(dist, 'states', `${name}.js`), renderStateGroupModule(payload));
      writeFileSync(join(directory, 'state-expected.json'), JSON.stringify(expected));
      const consumer = join(directory, 'consumer.mjs');
      writeFileSync(consumer, `import { readFileSync } from 'node:fs';\n${stateArtifactConsumerSource()}\nconsole.log('contour artifact consumer PASS');\n`);
      const result = spawnSync(process.execPath, [consumer], { cwd: directory, encoding: 'utf8' });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('contour artifact consumer PASS');
      // Исполненный consumer ловит подмену source ожидания, а не только helper-тесты.
      const corrupt = structuredClone(expected); corrupt['ellipsis-orientation-filled'].states[0].paths[0].d += ' ';
      writeFileSync(join(directory, 'state-expected.json'), JSON.stringify(corrupt));
      const rejected = spawnSync(process.execPath, [consumer], { cwd: directory, encoding: 'utf8' });
      expect(rejected.status).not.toBe(0); expect(rejected.stderr).toContain('state artifact: contour');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
