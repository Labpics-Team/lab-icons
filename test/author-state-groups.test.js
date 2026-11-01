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
  Object.values(group.states).map(state => state.icon)), 'stop-circle',
  ...['back', 'down', 'forward', 'up'].map(direction => `arrow-${direction}-circle`)])];
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

// Только test-built declaration: публичная предметная группа этим не принимается.
function directionDocument(directions = ['back', 'down'], variant = 'outline') {
  return { schemaVersion: 2, source: document.source, groups: { 'direction-witness': {
    law: 'enclosure.replace', defaultState: 'down', enclosurePartId: 'direction-ring',
    sharedParts: [{ id: 'direction-ring', role: 'container' }],
    states: Object.fromEntries(directions.map(direction => {
      const icon = `arrow-${direction}-circle`, source = baseline.icons[icon][variant];
      return [direction, { icon, variant, masterSha256: source.author.masterSha256,
        pathFingerprintSha256: source.author.pathFingerprintSha256, contentPartIds: [`${direction}-arrow`] }];
    })),
  } } };
}

// Независимый oracle для этой пары: восемь рёбер и явная карта соответствия.
// Его decimal tokens уже имеют одинаковое написание; canonical key не участвует.
function authoredCubicContours(d) {
  return d.split('Z').filter(Boolean).map(contour => {
    const commands = [...contour.matchAll(/([MC])([^MC]+)/g)];
    expect(commands.map(match => match[1])).toEqual(['M', 'C', 'C', 'C', 'C']);
    const points = commands.map(match => match[2].trim().split(/\s+/));
    expect(points[0]).toHaveLength(2);
    const edges = points.slice(1).map((values, index) => {
      expect(values).toHaveLength(6);
      return [index === 0 ? points[0] : points[index].slice(-2),
        values.slice(0, 2), values.slice(2, 4), values.slice(4)];
    });
    expect(edges.at(-1).at(-1)).toEqual(points[0]);
    return edges;
  });
}

describe('exact shared contours: настоящий build/runtime путь без изменения masters', () => {
  it('байты трёх буквальных payload/module/proof сохраняются', () => {
    // SHA получены до исправления на a85395d; не регенерировать из нового key.
    expect(Object.fromEntries(groupNames.map(name => [name, {
      payload: sha256(JSON.stringify(payloads[name])), module: sha256(renderStateGroupModule(payloads[name])),
      proof: sha256(JSON.stringify(payloads[name].proof)),
    }]))).toEqual({
      'expression-face': {
        payload: 'b9ee497d047cac1f3621143fb649daf8cc872e3be00d94dea6eac9fb5e024b49',
        module: '1e4236845e7142a2a900de9a2f2235ba9f0a8f4535cc72e4201a17804982a52b',
        proof: '6a0c0f72df5b43a1671844e85995756b84aac82fbbc8090431763a7b25f4d89c',
      },
      'playback-circle': {
        payload: '7cced098e81dc69a1a2bfed24604c84f00322e3553e5b54bc1729b2da88c0d6e',
        module: 'a334e7e6f1d55ccd5893dab3f796eaf92c1ea2446ab4bca13648a799321bf593',
        proof: '9ee269bd3d3a6a6facb237e87a904e9facae848daa433c4f9c2e5db48629b68e',
      },
      'status-circle': {
        payload: 'b3611800148803d54aedefdf293a4b22b380139e7f0a406cfdad0339c5486d7d',
        module: '2683e8515aa68827bf979941c00d773352d4ccd763ae88a1e257954bf721b6e3',
        proof: 'f8b42ed4c8cbdb1e665c63fba7e519f36559c26179ad0e5ba69eea87e9189738',
      },
    });
  });

  it('back/down совпадают восемью directed cubic edges независимо от production key', () => {
    const back = rawPaths(baseline.icons['arrow-back-circle'].outline.rawSvg).at(-1);
    const down = rawPaths(baseline.icons['arrow-down-circle'].outline.rawSvg).at(-1);
    expect(back.fillRule).toBe('evenodd');
    expect(down.fillRule).toBe('evenodd');
    expect(back.d).not.toBe(down.d);
    const b = authoredCubicContours(back.d), d = authoredCubicContours(down.d);
    expect(b).toHaveLength(2);
    expect(d).toHaveLength(2);
    const reverse = edge => [...edge].reverse();
    expect(d[0]).toEqual([2, 1, 0, 3].map(index => reverse(b[0][index])));
    expect(d[1]).toEqual([0, 3, 2, 1].map(index => reverse(b[1][index])));
  });

  it('back/down проходят production compile и raw static oracle; mount использует defaultState', () => {
    const input = directionDocument();
    const payload = compile(baseline, input)['direction-witness'];
    const group = createCompiledStateGroup(payload);
    const expected = statePackageExpectations(baseline, input)['direction-witness'];
    expect(() => verifyInstalledStateGroup(group, expected)).not.toThrow();
    for (const state of ['back', 'down']) {
      expect(rawPaths(group.render(state).svg)).toEqual(rawPaths(baseline.icons[`arrow-${state}-circle`].outline.rawSvg));
      const mounted = group.renderStateSvg(state).svg;
      expect(mounted.split('data-part="direction-ring"')).toHaveLength(2);
      expect(rawPaths(mounted).at(-1)).toEqual(rawPaths(baseline.icons['arrow-down-circle'].outline.rawSvg).at(-1));
      expect(group.compileStateEffect(state, { duration: 300 }).effect.unchangedPartIds).toEqual(['direction-ring']);
      expect(Object.hasOwn(group.stateCapabilities().states.find(member => member.id === state), 'staticSharedSvg')).toBe(false);
    }
    expect(payload.states.find(member => member.id === 'back').staticSharedSvg).toBeDefined();
    expect(Object.hasOwn(payload.states.find(member => member.id === 'down'), 'staticSharedSvg')).toBe(false);
  });

  it.each(['forward', 'up'])('%s с точным master остаётся ENCLOSURE_MISMATCH', direction => {
    expect(() => compile(baseline, directionDocument(['back', 'down', direction])))
      .toThrow(expect.objectContaining({ code: 'ENCLOSURE_MISMATCH' }));
  });

  it('изменение control point ниже точности Number остаётся ENCLOSURE_MISMATCH', () => {
    const source = structuredClone(baseline), input = directionDocument();
    repin(source, input, 'down', svg => svg.replace('C22.4999 17.7988', 'C22.499900000000000000000000001 17.7988'), 'direction-witness');
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'ENCLOSURE_MISMATCH' }));
  });

  it('общая content часть suffix допускает exact spelling и сохраняет raw static SVG', () => {
    const source = structuredClone(baseline), input = structuredClone(document);
    repin(source, input, 'smile', svg => {
      let index = 0;
      return svg.replace(/<path\b[^>]*>/g, tag => index++ === 1
        ? tag.replace(/\bd="([^"]+)"/, (_, d) => `d="${d.replaceAll(' ', '  ')}"`) : tag);
    }, 'expression-face');
    const compiled = createCompiledStateGroup(compile(source, input)['expression-face']);
    expect(rawPaths(compiled.render('smile').svg)).toEqual(rawPaths(source.icons.smile.outline.rawSvg));
    expect(() => verifyInstalledStateGroup(compiled, statePackageExpectations(source, input)['expression-face'])).not.toThrow();
  });

  it('неподдержанный H/V fallback сохраняет тип отказа; literal H/V остаётся допустимым', () => {
    const source = structuredClone(baseline), input = directionDocument();
    const replaceRing = d => svg => {
      let index = 0;
      return svg.replace(/<path\b[^>]*>/g, tag => index++ === 1 ? tag.replace(/\bd="[^"]+"/, `d="${d}"`) : tag);
    };
    repin(source, input, 'back', replaceRing('M0 0L10 0L10 10L0 10Z'), 'direction-witness');
    repin(source, input, 'down', replaceRing('M0 0H10V10H0Z'), 'direction-witness');
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'ENCLOSURE_MISMATCH' }));
    repin(source, input, 'back', replaceRing('M0 0H10V10H0Z'), 'direction-witness');
    expect(() => compile(source, input)).not.toThrow();
  });

  it.each(['back', 'down', 'forward', 'up'])('Filled %s compound не разбивается для admission', direction => {
    expect(rawPaths(baseline.icons[`arrow-${direction}-circle`].filled.rawSvg)).toHaveLength(1);
    const input = directionDocument(['back', 'down', 'forward', 'up'], 'filled');
    const members = input.groups['direction-witness'].states;
    input.groups['direction-witness'].states = { a: members[direction], down: members[direction === 'down' ? 'back' : 'down'] };
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('геометрически равная последняя prefix path требует shared anatomy при другом spelling', () => {
    const source = structuredClone(baseline), input = structuredClone(document);
    input.groups['expression-face'].sharedParts = [{ id: 'face-enclosure', role: 'container' }];
    for (const [state, member] of Object.entries(input.groups['expression-face'].states)) {
      member.contentPartIds.push(`${state}-left-eye`, `${state}-right-eye`);
    }
    repin(source, input, 'smile', svg => {
      let index = 0;
      return svg.replace(/<path\b[^>]*>/g, tag => index++ === 2
        ? tag.replace(/\bd="([^"]+)"/, (_, d) => `d="${d.replaceAll(' ', '  ')}"`) : tag);
    }, 'expression-face');
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'SHARED_PART_UNDECLARED' }));
  });
});

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

describe('enclosure.replace: необъявленный общий рисунок во всём prefix', () => {
  const square = 'M10 5L11 5L11 6L10 6Z';
  const reversed = 'M11 5L10 5L10 6L11 6Z';
  const unique = ['M4 5L5 5L5 6L4 6Z', 'M6 5L7 5L7 6L6 6Z', 'M14 5L15 5L15 6L14 6Z'];

  function witness(position, repeated, spelling = 'literal') {
    const source = structuredClone(baseline), input = structuredClone(document);
    const groupSpec = input.groups['expression-face'];
    for (const [index, state] of ['aloof', 'sad', 'smile'].entries()) {
      const placement = position === 'mixed' ? state === 'aloof' ? 'first' : 'middle' : position;
      const common = repeated.includes(state) ? spelling === 'exact' && state === 'sad' ? reversed : square : unique[index];
      const commonTag = `<path d="${common}" fill="#101012"/>`;
      const lastTag = `<path d="${unique[index]}" fill="#101012"/>`;
      groupSpec.states[state].contentPartIds = placement === 'first'
        ? [`${state}-extra`, `${state}-mouth`] : [`${state}-mouth`, `${state}-extra`, `${state}-tail`];
      repin(source, input, state, svg => {
        let path = 0;
        return svg.replace(/<path\b[^>]*>/g, tag => path++ === 0
          ? placement === 'first' ? commonTag + tag : tag + commonTag + lastTag : tag);
      }, 'expression-face');
    }
    return { source, input };
  }

  it.each(['first', 'middle'].flatMap(position => ['all', 'subset'].flatMap(scope =>
    ['literal', 'exact'].map(spelling => [position, scope, spelling]))))
  ('%s prefix: общий рисунок %s states, %s spelling требует SHARED_PART_UNDECLARED', (position, scope, spelling) => {
    const { source, input } = witness(position, scope === 'all' ? ['aloof', 'sad', 'smile'] : ['aloof', 'sad'], spelling);
    const prefix = Object.values(input.groups['expression-face'].states).map(member =>
      rawPaths(source.icons[member.icon].outline.rawSvg).slice(0, member.contentPartIds.length));
    if (scope === 'subset') {
      // Независимый fixture oracle сравнивает четыре вершины прямых квадратов.
      // Всеобщая intersection пуста даже при другом start/reversal у sad.
      const vertexSets = prefix.map(parts => parts.filter(part => /^M[\d .]+(?:L[\d .]+){3}Z$/.test(part.d)).map(part => {
        const values = part.d.match(/\d+(?:\.\d+)?/g);
        return [0, 2, 4, 6].map(index => values.slice(index, index + 2).join(',')).sort().join(';');
      }));
      expect(vertexSets[0].filter(vertices => vertexSets.every(sets => sets.includes(vertices)))).toHaveLength(0);
    }
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'SHARED_PART_UNDECLARED' }));
  });

  it.each(['literal', 'exact'])('один рисунок на разных prefix indices, %s spelling, требует отказа', spelling => {
    const { source, input } = witness('mixed', ['aloof', 'sad'], spelling);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'SHARED_PART_UNDECLARED' }));
  });

  it('настоящая decimal разница ниже точности Number не становится общей частью', () => {
    const { source, input } = witness('first', ['aloof', 'sad']);
    repin(source, input, 'sad', svg => svg.replace(`d="${square}"`, 'd="M10.00000000000000000000001 5L11 5L11 6L10 6Z"'), 'expression-face');
    expect(() => compile(source, input)).not.toThrow();
  });

  it('различные prefix parts и authored повтор внутри одной группы сохраняют static путь', () => {
    const { source, input } = witness('middle', []);
    const compiled = createCompiledStateGroup(compile(source, input)['expression-face']);
    for (const state of ['aloof', 'sad', 'smile']) {
      expect(rawPaths(compiled.render(state).svg)).toEqual(rawPaths(source.icons[state].outline.rawSvg));
    }
    // В aloof extra/tail совпадают внутри одной opacity-группы: это raw multiplicity.
    const paths = rawPaths(source.icons.aloof.outline.rawSvg);
    expect(paths[1]).toEqual(paths[2]);
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
