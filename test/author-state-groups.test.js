import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorStateGroups, authorStateGroupNames, renderStateGroupModule, stateGroupDeclaration } from '../scripts/lib/author-state-groups.js';
import { buildSourceVariantContractFromSvg } from '../scripts/lib/icon-catalog.js';
import { symbolExportName, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { validateReleaseContract, expandReleaseExports, declarationModuleSpecifiers } from '../scripts/lib/release-contract.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { assembleGlyphLayers, assembleGlyphFrame } from '../src/ir/svg-assembly.js';
import { createCompiledStateGroup } from '../src/states/runtime.js';
import { statePackageExpectations, verifyInstalledStateGroup } from '../scripts/lib/state-artifact-consumer.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(file, new URL('..', import.meta.url)), 'utf8'));
const document = read('semantics/author-state-groups.json');
const spec = document.groups['status-circle'];
const manifest = read('semantics/figma-baseline.json');
const groupNames = Object.keys(document.groups).sort();
const names = [...new Set([...Object.values(document.groups).flatMap(group =>
  Object.values(group.states).map(state => state.icon)), 'stop-circle'])];
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function compilerFor(source) {
  return createGlyphCompiler({
    catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: Object.fromEntries(Object.entries(source.icons).map(([icon, variants]) => [icon, {
        model: null, source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])),
      }])),
    }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(Object.entries(source.icons).flatMap(([icon, variants]) =>
      Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
  });
}
const compiler = compilerFor(baseline);
const compile = (source = baseline, input = document, owner = compilerFor(source)) =>
  compileAuthorStateGroups(source, input, { compiler: owner, assembleGlyphLayers, assembleGlyphFrame });
const payloads = compile();
const payload = payloads['status-circle'];
const group = createCompiledStateGroup(payload);
const stateNames = Object.keys(spec.states).sort();

// Ожидание читает оригинальные raw path tags; production reader/serializer не участвуют.
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));

function repin(source, input, state, mutate, name = 'status-circle') {
  const declaration = input.groups[name].states[state];
  const member = source.icons[declaration.icon][declaration.variant];
  member.rawSvg = mutate(member.rawSvg);
  member.normalizedSvg = normalizeFigmaSvg(member.rawSvg);
  member.artifactSvg = member.normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"');
  member.author.masterSha256 = declaration.masterSha256 = sha256(member.rawSvg);
  member.author.normalizedSha256 = sha256(member.normalizedSvg);
  member.author.pathFingerprintSha256 = declaration.pathFingerprintSha256 = sha256(stableJSON(authorPathEntries(member.normalizedSvg)));
  member.sourceContract = buildSourceVariantContractFromSvg({ file: member.master,
    sourceSvg: member.normalizedSvg, artifactSvg: member.artifactSvg });
}

describe.each(groupNames)('%s: точные author masters и единая оболочка', name => {
  const spec = document.groups[name];
  const group = createCompiledStateGroup(payloads[name]);
  const stateNames = Object.keys(spec.states).sort();

  it.each(stateNames)('%s static SVG сохраняет каждый d, rule и порядок оригинала', state => {
    const rendered = group.render(state);
    expect(rendered.ok).toBe(true);
    const { icon, variant } = spec.states[state];
    expect(rawPaths(rendered.svg)).toEqual(rawPaths(baseline.icons[icon][variant].rawSvg));
    expect(rendered.svg).toContain('viewBox="0 0 24 24"');
    expect(rendered.svg).toContain('width="24" height="24"');
    expect(rendered.svg).not.toContain('data-state=');
    expect(group.stateCapabilities().states.find(member => member.id === state).author).toEqual(baseline.icons[icon][variant].author);
  });

  it('mount SVG содержит все prefix-группы и единственный неподвижный suffix', () => {
    const mounted = group.renderStateSvg(spec.defaultState).svg;
    const groups = [...mounted.matchAll(/<g\b[^>]*data-state="([^"]+)"[^>]*opacity="([01])">([\s\S]*?)<\/g>/g)];
    expect(groups).toHaveLength(stateNames.length);
    expect(groups.filter(match => match[2] === '1').map(match => match[1])).toEqual([spec.defaultState]);
    expect(mounted.split(`data-part="${spec.enclosurePartId}"`)).toHaveLength(2);
    const sharedIds = spec.sharedParts.map(part => part.id);
    expect(group.stateCapabilities().sharedPartIds).toEqual(sharedIds);
    for (const id of sharedIds) {
      expect(mounted.split(`data-part="${id}"`)).toHaveLength(2);
      expect(groups.every(match => !match[3].includes(`data-part="${id}"`))).toBe(true);
    }
    for (const [, state, , body] of groups) {
      const { icon, variant, contentPartIds } = spec.states[state];
      expect(rawPaths(body)).toEqual(rawPaths(baseline.icons[icon][variant].rawSvg).slice(0, contentPartIds.length));
      expect([...body.matchAll(/data-part="([^"]+)"/g)].map(match => match[1])).toEqual(contentPartIds);
      expect(body).not.toContain('opacity=');
    }
    const original = spec.states[spec.defaultState];
    expect(rawPaths(mounted).slice(-sharedIds.length)).toEqual(
      rawPaths(baseline.icons[original.icon][original.variant].rawSvg).slice(-sharedIds.length));
    expect(group.renderStateSvg().svg).toBe(mounted);
    expect(group.render().svg).toBe(group.render(spec.defaultState).svg);
  });

  it('каждая смена и обратное намерение адресуют существующие группы без initial opacity/from', () => {
    for (const state of stateNames) {
      const result = group.compileStateEffect(state, { duration: 450 });
      expect(result).toMatchObject({ ok: true, effect: {
        contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement', targetState: state,
        unchangedPartIds: spec.sharedParts.map(part => part.id), options: { duration: 450, easing: 'linear', fill: 'both' },
      } });
      expect(result.effect.stages).toEqual(stateNames.map(id => ({
        partId: `state-${id}`, property: 'opacity', to: id === state ? 1 : 0, at: 0, duration: 450,
      })));
      expect(result.effect.stages.reduce((sum, stage) => sum + stage.to, 0)).toBe(1);
      expect(result.effect.stages.every(stage => !Object.hasOwn(stage, 'from'))).toBe(true);
      expect(Object.isFrozen(result.effect.stages[0])).toBe(true);
      expect(group.exportStateTransition(state, { format: 'web-effect', duration: 450 })).toEqual(result);
      const reduced = group.compileStateEffect(state, { duration: 450, reducedMotion: true });
      expect(reduced.effect.options.duration).toBe(0);
      expect(reduced.effect.stages.every(stage => stage.duration === 0)).toBe(true);
      expect(reduced.effect.stages.map(stage => stage.to)).toEqual(result.effect.stages.map(stage => stage.to));
    }
    expect(group.stateCapabilities().morph).toBe('unavailable');
    expect(group.stateCapabilities()).toBe(group.stateCapabilities());
  });

  it('installed raw oracle принимает группу и сохраняет точные отказы', () => {
    const expected = statePackageExpectations(baseline, document)[name];
    expect(() => verifyInstalledStateGroup(group, expected)).not.toThrow();
    expect(group.render(spec.defaultState, { variant: 'filled' })).toMatchObject({
      ok: false, reason: { code: 'VARIANT_UNSUPPORTED' },
    });
    expect(group.compileStateEffect('not-declared', { duration: 300 })).toMatchObject({
      ok: false, reason: { code: 'STATE_UNSUPPORTED' },
    });
    for (const format of ['lottie', 'dotlottie', 'sf-symbols']) {
      expect(group.exportStateTransition(spec.defaultState, { format, duration: 300 })).toMatchObject({
        ok: false, reason: { code: 'FORMAT_UNSUPPORTED' },
      });
    }
  });
});

describe('expression-face: общие глаза не входят в изменяемую opacity группу', () => {
  const name = 'expression-face';
  const faceSpec = document.groups[name];
  const face = createCompiledStateGroup(payloads[name]);
  const mutatePath = (svg, index, change) => {
    let cursor = 0;
    return svg.replace(/<path\b[^>]*>/g, tag => cursor++ === index ? change(tag) : tag);
  };

  it('сохраняет три fixed parts один раз независимо от числа смен и обратных намерений', () => {
    const shared = ['face-left-eye', 'face-right-eye', 'face-enclosure'];
    expect(face.stateCapabilities().sharedPartIds).toEqual(shared);
    for (const state of ['aloof', 'sad', 'smile', 'sad', 'aloof']) {
      const mounted = face.renderStateSvg(state).svg;
      const bodies = [...mounted.matchAll(/<g\b[^>]*data-state="([^"]+)"[^>]*opacity="([01])">([\s\S]*?)<\/g>/g)];
      expect(bodies).toHaveLength(3);
      expect(bodies.every(match => rawPaths(match[3]).length === 1)).toBe(true);
      for (const id of shared) expect(mounted.split(`data-part="${id}"`)).toHaveLength(2);
      expect(face.compileStateEffect(state, { duration: 300 }).effect.unchangedPartIds).toEqual(shared);
      expect(face.compileStateEffect(state, { duration: 300 }).effect.stages.every(stage => !shared.includes(stage.partId))).toBe(true);
    }
    expect(payloads[name].sharedSvg).not.toContain('mouth');
    expect(payloads[name].states.every(state => !state.contentSvg.includes('face-left-eye'))).toBe(true);
    expect(Object.isFrozen(face.stateCapabilities().sharedPartIds)).toBe(true);
    expect(face.stateCapabilities().morph).toBe('unavailable');
  });

  it.each([
    ['удалённый глаз', svg => mutatePath(svg, 1, () => ''), 'TOPOLOGY_UNSUPPORTED'],
    ['другая eye geometry', svg => mutatePath(svg, 1, tag => tag.replace(/M([+-]?\d+(?:\.\d+)?)/,
      (_, value) => `M${Number(value) + 0.01}`)), 'SHARED_PART_MISMATCH'],
    ['другой eye rule', svg => mutatePath(svg, 1, tag => tag.replace('<path ', '<path fill-rule="evenodd" ')), 'SHARED_PART_MISMATCH'],
    ['переставленные глаза', svg => {
      const tags = [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => tag);
      return mutatePath(mutatePath(svg, 1, () => tags[2]), 2, () => tags[1]);
    }, 'SHARED_PART_MISMATCH'],
    ['другая оболочка', svg => mutatePath(svg, 3, tag => tag.replace(/M([+-]?\d+(?:\.\d+)?)/,
      (_, value) => `M${Number(value) + 0.01}`)), 'ENCLOSURE_MISMATCH'],
  ])('%s: новый допустимый master не получает прежнюю shared anatomy', (_, mutate, code) => {
    const source = structuredClone(baseline), input = structuredClone(document);
    repin(source, input, 'smile', mutate, name);
    expect(input.groups[name].states.smile.masterSha256).not.toBe(faceSpec.states.smile.masterSha256);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code }));
  });

  it('Filled evenodd compound не превращается в положительные глаза и кольцо', () => {
    const source = baseline.icons.smile.filled;
    expect(rawPaths(source.rawSvg)).toHaveLength(1);
    const input = structuredClone(document);
    Object.assign(input.groups[name].states.smile, { variant: 'filled',
      masterSha256: source.author.masterSha256, pathFingerprintSha256: source.author.pathFingerprintSha256 });
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
    expect(face.render('smile', { variant: 'filled' })).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
  });

  it('забытые общие глаза не допускаются как часть изменяемых prefix-групп', () => {
    const input = structuredClone(document);
    input.groups[name].sharedParts = [{ id: 'face-enclosure', role: 'container' }];
    for (const [state, member] of Object.entries(input.groups[name].states)) {
      member.contentPartIds.push(`${state}-left-eye`, `${state}-right-eye`);
    }
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'SHARED_PART_UNDECLARED' }));
  });

  it('installed oracle обнаруживает eye duplication и движение неподвижной части', () => {
    const expected = statePackageExpectations(baseline, document)[name];
    const duplicate = { ...face, renderStateSvg(state) {
      const result = face.renderStateSvg(state);
      return { ...result, svg: result.svg.replace('</svg>', payloads[name].sharedSvg + '</svg>') };
    } };
    const moving = { ...face, compileStateEffect(state, request) {
      const result = structuredClone(face.compileStateEffect(state, request));
      result.effect.unchangedPartIds = ['face-enclosure'];
      return result;
    } };
    const dimmed = { ...face, renderStateSvg(state) {
      const result = face.renderStateSvg(state);
      return { ...result, svg: result.svg.replace('data-part="face-left-eye"', 'opacity="0.5" data-part="face-left-eye"') };
    } };
    const extra = { ...face, renderStateSvg(state) {
      const result = face.renderStateSvg(state);
      return { ...result, svg: result.svg.replace('</svg>', '<path fill="currentColor" d="M0 0H1V1Z"/></svg>') };
    } };
    expect(() => verifyInstalledStateGroup(duplicate, expected)).toThrow('state artifact:');
    expect(() => verifyInstalledStateGroup(moving, expected)).toThrow('state artifact:');
    expect(() => verifyInstalledStateGroup(dimmed, expected)).toThrow('state artifact:');
    expect(() => verifyInstalledStateGroup(extra, expected)).toThrow('state artifact:');
  });
});

describe('enclosure.replace: adversarial admission и compatibility', () => {
  it.each([
    [0, 'TOPOLOGY_UNSUPPORTED'],
    [1, 'ENCLOSURE_MISMATCH'],
  ])('stop-circle с корректным master и prefix длины %s не подменяет общий последний enclosure', (length, code) => {
    const source = baseline.icons['stop-circle'].outline;
    const invalid = structuredClone(document);
    invalid.groups['playback-circle'].states.stop = {
      icon: 'stop-circle', variant: 'outline', masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256,
      contentPartIds: ['stop-mark'].slice(0, length),
    };
    expect(() => compile(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });

  it('удалённая pause bar с новым корректным receipt не проходит полное part покрытие', () => {
    const source = structuredClone(baseline), input = structuredClone(document);
    expect(rawPaths(source.icons['pause-circle'].outline.rawSvg)).toHaveLength(3);
    repin(source, input, 'pause', svg => svg.replace(/<path\b[^>]*\/>/, ''), 'playback-circle');
    expect(rawPaths(source.icons['pause-circle'].outline.rawSvg)).toHaveLength(2);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('состояния разных предметных групп не превращаются в общий enum', () => {
    const playback = createCompiledStateGroup(payloads['playback-circle']);
    for (const state of ['confirmation', 'stop']) {
      expect(playback.render(state)).toMatchObject({ ok: false, reason: { code: 'STATE_UNSUPPORTED' } });
      expect(playback.compileStateEffect(state, { duration: 300 })).toMatchObject({
        ok: false, reason: { code: 'STATE_UNSUPPORTED' },
      });
    }
    expect(group.render('play')).toMatchObject({ ok: false, reason: { code: 'STATE_UNSUPPORTED' } });
  });

  it.each(['lottie', 'dotlottie', 'sf-symbols'])('%s transition получает честный отказ', format => {
    expect(group.exportStateTransition('confirmation', { format, duration: 300 })).toMatchObject({
      ok: false, reason: { code: 'FORMAT_UNSUPPORTED' },
    });
  });

  it.each(['render', 'renderStateSvg'])('%s отказывает Filled и неизвестным состояниям/параметрам', method => {
    expect(group[method]('confirmation', { variant: 'filled' })).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
    expect(group[method]('error')).toMatchObject({ ok: false, reason: { code: 'STATE_UNSUPPORTED' } });
    expect(group[method]('confirmation', { variant: 'weight' })).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    expect(group[method]('confirmation', { axes: { weight: 2 } })).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    expect(group[method]('confirmation', null)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    expect(group[method]({ toString() { throw new Error('не вызывать'); } })).toMatchObject({ ok: false, reason: { code: 'STATE_UNSUPPORTED' } });
  });

  it.each([
    ['render', {}], ['renderStateSvg', {}],
    ['compileStateEffect', { duration: 300 }],
    ['exportStateTransition', { duration: 300, format: 'web-effect' }],
  ])('%s: только missing/undefined variant использует default, null получает точный отказ', (method, request) => {
    expect(group[method]('confirmation', { ...request, variant: null })).toMatchObject({
      ok: false, reason: { code: 'INVALID_REQUEST' },
    });
    expect(group[method]('confirmation', request).ok).toBe(true);
    expect(group[method]('confirmation', { ...request, variant: undefined }).ok).toBe(true);
    expect(group[method]('confirmation', { ...request, variant: 'outline' }).ok).toBe(true);
    expect(group[method]('confirmation', { ...request, variant: 'filled' })).toMatchObject({
      ok: false, reason: { code: 'VARIANT_UNSUPPORTED' },
    });
  });

  it.each([
    null, undefined, [], { duration: -1 }, { duration: NaN }, { duration: Infinity },
    { duration: '300' }, { duration: 300, reducedMotion: 1 }, { duration: 300, from: 'question' },
  ])('отказывает malformed effect request %j', request => {
    expect(group.compileStateEffect('confirmation', request)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });

  it.each([
    ['stale source', input => { input.source.version = '1'; }, 'SOURCE_MISMATCH'],
    ['unknown law', input => { input.groups['status-circle'].law = 'morph'; }, 'LAW_UNSUPPORTED'],
    ['stale master', input => { input.groups['status-circle'].states.confirmation.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
    ['partial parts', input => { input.groups['status-circle'].states.question.contentPartIds.pop(); }, 'TOPOLOGY_UNSUPPORTED'],
    ['legacy enclosure index', input => { input.groups['status-circle'].states.confirmation.enclosurePathIndex = 0; }, 'SPEC_INVALID'],
    ['legacy schema', input => { input.schemaVersion = 1; }, 'SPEC_INVALID'],
    ['shared role', input => { input.groups['status-circle'].sharedParts[0].role = 'content'; }, 'SPEC_INVALID'],
    ['wrong enclosure identity', input => { input.groups['status-circle'].sharedParts[0].id = 'other-container'; }, 'SPEC_INVALID'],
    ['duplicate part', input => { input.groups['status-circle'].states.confirmation.contentPartIds[0] = 'status-enclosure'; }, 'SPEC_INVALID'],
    ['unknown field', input => { input.groups['status-circle'].axes = {}; }, 'SPEC_INVALID'],
  ])('%s не проходит admission', (_, mutate, code) => {
    const invalid = structuredClone(document);
    mutate(invalid);
    expect(() => compile(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    ['другая координата', svg => svg.replace('M12 1.5', 'M12.01 1.5')],
    ['другой winding', svg => svg.replace('fill-rule="evenodd"', 'fill-rule="nonzero"')],
  ])('%s: новый допустимый master не получает ложную общую оболочку', (_, mutate) => {
    const source = structuredClone(baseline), input = structuredClone(document);
    repin(source, input, 'confirmation', mutate);
    expect(input.groups['status-circle'].states.confirmation.masterSha256).not.toBe(spec.states.confirmation.masterSha256);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'ENCLOSURE_MISMATCH' }));
  });

  it.each([
    ['геометрия', glyph => { glyph.parts.at(-1).d += 'M0 0Z'; }],
    ['paint', glyph => { glyph.parts.at(-1).paint = { kind: 'stroke', strokeWidth: 1, linecap: 'round', linejoin: 'round' }; }],
    ['viewBox', glyph => { glyph.viewBox[2] = 25; }],
    ['z-order', glyph => { glyph.parts[0].zIndex = 1; }],
    ['provenance', glyph => { glyph.provenance.file = 'foreign.svg'; }],
  ])('подмена compiler %s отвергается', (_, mutate) => {
    const owner = { glyph(request) { const output = structuredClone(compiler.glyph(request)); mutate(output); return output; } };
    expect(() => compile(baseline, document, owner)).toThrow(expect.objectContaining({ code: 'COMPILER_MISMATCH' }));
  });

  it('Filled member с единственным body не получает отдельную оболочку', () => {
    const source = baseline.icons['checkmark-circle'].filled;
    const invalid = structuredClone(document);
    Object.assign(invalid.groups['status-circle'].states.confirmation, {
      variant: 'filled', masterSha256: source.author.masterSha256, pathFingerprintSha256: source.author.pathFingerprintSha256,
      contentPartIds: [],
    });
    expect(() => compile(baseline, invalid)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('implicit fill closure не выдаётся за явно замкнутую авторскую топологию', () => {
    const source = structuredClone(baseline), input = structuredClone(document);
    repin(source, input, 'confirmation', svg => svg.replaceAll('Z', ''));
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('public projection растёт от spec и хранит runtime вне wildcard', () => {
    expect(authorStateGroupNames(document)).toEqual(groupNames);
    const projection = symbolReleaseProjection(read('release/contract.json'), ['fixture'], authorStateGroupNames(document));
    expect(validateReleaseContract(projection)).toEqual([]);
    for (const name of groupNames) expect(expandReleaseExports(projection)[`./states/${name}`]).toEqual({
      types: `./dist/states/${name}.d.ts`, import: `./dist/states/${name}.js`,
    });
    expect(projection.runtimeDependencies).toContain('dist/ir/state-runtime.js');
    expect(projection.files).not.toContain('dist/states/runtime.js');
    const module = renderStateGroupModule(payload);
    expect(module.match(/data-part=\\"status-enclosure\\"/g)).toHaveLength(1);
    expect(module).not.toContain('createGlyphCompiler');
    expect(module).not.toContain('from \'@labpics/motion\'');
    expect(module).not.toContain('catalog.generated');
    const declaration = stateGroupDeclaration(document, 'status-circle');
    for (const state of stateNames) expect(declaration).toContain(JSON.stringify(state));
    expect(declaration).toContain('state?: State');
    expect(declaration).not.toContain('createCompiledStateGroup');
    const noOutputs = { ...projection, files: projection.files.filter(file => !file.startsWith('dist/states/')) };
    expect(validateReleaseContract(noOutputs).join('\n')).toContain('states wildcard не имеет точных group outputs');
  });

  it('state types зависят только от primitive provenance leaf, без geometry/catalog/authoring', () => {
    const publicDeclaration = declarationModuleSpecifiers(stateGroupDeclaration(document, 'status-circle'));
    expect(publicDeclaration.errors).toEqual([]);
    expect(publicDeclaration.specifiers).toEqual(['../ir/state-types.js']);
    const seen = new Set(), queue = ['src/states/types.ts'];
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      const parsed = declarationModuleSpecifiers(readFileSync(join(root, file), 'utf8'));
      expect(parsed.errors).toEqual([]);
      for (const specifier of parsed.specifiers) {
        expect(specifier.startsWith('.')).toBe(true);
        const target = posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\.js$/, '.ts');
        expect(existsSync(join(root, target))).toBe(true);
        queue.push(target);
      }
    }
    expect([...seen].sort()).toEqual(['src/ir/author-provenance.ts', 'src/states/types.ts']);
  });

  it('тот же installed-consumer oracle различает geometry/stage/group-opacity подмены', () => {
    const expected = statePackageExpectations(baseline, document)['status-circle'];
    expect(() => verifyInstalledStateGroup(group, expected)).not.toThrow();
    const wrappers = [
      { ...group, render(state) { const result = group.render(state); return { ...result, svg: result.svg.replace('M12 1.5', 'M12.01 1.5') }; } },
      { ...group, render(state) { const result = group.render(state); return { ...result, svg: result.svg.replaceAll('fill="currentColor"', 'fill="#ff0000"') }; } },
      { ...group, render(state) { const result = group.render(state); return { ...result, svg: result.svg.replace('</svg>', '<rect width="24" height="24"/></svg>') }; } },
      { ...group, renderStateSvg(state) { const result = group.renderStateSvg(state); return { ...result, svg: result.svg.replace('data-state="question" opacity="1"', 'data-state="question" opacity="0"') }; } },
      { ...group, compileStateEffect(state, request) { const result = structuredClone(group.compileStateEffect(state, request)); result.effect.stages[0].to = 0.5; return result; } },
    ];
    for (const mutant of wrappers) expect(() => verifyInstalledStateGroup(mutant, expected)).toThrow('state artifact:');
  });
});
