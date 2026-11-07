import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { projectAuthorSourceContours } from '../scripts/lib/author-source-contours.js';
import { compileAuthorStateGroups, renderStateGroupModule, stateGroupDeclaration, stateRuntimeBuildOptions } from '../scripts/lib/author-state-groups.js';
import { statePackageExpectations, verifyInstalledStateGroup } from '../scripts/lib/state-artifact-consumer.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { assembleGlyphFrame, assembleGlyphLayers } from '../src/ir/svg-assembly.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const cases = [
  ['microphone-presentation', 'mic', 'mic-circle', 'outline'],
  ['microphone-presentation-filled', 'mic', 'mic-circle', 'filled'],
  ['plus-presentation', 'plus', 'plus-circle', 'outline'],
  ['plus-presentation-filled', 'plus', 'plus-circle', 'filled'],
];
const captured = read('semantics/author-state-groups.json');
const manifest = read('semantics/figma-baseline.json');
const names = ['mic', 'mic-circle', 'plus', 'plus-circle'];
// Только восемь независимых авторских masters; полный corpus здесь не компилируется.
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
function compilerFor(contracts = {}) { return createGlyphCompiler({
  catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon, {
      model: null, source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, contracts[`${icon}/${variant}`] ?? item.sourceContract])),
    }])),
  }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: Object.fromEntries(Object.entries(baseline.icons).flatMap(([icon, variants]) =>
    Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
}); }
const compiler = compilerFor();
const paths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));
const hash = value => createHash('sha256').update(value).digest('hex');
function productionSourceCompiler() {
  const declarations = read('semantics/author-anatomy.json');
  const contracts = Object.fromEntries(names.flatMap(icon => ['outline', 'filled'].map(variant => {
    const source = baseline.icons[icon][variant], declaration = declarations.icons[icon]?.[variant];
    if (!declaration) return [`${icon}/${variant}`, source.sourceContract];
    // Тот же production contour projection; ширина и её proof не меняются этим state admission.
    const parts = declaration.composition
      ? projectAuthorSourceContours(source, declaration.parts, declaration.composition,
        (code, message) => { throw Object.assign(new Error(message), { code }); })
      : source.sourceContract.parts.map((part, index) => {
        const annotation = declaration.parts.find(part => part.pathIndex === index);
        return { ...part, id: annotation.id, identity: 'declared', role: annotation.role };
      });
    return [`${icon}/${variant}`, { ...source.sourceContract, parts, ...(declaration.composition && { composition: declaration.composition }),
      anatomy: { version: 1, annotationSha256: hash(JSON.stringify(declaration)),
        masterSha256: source.author.masterSha256, pathFingerprintSha256: source.author.pathFingerprintSha256 }, gestures: [] }];
  })));
  return compilerFor(contracts);
}
const productionCompiler = productionSourceCompiler();
function compile(name, owner = compiler) {
  expect(captured.groups[name], `presentation ${name}`).toBeDefined();
  const document = { ...captured, groups: { [name]: captured.groups[name] } };
  return { document, payload: compileAuthorStateGroups(baseline, document,
    { compiler: owner, assembleGlyphFrame, assembleGlyphLayers })[name] };
}
async function publicModule(payload) {
  const output = await build({
    stdin: { contents: renderStateGroupModule(payload), loader: 'js', resolveDir: join(root, 'scripts/lib') },
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    ...stateRuntimeBuildOptions('src/states/source-runtime.ts'),
    plugins: [{ name: 'source-state-runtime', setup(plugin) {
      plugin.onResolve({ filter: /source-state-runtime\.js$/ }, () => ({ path: join(root, 'src/states/source-runtime.ts') }));
    } }],
  });
  const source = output.outputFiles[0].text;
  return { source, api: await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) };
}

describe('авторские plain/circle presentation пары', () => {
  it.each(cases)('%s: production contour anatomy сохраняет целую авторскую заливку', (name, plain, circle, variant) => {
    const glyph = productionCompiler.glyph({ icon: circle, variant, modelMode: 'source-only' });
    expect(paths(glyph.svg)).toEqual(paths(baseline.icons[circle][variant].rawSvg));
    if (glyph.composition.kind === 'compound') {
      expect(glyph.composition).toEqual({ kind: 'compound', fillRule: 'evenodd' });
      expect(glyph.parts).toHaveLength(3);
      expect(glyph.parts.map(part => part.fillRule)).toEqual([null, null, null]);
      expect(glyph.parts.map(part => part.d).join('')).toBe(glyph.d);
    }
    expect(compile(name, productionCompiler).payload).toEqual(compile(name).payload);
  });

  it.each([
    ['потерянный counter', glyph => { glyph.parts.pop(); }],
    ['изменённый counter', glyph => { glyph.parts[1].d += 'M0 0Z'; }],
    ['отдельная заливка counter', glyph => { glyph.parts[1].fillRule = 'evenodd'; }],
    ['цвет counter', glyph => { glyph.parts[1].paint.fill = '#ff00ff'; }],
    ['stroke counter', glyph => { glyph.parts[1].paint = { kind: 'stroke', strokeWidth: 1 }; }],
    ['положительный counter', glyph => { glyph.parts[1].role = 'content'; }],
    ['порядок contours', glyph => { [glyph.parts[1], glyph.parts[2]] = [glyph.parts[2], glyph.parts[1]]; glyph.parts.forEach((part, index) => { part.zIndex = index; }); }],
    ['подмена общего path', glyph => { glyph.d += 'M0 0Z'; }],
    ['потерянный receipt', glyph => { delete glyph.provenance.anatomy; }],
    ['чужой receipt', glyph => { glyph.provenance.anatomy.masterSha256 = 'a'.repeat(64); }],
    ['подмена fill owner', glyph => { glyph.composition.fillRule = 'nonzero'; }],
    ['слои вместо holes', glyph => { glyph.composition.kind = 'layers'; glyph.parts.forEach(part => { part.fillRule = 'evenodd'; }); }],
  ])('production compound: %s получает точный отказ', (_, mutate) => {
    const owner = { glyph(request) {
      const glyph = structuredClone(productionCompiler.glyph(request));
      if (request.icon === 'mic-circle' && request.variant === 'filled') mutate(glyph);
      return glyph;
    } };
    expect(() => compile('microphone-presentation-filled', owner)).toThrow(expect.objectContaining({ code: 'COMPILER_MISMATCH' }));
  });

  it.each(cases)('%s: точные независимые masters проходят существующий source закон', (name, plain, circle, variant) => {
    const { document, payload } = compile(name);
    expect(document.groups[name]).toMatchObject({ law: 'source.replace', defaultState: 'plain', sharedParts: [],
      states: { plain: { icon: plain, variant }, circle: { icon: circle, variant } } });
    expect(Object.keys(document.groups[name].states).sort()).toEqual(['circle', 'plain']);
    expect(payload).toMatchObject({ variant, defaultState: 'plain', sharedSvg: '', sharedPartIds: [], enclosurePartId: null,
      proof: { law: 'source.replace', enclosureSha256: null, source: document.source } });
    const ids = payload.states.flatMap(state => [state.partId, ...state.contentPartIds]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const state of payload.states) {
      const icon = state.id === 'plain' ? plain : circle;
      const master = baseline.icons[icon][variant];
      expect(paths(state.contentSvg)).toEqual(paths(master.rawSvg));
      expect(state.author.masterSha256).toBe(hash(master.rawSvg));
      expect(state.author.nodeId).toBe(manifest.icons[icon][variant].nodeId);
      expect(state.author.pathFingerprintSha256).toBe(manifest.icons[icon][variant].normalizedSource.pathFingerprintSha256);
      expect(paths(state.contentSvg)).toHaveLength(state.contentPartIds.length);
    }
  });

  it.each(cases)('%s: один публичный effect protocol сохраняет takeover и точные отказы', async (name, _plain, _circle, variant) => {
    const { document, payload } = compile(name);
    const { api, source } = await publicModule(payload);
    expect(Object.keys(api).sort()).toEqual(['compileStateEffect', 'exportStateTransition', 'render', 'renderStateSvg', 'stateCapabilities']);
    expect(() => verifyInstalledStateGroup(api, statePackageExpectations(baseline, document)[name])).not.toThrow();
    expect(api.stateCapabilities()).toMatchObject({ variant, morph: 'unavailable', transition: 'source-replacement', sharedPartIds: [] });
    for (const state of ['plain', 'circle', 'plain']) {
      const result = api.compileStateEffect(state, { duration: 180 });
      expect(result.ok).toBe(true);
      expect(result.effect.stages).toEqual(payload.states.map(member => ({ partId: member.partId,
        property: 'opacity', to: member.id === state ? 1 : 0, at: 0, duration: 180 })));
      // Executor начинает с текущей видимой смеси; новый target не содержит reset/from.
      expect(result.effect.stages.every(stage => !Object.hasOwn(stage, 'from'))).toBe(true);
      expect(result.effect.unchangedPartIds).toEqual([]);
    }
    expect(api.compileStateEffect('circle', { duration: 180, morph: true }).reason.code).toBe('INVALID_REQUEST');
    expect(api.render('plain', { variation: { bodyWidth: 0.9 } }).reason.code).toBe('VARIATION_UNSUPPORTED');
    expect(source).not.toContain('catalog.generated');
    expect(source).not.toContain('createGlyphCompiler');
    expect(source).not.toContain('@labpics/motion');
    expect(stateGroupDeclaration(document, name)).toContain('export type State = "circle" | "plain"');
  });
});
