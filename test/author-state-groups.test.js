import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorStateGroups, authorStateGroupNames, renderStateGroupModule, stateGroupDeclaration } from '../scripts/lib/author-state-groups.js';
import { buildSourceVariantContractFromSvg } from '../scripts/lib/icon-catalog.js';
import { symbolExportName, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { validateReleaseContract, expandReleaseExports } from '../scripts/lib/release-contract.js';
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
const names = Object.values(spec.states).map(state => state.icon);
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
const payload = compile()['status-circle'];
const group = createCompiledStateGroup(payload);
const stateNames = Object.keys(spec.states).sort();

// Ожидание читает оригинальные raw path tags; production reader/serializer не участвуют.
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));

function repin(source, input, state, mutate) {
  const declaration = input.groups['status-circle'].states[state];
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

describe('enclosure.replace: точные author masters и единая оболочка', () => {
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

  it('mount SVG содержит шесть целых групп и только одну неподвижную оболочку', () => {
    const mounted = group.renderStateSvg('question').svg;
    const groups = [...mounted.matchAll(/<g\b[^>]*data-state="([^"]+)"[^>]*opacity="([01])">([\s\S]*?)<\/g>/g)];
    expect(groups).toHaveLength(stateNames.length);
    expect(groups.filter(match => match[2] === '1').map(match => match[1])).toEqual(['question']);
    expect(mounted.match(/data-part="status-enclosure"/g)).toHaveLength(1);
    for (const [, state, , body] of groups) {
      const { icon, variant, contentPartIds } = spec.states[state];
      expect(rawPaths(body)).toEqual(rawPaths(baseline.icons[icon][variant].rawSvg).slice(0, -1));
      expect([...body.matchAll(/data-part="([^"]+)"/g)].map(match => match[1])).toEqual(contentPartIds);
      expect(body).not.toContain('opacity=');
    }
    expect(sha256(rawPaths(mounted).at(-1).d)).toBe('e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9');
    expect(group.renderStateSvg().svg).toBe(mounted);
    expect(group.render().svg).toBe(group.render('question').svg);
  });

  it('каждая смена и обратное намерение адресуют существующие группы без initial opacity/from', () => {
    for (const state of stateNames) {
      const result = group.compileStateEffect(state, { duration: 450 });
      expect(result).toMatchObject({ ok: true, effect: {
        contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement', targetState: state,
        unchangedPartIds: ['status-enclosure'], options: { duration: 450, easing: 'linear', fill: 'both' },
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
    ['wrong enclosure index', input => { input.groups['status-circle'].states.confirmation.enclosurePathIndex = 0; }, 'TOPOLOGY_UNSUPPORTED'],
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
      enclosurePathIndex: 0, contentPartIds: [],
    });
    expect(() => compile(baseline, invalid)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('implicit fill closure не выдаётся за явно замкнутую авторскую топологию', () => {
    const source = structuredClone(baseline), input = structuredClone(document);
    repin(source, input, 'confirmation', svg => svg.replaceAll('Z', ''));
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('public projection растёт от spec и хранит runtime вне wildcard', () => {
    expect(authorStateGroupNames(document)).toEqual(['status-circle']);
    const projection = symbolReleaseProjection(read('release/contract.json'), ['fixture'], authorStateGroupNames(document));
    expect(validateReleaseContract(projection)).toEqual([]);
    expect(expandReleaseExports(projection)['./states/status-circle']).toEqual({
      types: './dist/states/status-circle.d.ts', import: './dist/states/status-circle.js',
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
