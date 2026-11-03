import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
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
const compiler = createGlyphCompiler({
  catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon, {
      model: null, source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])),
    }])),
  }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: Object.fromEntries(Object.entries(baseline.icons).flatMap(([icon, variants]) =>
    Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
});
const paths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));
const hash = value => createHash('sha256').update(value).digest('hex');
function compile(name) {
  expect(captured.groups[name], `presentation ${name}`).toBeDefined();
  const document = { ...captured, groups: { [name]: captured.groups[name] } };
  return { document, payload: compileAuthorStateGroups(baseline, document,
    { compiler, assembleGlyphFrame, assembleGlyphLayers })[name] };
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
