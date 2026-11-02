import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { compileAuthorVariation } from '../scripts/lib/author-variation.js';
import { compileAuthorStateGroups, renderStateGroupModule, stateGroupDeclaration } from '../scripts/lib/author-state-groups.js';
import { symbolExportName, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { stateTypeConsumerSource } from '../scripts/check-package-artifact.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledContourStateRenderer, createCompiledContourStateEffects } from '../src/ir/contour-runtime.js';
import { compileSymbolEffect, prepareContourStateEffect } from '../src/motion/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const names = ['ellipsis-horizontal', 'ellipsis-vertical'];
const variants = ['outline', 'filled'];
const manifest = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: 2, variants: 4 }, icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])) } });
const anatomy = read('semantics/author-anatomy.json');
const contracts = compileAuthorAnatomy(baseline, { ...anatomy, icons: Object.fromEntries(names.map(name => [name, anatomy.icons[name]])) }, grid);
const compiler = createGlyphCompiler({
  catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(names.map(icon => [icon, { model: null,
      source: Object.fromEntries(variants.map(variant => [variant, contracts[`${icon}/${variant}`]])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => variants.map(variant => [symbolExportName(icon, variant), baseline.icons[icon][variant].artifactSvg]))),
});
const allGroups = read('semantics/author-state-groups.json');
const document = { ...allGroups, groups: Object.fromEntries(Object.entries(allGroups.groups).filter(([, group]) => group.law === 'dots.orient')) };
const compile = (source = baseline, spec = document, owner = compiler, policy = grid) => compileAuthorStateGroups(source, spec, { compiler: owner, grid: policy });
const payloads = compile();
const groupName = variant => `ellipsis-orientation-${variant}`;
function runtime(payload) {
  const states = payload.states.map(state => state.id);
  return { render: createCompiledContourStateRenderer({ variant: payload.variant, defaultState: payload.defaultState, states, staticSvg: payload.staticSvg }),
    ...createCompiledContourStateEffects({ group: payload.group, variant: payload.variant, defaultState: payload.defaultState, states,
      targets: payload.targets, geometrySha256: payload.proof.geometrySha256 }) };
}
const rawPaths = svg => [...svg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
// Этот oracle читает фиксированные raw numeric tokens; production scanner не используется.
const operands = d => [...d.matchAll(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g)].map(match => Number(match[0]));
const compareFractions = (a, b) => BigInt(a.numerator) * BigInt(b.denominator) >= BigInt(b.numerator) * BigInt(a.denominator);
const sha = text => createHash('sha256').update(text).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

// Test-built pinned snapshot достигает именно численной границы. Авторский manifest не меняется.
function witness(variant, change) {
  const source = structuredClone(baseline), spec = structuredClone(document), glyphs = {};
  for (const state of ['horizontal', 'vertical']) {
    const icon = `ellipsis-${state}`, member = source.icons[icon][variant], glyph = structuredClone(compiler.glyph({ icon, variant, modelMode: 'source-only' }));
    const paths = rawPaths(member.rawSvg), changed = paths.map((d, index) => change(d, state, index));
    const replace = svg => { let index = 0; return svg.replace(/\bd="[^"]+"/g, () => `d="${changed[index++]}"`); };
    member.rawSvg = replace(member.rawSvg); member.artifactSvg = replace(member.artifactSvg);
    member.author.masterSha256 = spec.groups[groupName(variant)].states[state].masterSha256 = sha(member.rawSvg);
    member.author.pathFingerprintSha256 = spec.groups[groupName(variant)].states[state].pathFingerprintSha256 = sha(stableJSON(authorPathEntries(member.artifactSvg)));
    glyph.parts.forEach((part, index) => { part.d = changed[index]; }); glyph.svg = member.artifactSvg;
    glyphs[icon] = glyph;
  }
  return { source, spec, owner: { glyph: request => request.variant === variant ? glyphs[request.icon] : compiler.glyph(request) } };
}
function deform(d, state) {
  const values = operands(d), center = [values[0], values[7]], longitudinal = state === 'horizontal' ? 0 : 1;
  let index = 0;
  return d.replace(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g, () => {
    const axis = index % 2, original = values[index++];
    return String(center[axis] + 1.1 * (original - center[axis]) + (axis === longitudinal ? -0.1 * (center[axis] - 12) : 0));
  });
}
function quarterMidpoint(vector, quarter) {
  const start = quarter === 0 ? vector.slice(0, 2) : vector.slice(quarter * 6, quarter * 6 + 2);
  const controls = vector.slice(2 + quarter * 6, 8 + quarter * 6);
  return [0, 1].map(axis => (start[axis] + 3 * controls[axis] + 3 * controls[axis + 2] + controls[axis + 4]) / 8);
}

describe('authored dots.orient: независимые masters и весь интервал', () => {
  it.each(variants)('%s сохраняет точные endpoints и unchanged middle', variant => {
    const payload = payloads[groupName(variant)], group = runtime(payload);
    for (const state of ['horizontal', 'vertical']) {
      expect(group.render(state).ok).toBe(true);
      expect([...group.render(state).svg.matchAll(/data-part="([^"]+)"/g)].map(match => match[1])).toEqual(['dot-leading', 'dot-middle', 'dot-trailing']);
      expect(rawPaths(group.render(state).svg)).toEqual(rawPaths(baseline.icons[`ellipsis-${state}`][variant].rawSvg));
    }
    const result = group.compileStateEffect('vertical', { duration: 300 });
    expect(result).toMatchObject({ ok: true, effect: { kind: 'contour-interpolation', from: 0, to: 1, unchangedPartIds: ['dot-middle'] } });
    expect(result.effect.targets.map(target => target.partId)).toEqual(['dot-leading', 'dot-trailing']);
    const prepared = prepareContourStateEffect(result.effect);
    for (const [p, state] of [[0, 'horizontal'], [1, 'vertical']]) {
      expect(prepared.sample(p).parts.map(part => part.d)).toEqual(rawPaths(baseline.icons[`ellipsis-${state}`][variant].rawSvg).filter((_, index) => index !== 1));
    }
    expect(payload.proof.separation).toHaveLength(3);
    expect(payload.proof.source).toEqual(document.source);
    expect(payload.proof.specSha256).toBe(sha(stableJSON({ schemaVersion: document.schemaVersion, source: document.source, name: groupName(variant), group: document.groups[groupName(variant)] })));
    expect(payload.proof.separation.every(pair => compareFractions(pair.minimumCenterDistanceSquared, pair.requiredDistanceSquared))).toBe(true);
    expect(BigInt(payload.proof.roundingUpper.numerator)).toBeGreaterThan(0n);
    const axis = payload.proof.roundingUpper, norm = payload.proof.roundingNormUpper;
    expect(BigInt(norm.numerator) ** 2n * BigInt(axis.denominator) ** 2n >=
      2n * BigInt(axis.numerator) ** 2n * BigInt(norm.denominator) ** 2n).toBe(true);
  });
  it.each(variants)('%s forward/reverse/retarget используют одну численную family pose', variant => {
    const group = runtime(payloads[groupName(variant)]);
    const forward = group.compileStateEffect('vertical', { duration: 300, from: 0.37 });
    const reverse = group.compileStateEffect('horizontal', { duration: 300, from: 0.37 });
    const a = prepareContourStateEffect(forward.effect), b = prepareContourStateEffect(reverse.effect);
    for (const p of [0, 0.01, 0.37, 0.5, 0.999, 1]) {
      expect(a.sample(p)).toEqual(b.sample(p));
      a.sample(p).parts.forEach((part, index) => {
        const [h, v] = forward.effect.targets[index].vectors;
        expect(operands(part.d)).toEqual(h.map((value, j) => p === 0 ? value : p === 1 ? v[j] : (1 - p) * value + p * v[j]));
        expect([...part.d.matchAll(/[MCZ]/g)].map(match => match[0])).toEqual(['M', 'C', 'C', 'C', 'C', 'Z']);
      });
    }
    expect(group.compileStateEffect('vertical', { duration: 300, reducedMotion: true }).effect.options.duration).toBe(0);
  });
  it('endpoint-safe scale/spacing witness нарушает реальный minimum gap в середине и отвергается', () => {
    const w = witness('filled', deform), gap = 24 * grid.ratios.clearanceMin;
    for (const state of ['horizontal', 'vertical']) {
      const vectors = rawPaths(w.source.icons[`ellipsis-${state}`].filled.rawSvg).map(operands), axis = state === 'horizontal' ? 0 : 1;
      const bounds = vectors.map(vector => vector.filter((_, index) => index % 2 === axis));
      expect(Math.min(...bounds[1]) - Math.max(...bounds[0])).toBeGreaterThan(gap);
    }
    const h = rawPaths(w.source.icons['ellipsis-horizontal'].filled.rawSvg).map(operands), v = rawPaths(w.source.icons['ellipsis-vertical'].filled.rawSvg).map(operands);
    const midpoint = h.map((path, index) => path.map((value, operand) => (value + v[index][operand]) / 2));
    const a = quarterMidpoint(midpoint[0], 0), b = quarterMidpoint(midpoint[1], 2);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(gap);
    expect(() => compile(w.source, w.spec, w.owner)).toThrow(expect.objectContaining({ code: 'INTERVAL_UNSAFE' }));
  });
  it('одинаковое число C не принимается без cardinal correspondence', () => {
    const w = witness('outline', d => {
      const pieces = [...d.matchAll(/([MC])([^MCZ]+)/g)];
      const quarters = pieces.slice(1).map(match => match[2]);
      return `M${operands(d).slice(6, 8).join(' ')}C${quarters[1]}C${quarters[2]}C${quarters[3]}C${quarters[0]}Z`;
    });
    expect(() => compile(w.source, w.spec, w.owner)).toThrow(expect.objectContaining({ code: 'CORRESPONDENCE_UNAVAILABLE' }));
    const drift = structuredClone(document); drift.groups[groupName('outline')].states.horizontal.masterSha256 = '0'.repeat(64);
    expect(() => compile(baseline, drift)).toThrow(expect.objectContaining({ code: 'MASTER_MISMATCH' }));
  });
  it('управляемая source-анатомия не допускает четверть, схлопывающуюся при округлении', () => {
    const nextUp = value => { const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value); bytes.setBigUint64(0, bytes.getBigUint64(0) + 1n); return bytes.getFloat64(0); };
    const w = witness('outline', d => {
      const numbers = operands(d), [cx, cy] = [numbers[0], numbers[7]];
      const s = [cx, nextUp(cy)], e = [nextUp(cx), cy], n = [cx, cy - 1.6], west = [cx - 1.6, cy];
      return `M${s.join(' ')}C${[...s, ...e, ...e].join(' ')}C${[...e, ...n, ...n].join(' ')}C${[...n, ...west, ...west].join(' ')}C${[...west, ...s, ...s].join(' ')}Z`;
    });
    for (const state of ['horizontal', 'vertical']) {
      const icon = `ellipsis-${state}`;
      expect(() => compileAuthorVariation(w.source.icons[icon].outline, contracts[`${icon}/outline`].parts,
        { law: 'dots.affine', axis: state === 'horizontal' ? 'x' : 'y' }, grid)).not.toThrow();
    }
    const h = operands(rawPaths(w.source.icons['ellipsis-horizontal'].outline.rawSvg)[0]);
    const v = operands(rawPaths(w.source.icons['ellipsis-vertical'].outline.rawSvg)[0]);
    const p = .01511, collapsed = h.slice(0, 8).map((value, index) => (1 - p) * value + p * v[index]);
    expect(new Set([0, 1, 2, 3].map(index => collapsed.slice(index * 2, index * 2 + 2).join(','))).size).toBe(1);
    expect(() => compile(w.source, w.spec, w.owner)).toThrow(expect.objectContaining({ code: 'INTERVAL_UNSAFE' }));
  });
  it('default-only domain, malformed requests и неподдержанные форматы дают явный отказ', () => {
    const group = runtime(payloads[groupName('outline')]);
    for (const variation of [undefined, {}, { dotScale: 1, spacingScale: 1 }]) expect(group.compileStateEffect('vertical', { duration: 10, variation }).ok).toBe(true);
    expect(group.render('vertical', { variation: { dotScale: 1.1, spacingScale: 0.9 } })).toMatchObject({ ok: false, reason: { code: 'VARIATION_UNSUPPORTED' } });
    for (const variation of [new Date(), null, [], { dotScale: NaN }, { spacingScale: 0 }, { radius: 1 }]) {
      expect(group.compileStateEffect('vertical', { duration: 10, variation })).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    }
    expect(group.render('missing')).toMatchObject({ ok: false, reason: { code: 'STATE_UNSUPPORTED' } });
    expect(group.render('vertical', { variant: 'filled' })).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
    for (const options of [{ duration: NaN }, { duration: 1, from: -0.1 }, { duration: 1, from: null }, { duration: 1, reducedMotion: null }, { duration: 1, unsupported: true }, null]) {
      expect(group.compileStateEffect('vertical', options)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    }
    for (const format of ['lottie', 'dotlottie', 'sf-symbols']) expect(group.exportStateTransition('vertical', { duration: 10, format })).toMatchObject({ ok: false, reason: { code: 'FORMAT_UNSUPPORTED' } });
    expect(group.exportStateTransition('vertical', { duration: 10, format: 'web-effect' }).ok).toBe(true);
  });
  it('переход не меняет горизонтальный activity gesture и не придумывает vertical loading', () => {
    const glyph = compiler.glyph({ icon: names[0], variant: 'outline', modelMode: 'source-only' });
    const caps = compiler.glyphCapabilities(names[0], 'outline'), author = baseline.icons[names[0]].outline.author;
    expect(compileSymbolEffect({ ...glyph, provenance: { ...glyph.provenance, author } }, { ...caps, author }, 'ellipsis-horizontal.activity', { duration: 300 })).toMatchObject({ ok: true, effect: { version: 2 } });
    expect(compiler.glyphCapabilities(names[1], 'outline').motion.gestures).toEqual([]);
  });
});

describe('переносимый prepared sampler', () => {
  const effect = runtime(payloads[groupName('filled')]).compileStateEffect('vertical', { duration: 300 }).effect;
  it('JSON roundtrip, input mutation и steady frame path не меняют snapshot', () => {
    const input = JSON.parse(JSON.stringify(effect)), prepared = prepareContourStateEffect(input), pose = prepared.sample(0.37);
    input.targets[0].vectors[0][0] = -100; input.targets[0].endpoints[0] = 'corrupt';
    Object.defineProperty(input, 'targets', { get() { throw new Error('frame перечитал input'); } });
    expect(prepared.sample(0.37)).toEqual(pose);
    expect(prepared.sample(0).parts[0].d).toBe(effect.targets[0].endpoints[0]);
    for (const p of [-1, NaN, Infinity, 1.01]) expect(prepared.sample(p)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });
  it('corrupt tuple/vector/endpoint/identity/options отвергаются до frame', () => {
    const mutations = [
      e => { e.targets[0].commands = ['M', 'CC', '', 'C', 'C', 'Z']; },
      e => { e.targets[0].vectors[0][2] = NaN; },
      e => { e.targets[0].endpoints[0] = e.targets[0].endpoints[0].replace('M', 'm'); },
      e => { e.targets[0].endpoints[0] += 'L0 0'; },
      e => { e.targets[0].vectors[0][24]++; },
      e => { e.targets[1].partId = e.targets[0].partId; },
      e => { e.unchangedPartIds.push('dot-middle'); },
      e => { e.unchangedPartIds = ['dot-leading']; },
      e => { e.targets = new Array(1); },
      e => { e.targetState = 'unknown'; },
      e => { e.options.duration = Infinity; },
      e => { e.to = 0; },
    ];
    for (const mutate of mutations) { const input = structuredClone(effect); mutate(input); expect(prepareContourStateEffect(input)).toMatchObject({ ok: false, reason: { code: 'EFFECT_UNSUPPORTED' } }); }
  });
  it('native emitted module + duplicate runtime выполняют packet; renderer/effect/capabilities разделены', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-icons-contour-'));
    try {
      mkdirSync(join(directory, 'ir')); mkdirSync(join(directory, 'states'));
      await build({ entryPoints: [join(root, 'src/ir/contour-runtime.ts')], outfile: join(directory, 'ir/contour-runtime.js'), bundle: true, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
      writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
      const name = groupName('filled');
      writeFileSync(join(directory, 'states', `${name}.js`), renderStateGroupModule(payloads[name]));
      const native = await import(pathToFileURL(join(directory, 'states', `${name}.js`)).href);
      const independent = await import(pathToFileURL(join(directory, 'ir/contour-runtime.js')).href);
      const transported = JSON.parse(JSON.stringify(native.compileStateEffect('vertical', { duration: 300 }).effect));
      expect(independent.prepareContourStateEffect(transported).sample(0.37)).toEqual(prepareContourStateEffect(effect).sample(0.37));
      for (const [operation, absent] of [['renderStateSvg', ['geometrySha256', 'specSha256', 'minimumCenterDistanceSquared']],
        ['compileStateEffect', ['specSha256', 'minimumCenterDistanceSquared', '<svg']], ['stateCapabilities', ['M12 14', '"vectors"', '<svg']]]) {
        const entry = `import { ${operation} } from './states/${name}.js'; console.log(${operation});`;
        const bundle = await build({ stdin: { contents: entry, resolveDir: directory, sourcefile: 'consumer.js' }, bundle: true, write: false, format: 'esm', treeShaking: true, minify: true, logLevel: 'silent' });
        for (const value of absent) expect(bundle.outputFiles[0].text).not.toContain(value);
      }
      expect(stateGroupDeclaration(document, name)).toContain("../ir/state-types.js");
      const projected = symbolReleaseProjection(read('release/contract.json'), names, Object.keys(document.groups), names);
      expect(projected.files).toContain('dist/ir/contour-runtime.js');
      expect(native.stateCapabilities()).toMatchObject({ transition: 'contour-interpolation', morph: 'topology-proven', variation: 'exact-default-only' });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('реальный public NodeNext consumer разрешает declarations и отвергает неверные запросы', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lab-icons-contour-types-'));
    const tsc = join(root, 'node_modules/typescript/bin/tsc');
    try {
      const declarations = join(directory, 'declarations'), pkg = join(directory, 'node_modules/@labpics/icons'), dist = join(pkg, 'dist');
      execFileSync(process.execPath, [tsc, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal', '--strict',
        '--noUncheckedIndexedAccess', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--skipLibCheck',
        '--rootDir', join(root, 'src'), '--outDir', declarations, join(root, 'src/motion/index.ts'), join(root, 'src/states/types.ts')], { cwd: directory });
      cpSync(declarations, dist, { recursive: true }); mkdirSync(join(dist, 'states'), { recursive: true });
      writeFileSync(join(dist, 'ir/state-types.d.ts'), readFileSync(join(declarations, 'states/types.d.ts')));
      writeFileSync(join(dist, 'motion/index.d.ts'), readFileSync(join(declarations, 'motion/index.d.ts'), 'utf8').replaceAll('../states/types.js', '../ir/state-types.js'));
      const name = groupName('filled');
      writeFileSync(join(dist, 'states', `${name}.d.ts`), stateGroupDeclaration(document, name));
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: read('package.json').exports }));
      const consumer = join(directory, 'consumer.mts');
      const imports = `import { compileStateEffect, renderStateSvg, stateCapabilities } from '@labpics/icons/states/${name}';\nimport { prepareContourStateEffect } from '@labpics/icons/motion';\n`;
      const check = (body, includeImports = true) => {
        writeFileSync(consumer, (includeImports ? imports : '') + body);
        return spawnSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--target', 'ES2022',
          '--module', 'NodeNext', '--moduleResolution', 'NodeNext', consumer], { cwd: directory, encoding: 'utf8' });
      };
      const positive = check(`const result = compileStateEffect('vertical', { duration: 300, from: .37, variation: { dotScale: 1, spacingScale: 1 } });
if (result.ok) { const sampler = prepareContourStateEffect(result.effect); if (sampler.ok) sampler.sample(.37); }
renderStateSvg('horizontal'); BigInt(stateCapabilities().proof.separation[0]!.requiredDistanceSquared.numerator);`);
      expect(positive.status, positive.stdout + positive.stderr).toBe(0);
      for (const dynamicImport of [false, true]) {
        const generated = check(stateTypeConsumerSource({ [name]: { law: 'dots.orient', defaultState: 'horizontal', states: [{ id: 'horizontal' }, { id: 'vertical' }] } }, { dynamicImport }), false);
        expect(generated.status, generated.stdout + generated.stderr).toBe(0);
      }
      for (const body of ["compileStateEffect('unknown', { duration: 300 });", "compileStateEffect('vertical', { duration: '300' });",
        "renderStateSvg('vertical', { variation: { radius: 1 } });", "prepareContourStateEffect({ kind: 'enclosure-replacement' });",
        "import { prepareContourStateEffect as privateSampler } from '@labpics/icons/ir/contour-runtime'; privateSampler({});"]) {
        const negative = check(body); expect(negative.status, body).not.toBe(0); expect(negative.stdout).toContain('error TS');
      }
      const projected = symbolReleaseProjection(read('release/contract.json'), names, [], names);
      expect(projected.typeDependencies).toContain('dist/ir/state-types.d.ts');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
