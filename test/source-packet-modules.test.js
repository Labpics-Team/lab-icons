import { describe, expect, it } from 'vitest';
import { gzipSync } from 'fflate';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';
import { renderSymbolModules, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { sourcePacketEligible, sourcePacketRuntimeTargets, translationCyclePacket } from '../scripts/lib/source-packet.js';
import { readFileSync } from 'node:fs';

const ceilings = { notifications: 4165, 'notifications-unread': 5034 };
const inputs = await authoredSymbolPayloads(Object.keys(ceilings));
const root = fileURLToPath(new URL('..', import.meta.url));

async function consume(input, entry = 'export { glyph,glyphCapabilities,outline,filled } from "packet";', transform = value => value) {
  const output = await build({ stdin: { contents: entry }, bundle: true, write: false, minify: true, format: 'esm', platform: 'browser',
    target: 'es2022', logLevel: 'silent', metafile: true, plugins: [{ name: 'closed-source-packet-control', setup(plugin) {
      plugin.onResolve({ filter: /^packet$/ }, () => ({ path: 'symbol', namespace: 'packet', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'packet' }, () => ({ contents: transform(renderSymbolModules(input).symbol), loader: 'js' }));
      plugin.onResolve({ filter: /(?:source-packet|symbol)-runtime\.js$/ }, args => ({ path:
        fileURLToPath(new URL(`../src/ir/${args.path.split('/').at(-1).replace('.js', '.ts')}`, import.meta.url)) }));
    } }] });
  const text = output.outputFiles[0].text;
  return { text, module: await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`), metafile: output.metafile };
}

const freezeCheck = value => {
  if (value !== null && typeof value === 'object') {
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) freezeCheck(child);
  }
};

describe('целый source/cycle packet сохраняет действующие package границы', () => {
  for (const [icon, input] of Object.entries(inputs)) it(`${icon}: compiler output закрывает прежний gzip ceiling`, () => {
    const module = renderSymbolModules(input).symbol;
    expect(gzipSync(Buffer.from(module), { level: 9, mtime: 0 }).length).toBeLessThanOrEqual(ceilings[icon]);
    expect(module).toContain("../ir/source-packet-runtime.js");
  });

  for (const [icon, input] of Object.entries(inputs)) it(`${icon}: настоящий runtime сохраняет exact snapshots, alias и отказы`, async () => {
    const original = JSON.stringify(input), { module } = await consume(input);
    for (const variant of ['outline', 'filled']) {
      const glyph = module.glyph({ variant }), caps = module.glyphCapabilities(variant);
      expect(JSON.stringify(glyph)).toBe(JSON.stringify(input.source[variant]));
      expect(JSON.stringify(caps)).toBe(JSON.stringify(input.capabilities[variant]));
      expect(module[variant]).toBe(input.staticSvg[variant]);
      expect(glyph.provenance.author).toBe(caps.author); expect(glyph.provenance.anatomy).toBe(caps.anatomy);
      freezeCheck(glyph); freezeCheck(caps);
      for (const part of glyph.parts) {
        expect(part.provenance).not.toBe(glyph.provenance);
        expect(part.paint).not.toBe(glyph.parts.find(other => other !== part)?.paint);
      }
    }
    expect(module.glyph()).toBe(module.glyph()); expect(module.glyph()).not.toBe(module.glyph({ variant: 'filled' }));
    expect(module.glyph().provenance.author).not.toBe(module.glyph({ variant: 'filled' }).provenance.author);
    const request = { get variant() { expect(this).toBe(request); return 'outline'; } };
    expect(module.glyph(request)).toBe(module.glyph());
    for (const request of [{ axes: { weight: 1 } }, { modelMode: 'allow-candidate' }]) {
      expect(() => module.glyph(request)).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    }
    expect(() => module.glyph({ variation: {} })).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    expect(JSON.stringify(input)).toBe(original);
  });

  it('static consumer удаляет обе semantic factories и private helper целиком', async () => {
    const input = inputs.notifications;
    const { text, module, metafile } = await consume(input, 'import {outline} from "packet";export const result=outline;');
    expect(module.result).toBe(input.staticSvg.outline);
    expect(text).not.toContain('sourceFingerprint'); expect(text).not.toContain('gesture-ready');
    expect(text).not.toContain(input.source.outline.provenance.author.nodeSha256);
    const retained = Object.values(metafile.outputs).flatMap(output => Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file));
    expect(retained.some(file => file.includes('src/ir/'))).toBe(false);
    const sentinel = 'PACKET_PRIVATE_HELPER_SENTINEL';
    const { text: staticControl } = await consume(input, 'import {outline} from "packet";export const result=outline;',
      module => module.replace('materializeSourceV1(', `materializeSourceV1(${JSON.stringify(sentinel)},`));
    expect(staticControl).not.toContain(sentinel);
  });

  it('literal glyph consumer не удерживает packet runtime при допустимом extension', async () => {
    const input = structuredClone(inputs.notifications);
    input.source.outline.extra = 'future-source-extension';
    const { module, metafile } = await consume(input, 'export {glyph} from "packet";');
    expect(JSON.stringify(module.glyph())).toBe(JSON.stringify(input.source.outline));
    const retained = Object.values(metafile.outputs).flatMap(output => Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file));
    expect(retained.some(file => file.endsWith('src/ir/symbol-runtime.ts'))).toBe(true);
    expect(retained.some(file => file.endsWith('src/ir/source-packet-runtime.ts'))).toBe(false);
  });

  it('снятие PURE с source materialization удерживает геометрию в caps и ловится контролем', async () => {
    const input = inputs.notifications;
    const entry = 'import {glyphCapabilities} from "packet";export const result=glyphCapabilities();';
    const current = await consume(input, entry), sabotage = await consume(input, entry,
      module => module.replaceAll('/* @__PURE__ */ (() => materializeSourceV1', '(() => materializeSourceV1'));
    expect(current.text).not.toContain(input.source.outline.parts[0].d);
    expect(sabotage.text).toContain(input.source.outline.parts[0].d);
    expect(sabotage.text.length).toBeGreaterThan(current.text.length * 2);
  });

  for (const [label, mutate] of Object.entries({
    extraSource: input => { input.source.outline.extra = 'extension'; },
    reorderedSource: input => { const d = input.source.outline.d; delete input.source.outline.d; input.source.outline.d = d; },
    foreignPaint: input => { input.source.outline.parts[0].paint.fill = '#abc'; },
    fingerprint: input => { input.source.outline.parts[0].provenance.artifactFingerprint = 'different'; },
    missingAnatomy: input => { delete input.source.outline.provenance.anatomy; },
    alternateStops: input => { input.capabilities.outline.motion.gestures[0].tracks[0].stops[2].value *= 0.8; },
    reorderedMotion: input => { const tracks = input.capabilities.outline.motion.tracks; delete input.capabilities.outline.motion.tracks; input.capabilities.outline.motion.tracks = tracks; },
    otherAdapter: input => { input.capabilities.outline.motion.adapters.lottie = 'not-exported'; },
    gestureExtension: input => { input.capabilities.outline.motion.gestures[0].extension = 'preserve'; },
    specialKey: input => { Object.defineProperty(input.source.outline.parts[0], '__proto__', { value: { extra: true }, enumerable: true }); },
  })) it(`${label}: нарушенное отношение оставляет точные literal данные`, async () => {
    const input = JSON.parse(JSON.stringify(inputs.notifications)); mutate(input);
    const output = renderSymbolModules(input).symbol;
    expect(output).not.toContain('source-packet-runtime.js');
    const { module } = await consume(input);
    expect(JSON.stringify(module.glyph())).toBe(JSON.stringify(input.source.outline));
    expect(JSON.stringify(module.glyphCapabilities())).toBe(JSON.stringify(input.capabilities.outline));
  });

  it('экстремальный amplitude без ненулевой половины не меняет signed zero через packet', () => {
    const input = JSON.parse(JSON.stringify(inputs.notifications));
    input.capabilities.outline.motion.gestures[0].tracks[0].stops[1].value = Number.MIN_VALUE;
    expect(translationCyclePacket(input.capabilities.outline.motion)).toBeNull();
  });

  it('packet source admission сохраняет независимые поля и не допускает другую композицию', () => {
    const input = JSON.parse(JSON.stringify(inputs.notifications));
    expect(sourcePacketEligible(input.source.outline, 'notifications', 'outline')).toBe(true);
    input.source.outline.composition = { kind: 'compound', fillRule: 'nonzero' };
    expect(sourcePacketEligible(input.source.outline, 'notifications', 'outline')).toBe(false);
  });

  it('target и release inventory следуют настоящему import, source-only не оставляет orphan', () => {
    const base = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));
    const outputs = Object.values(inputs).map(renderSymbolModules);
    const projection = symbolReleaseProjection(base, Object.keys(inputs), [], [], [], outputs);
    expect(sourcePacketRuntimeTargets(outputs)).toEqual([{ entry: 'src/ir/source-packet-runtime.ts', runtime: 'source-packet-runtime.js' }]);
    expect(projection.runtimeDependencies).toContain('dist/ir/source-packet-runtime.js');
    const plain = symbolReleaseProjection(base, ['fixture']);
    expect(plain.files).not.toContain('dist/ir/source-packet-runtime.js');
    expect(sourcePacketRuntimeTargets([{ symbol: 'export const svg="../ir/source-packet-runtime.js";' }])).toEqual([]);
  });
});
