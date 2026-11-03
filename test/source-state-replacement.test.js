import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorStateGroups, renderStateGroupModule, stateGroupDeclaration, stateRuntimeBuildOptions } from '../scripts/lib/author-state-groups.js';
import { statePackageExpectations, verifyInstalledStateGroup } from '../scripts/lib/state-artifact-consumer.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { assembleGlyphFrame, assembleGlyphLayers } from '../src/ir/svg-assembly.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const captured = read('semantics/author-state-groups.json');
const document = { ...captured, groups: Object.fromEntries(Object.entries(captured.groups).filter(([, group]) => group.law === 'source.replace')) };
const groupNames = ['microphone', 'microphone-filled', 'microphone-presentation', 'microphone-presentation-filled',
  'plus-presentation', 'plus-presentation-filled', 'visibility', 'visibility-filled'];
const names = [...new Set(Object.values(document.groups).flatMap(group => Object.values(group.states).map(state => state.icon)))];
const manifest = read('semantics/figma-baseline.json');
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
const compile = () => compileAuthorStateGroups(baseline, document, { compiler, assembleGlyphFrame, assembleGlyphLayers });
const rawPaths = source => [...source.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));
const sha256 = value => createHash('sha256').update(value).digest('hex');
async function importGroup(payload) {
  const result = await build({ stdin: { contents: renderStateGroupModule(payload), loader: 'js', resolveDir: join(root, 'scripts/lib') },
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    ...stateRuntimeBuildOptions('src/states/source-runtime.ts'),
    plugins: [{ name: 'source-state-runtime', setup(plugin) {
      plugin.onResolve({ filter: /source-state-runtime\.js$/ }, () => ({ path: join(root, 'src/states/source-runtime.ts') }));
    } }],
  });
  return { api: await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`),
    source: result.outputFiles[0].text };
}

describe('точная замена авторских состояний', () => {
  it('source target не принимает отсутствующий или чужой compiler kind', async () => {
    for (const define of [{}, { __LAB_ICONS_REPLACEMENT_KIND__: '"enclosure-replacement"' }]) {
      const output = await build({ entryPoints: [join(root, 'src/states/source-runtime.ts')], bundle: true,
        write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent', define });
      await expect(import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`))
        .rejects.toThrow('source replacement build profile is required');
    }
  });

  it('все авторские state и presentation пары проходят общий закон без вымышленной оболочки', () => {
    expect(Object.keys(document.groups).sort()).toEqual([...groupNames].sort());
    const payloads = compile();
    for (const [name, payload] of Object.entries(payloads)) {
      expect(payload.proof.law).toBe('source.replace');
      expect(payload.enclosurePartId).toBeNull();
      expect(payload.proof.enclosureSha256).toBeNull();
      expect(payload.sharedPartIds).toEqual([]);
      expect(payload.sharedSvg).toBe('');
      for (const state of payload.states) {
        const member = document.groups[name].states[state.id];
        const author = baseline.icons[member.icon][member.variant];
        expect(rawPaths(state.contentSvg)).toEqual(rawPaths(author.rawSvg));
        expect(sha256(author.rawSvg)).toBe(member.masterSha256);
      }
    }
  });

  it.each(groupNames)('%s: endpoint, takeover, экспорт и отказ остаются одним installed протоколом', async name => {
    const payload = compile()[name];
    const { api, source } = await importGroup(payload);
    expect(Object.keys(api).sort()).toEqual(read('release/export-surface.json')[`./states/${name}`]);
    const expected = statePackageExpectations(baseline, document)[name];
    expect(() => verifyInstalledStateGroup(api, expected)).not.toThrow();
    const caps = api.stateCapabilities();
    expect(caps.transition).toBe('source-replacement');
    expect(caps.morph).toBe('unavailable');
    expect(caps.enclosurePartId).toBeNull();
    expect(caps.sharedPartIds).toEqual([]);
    for (const state of payload.states) {
      const effect = api.compileStateEffect(state.id, { duration: 180 });
      expect(effect.ok).toBe(true);
      expect(effect.effect.kind).toBe('source-replacement');
      expect(effect.effect.stages.every(stage => !Object.hasOwn(stage, 'from'))).toBe(true);
      expect(effect.effect.unchangedPartIds).toEqual([]);
      expect(effect.effect.stages.map(stage => stage.to)).toEqual(payload.states.map(member => member.id === state.id ? 1 : 0));
      for (const operation of [options => api.render(state.id, options), options => api.renderStateSvg(state.id, options),
        options => api.compileStateEffect(state.id, { duration: 180, ...options }),
        options => api.exportStateTransition(state.id, { format: 'web-effect', duration: 180, ...options })]) {
        expect(operation({ variation: { bodyWidth: 0.9 } }).reason.code).toBe('VARIATION_UNSUPPORTED');
        expect(operation({ variation: null }).reason.code).toBe('INVALID_REQUEST');
      }
    }
    expect(source).not.toContain('catalog.generated');
    expect(source).not.toContain('createGlyphCompiler');
    expect(source).not.toContain('@labpics/motion');
    expect(stateGroupDeclaration(document, name)).toContain('../ir/source-state-types.js');
  });
});
