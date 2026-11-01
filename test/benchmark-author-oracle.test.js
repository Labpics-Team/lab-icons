import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { authorPackageExpectations } from '../scripts/check-package-artifact.js';
import { inspectAuthorSvg, observeAuthorGlyph, sha256, stableJSON, validateAuthorAdmission, validateAuthorObservation, validateRetainedPair } from '../scripts/bench/author-oracle.js';

const root = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">';
const paths = [
  { id: 'source-first', role: 'unclassified', zIndex: 0, fillRule: 'evenodd', d: 'M2 2H22V22H2ZM7 7H17V17H7Z' },
  { id: 'source-second', role: 'unclassified', zIndex: 1, fillRule: 'nonzero', d: 'M10 10H14V14H10Z' },
];
const svg = (entries, ir = false) => root + entries.map(part => `<path${ir ? ` data-part="${part.id}" data-role="${part.role}"` : ''} fill-rule="${part.fillRule}" d="${part.d}"/>`).join('') + '</svg>';
const artifact = svg(paths);
const author = Object.freeze({ kind: 'figma', fileKey: 'file', version: 'version', nodeId: '1:2', masterSha256: sha256('raw master'), normalizedSha256: sha256('normalized'), pathFingerprintSha256: inspectAuthorSvg(artifact).pathFingerprintSha256 });
const expected = { icon: 'test', variant: 'outline', master: 'master.svg', author, artifactSha256: sha256(artifact), pathFingerprintSha256: author.pathFingerprintSha256, partsSha256: sha256(stableJSON(paths)) };
const observe = (entries = paths, rendered = svg(entries, true)) => ({ ...inspectAuthorSvg(rendered, { ir: true }), icon: 'test', variant: 'outline', sourceFile: 'master.svg', compositionKind: 'layers', author, staticArtifactSha256: sha256(artifact), parts: entries });

describe('benchmark author oracle и сохранённый output', () => {
  it.each(['reload/outline', 'reload/filled', 'refresh/outline', 'refresh/filled'])('принимает только проверенную анатомию current master: %s', id => {
    const rootPath = new URL('..', import.meta.url);
    const read = path => JSON.parse(readFileSync(new URL(path, rootPath), 'utf8'));
    const captured = read('semantics/figma-baseline.json');
    const baseline = loadAuthorBaseline(fileURLToPath(rootPath), { manifest: { ...captured, counts: { families: 2, variants: 4 }, icons: { reload: captured.icons.reload, refresh: captured.icons.refresh } } });
    const allAnnotations = read('semantics/author-anatomy.json');
    const annotations = { ...allAnnotations, icons: { reload: allAnnotations.icons.reload, refresh: allAnnotations.icons.refresh } };
    const contracts = compileAuthorAnatomy(baseline, annotations);
    const [icon, variant] = id.split('/');
    const sources = Object.fromEntries(Object.entries(baseline.icons[icon]).map(([name, record]) => [name, { ...record, sourceContract: contracts[`${icon}/${name}`] }]));
    const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes, icons: { [icon]: { model: null, source: { outline: sources.outline.sourceContract, filled: sources.filled.sourceContract } } } }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'), staticIcons: Object.fromEntries(Object.entries(sources).map(([name, record]) => [`${icon}${name === 'outline' ? 'Outline' : 'Filled'}`, record.artifactSvg])) });
    const symbol = createCompiledSymbol(authorSymbolPayload(icon, sources, compiler));
    const record = sources[variant];
    const glyph = symbol.glyph({ variant });
    const metadata = record.sourceContract.parts.map(({ id, role }) => ({ id, role }));
    expect(metadata).toEqual([{ id: 'cycle-body', role: 'control' }]);
    const observation = observeAuthorGlyph(glyph, record.artifactSvg);
    const original = inspectAuthorSvg(record.artifactSvg);
    const expected = { icon, variant, master: record.master, author: record.author, anatomy: record.sourceContract.anatomy, artifactSha256: sha256(record.artifactSvg), pathFingerprintSha256: record.author.pathFingerprintSha256, partsSha256: sha256(stableJSON(record.sourceContract.parts.map((part, index) => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: original.paths[index].d })))) };
    expect(() => validateAuthorObservation(observation, expected)).not.toThrow();
    const changedAfterMeasurement = { ...glyph, svg: glyph.svg.replace('data-role="control"', 'data-role="content"') };
    expect(observeAuthorGlyph(changedAfterMeasurement, record.artifactSvg, glyph.svg)).toEqual(observation);
    expect(() => inspectAuthorSvg(glyph.svg, { ir: true })).toThrow(/semantic anatomy/);
    expect(() => inspectAuthorSvg(glyph.svg.replace('data-role="control"', 'data-role="content"'), { ir: true, expectedMetadata: metadata })).toThrow();
    expect(() => observeAuthorGlyph({ ...glyph, svg: glyph.svg.replace('data-role="control"', 'data-role="content"') }, record.artifactSvg)).toThrow();
    expect(() => validateAuthorObservation(observeAuthorGlyph({ ...glyph, provenance: { ...glyph.provenance, anatomy: undefined } }, record.artifactSvg), expected)).toThrow(/anatomy/);
    expect(() => validateAuthorObservation({ ...observation, anatomy: { ...observation.anatomy, annotationSha256: 'a'.repeat(64) } }, expected)).toThrow(/anatomy/);
    const caps = symbol.glyphCapabilities(variant);
    expect(() => validateAuthorAdmission(glyph, caps, record, record.sourceContract)).not.toThrow();
    expect(() => validateAuthorAdmission(glyph, { ...caps, anatomy: { ...caps.anatomy, masterSha256: 'a'.repeat(64) } }, record, record.sourceContract)).toThrow(/capabilities|anatomy/);
    expect(() => validateAuthorAdmission({ ...glyph, parts: glyph.parts.map(part => ({ ...part, provenance: { ...part.provenance, identity: 'source-derived' } })) }, caps, record, record.sourceContract)).toThrow(/identity/);
    expect(() => validateAuthorAdmission({ ...glyph, parts: glyph.parts.map(part => ({ ...part, anchor: [0.6, 0.5] })) }, caps, record, record.sourceContract)).toThrow(/anchor/);
    expect(() => validateAuthorAdmission(glyph, { ...caps, motion: { ...caps.motion, gestures: [] } }, record, record.sourceContract)).toThrow(/capabilities/);
    const packed = authorPackageExpectations(baseline, annotations)[icon][variant];
    expect(packed.parts).toHaveLength(1);
    expect(packed.parts[0]).toMatchObject({ id: 'cycle-body', identity: 'declared', role: 'control', anchor: [0.5, 0.5], anchorSource: 'declared', d: original.paths[0].d, sourceFingerprint: baseline.icons[icon][variant].sourceContract.parts[0].sourceFingerprint });
    expect(packed.anatomy).toEqual(expected.anatomy);
    expect(packed.motion).toEqual({ ...caps.motion, adapters: { ...caps.motion.adapters, lottie: 'lottie-web-svg-5.13' } });
    expect(glyph.parts[0].provenance.identity).toBe('declared');
    expect(caps).toMatchObject({ modelState: null, supportedAxes: [], axes: {}, anatomy: expected.anatomy, motion: { state: 'gesture-ready', partIds: ['cycle-body'], gestures: [{ id: `${icon}.cycle` }] } });
    expect(compileSymbolEffect(glyph, caps, `${icon}.cycle`, { duration: 360 })).toMatchObject({ ok: true, effect: { targets: [{ partId: 'cycle-body', keyframes: [{ offset: 0, transform: 'rotate(0deg)' }, { offset: 1, transform: 'rotate(360deg)' }] }] } });
    expect(compileSymbolEffect(glyph, caps, 'time.advance', { duration: 360 })).toMatchObject({ ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
    for (const query of [{ variant, axes: { weight: 1.1 } }, { variant, modelMode: 'allow-candidate' }]) expect(() => symbol.glyph(query)).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
  });
  it('oracle принимает обе реальные time формы latest Figma через production source compiler', () => {
    const rootPath = new URL('..', import.meta.url);
    const read = path => JSON.parse(readFileSync(new URL(path, rootPath), 'utf8'));
    const captured = read('semantics/figma-baseline.json');
    const master = loadAuthorBaseline(fileURLToPath(rootPath), { manifest: { ...captured, counts: { families: 1, variants: 2 }, icons: { time: captured.icons.time } } });
    const source = master.icons.time;
    const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes, icons: { time: { model: null, source: { outline: source.outline.sourceContract, filled: source.filled.sourceContract } } } }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'), staticIcons: { timeOutline: source.outline.artifactSvg, timeFilled: source.filled.artifactSvg } });
    const symbol = createCompiledSymbol(authorSymbolPayload('time', source, compiler));
    for (const variant of ['outline', 'filled']) {
      const record = source[variant];
      const original = inspectAuthorSvg(record.artifactSvg);
      const actual = symbol.glyph({ variant });
      const expected = { icon: 'time', variant, master: record.master, author: record.author, artifactSha256: sha256(record.artifactSvg), pathFingerprintSha256: record.normalizedSource.pathFingerprintSha256, partsSha256: sha256(stableJSON(record.sourceContract.parts.map((part, index) => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: original.paths[index].d })))) };
      const observation = { ...inspectAuthorSvg(actual.svg, { ir: true }), icon: actual.icon, variant: actual.variant, sourceFile: actual.provenance.file, compositionKind: actual.composition.kind, author: actual.provenance.author, staticArtifactSha256: sha256(record.artifactSvg), parts: actual.parts.map(({ id, role, zIndex, fillRule, d }) => ({ id, role, zIndex, fillRule, d })) };
      expect(() => validateAuthorObservation(observation, expected)).not.toThrow();
      expect(() => validateAuthorAdmission(actual, symbol.glyphCapabilities(variant), record, record.sourceContract)).not.toThrow();
      expect(compileSymbolEffect(actual, symbol.glyphCapabilities(variant), 'time.advance', { duration: 360 })).toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    }
  });
  it('принимает независимую XML обвязку с теми же contours, winding и part identity', () => {
    expect(() => validateAuthorObservation(observe(), expected)).not.toThrow();
    expect(inspectAuthorSvg(artifact).complexity.paths).toBe(2);
  });
  it.each([
    ['координата', entries => entries.map((part, index) => index ? part : { ...part, d: part.d.replace('M2 2', 'M3 2') })],
    ['countershape winding', entries => entries.map((part, index) => index ? part : { ...part, fillRule: 'nonzero' })],
    ['z-order', entries => [...entries].reverse().map((part, index) => ({ ...part, zIndex: index }))],
    ['stable part ID', entries => entries.map((part, index) => index ? part : { ...part, id: 'different' })],
  ])('отвергает дрейф current author: %s', (_, mutate) => {
    expect(() => validateAuthorObservation(observe(mutate(paths)), expected)).toThrow();
  });
  it('отвергает renderer с неверным data-part даже при правильном IR parts', () => {
    const rendered = svg(paths, true).replace('data-part="source-first"', 'data-part="wrong"');
    expect(() => validateAuthorObservation(observe(paths, rendered), expected)).toThrow(/identity/);
  });
  it('закрытый output oracle не теряет opacity, transform или ложную semantic role', () => {
    expect(() => inspectAuthorSvg(svg(paths, true).replace('data-role="unclassified"', 'data-role="content"'), { ir: true })).toThrow();
    expect(() => inspectAuthorSvg(svg(paths, true).replace('<path', '<path opacity="0.5"'), { ir: true })).toThrow();
    expect(() => inspectAuthorSvg(svg(paths, true).replace('<path', '<path transform="translate(1)"'), { ir: true })).toThrow();
  });
  it('explicit metadata не разрешает пропавшие или добавленные paths и не снимает geometry guards', () => {
    const metadata = paths.map(({ id, role }) => ({ id, role }));
    expect(() => inspectAuthorSvg(svg(paths.slice(0, 1), true), { ir: true, expectedMetadata: metadata })).toThrow(/anatomy/);
    expect(() => inspectAuthorSvg(svg(paths, true), { ir: true, expectedMetadata: metadata.slice(0, 1) })).toThrow(/anatomy/);
    expect(() => inspectAuthorSvg(svg(paths, true).replace('<path', '<path opacity="0.5"'), { ir: true, expectedMetadata: metadata })).toThrow();
    expect(() => inspectAuthorSvg(svg(paths, true).replace('<path', '<path transform="translate(1)"'), { ir: true, expectedMetadata: metadata })).toThrow();
  });
  it('не принимает самообъявленный provenance другого file/version/master', () => {
    expect(() => validateAuthorObservation({ ...observe(), author: { ...author, version: 'other' } }, expected)).toThrow(/manifest/);
    expect(() => validateAuthorObservation({ ...observe(), staticArtifactSha256: sha256('other output') }, expected)).toThrow(/manifest/);
  });
  it('сохраняет exact SVG equality guard retained lane при новой author geometry', () => {
    const sample = { svgSha256: sha256(artifact), completedBytes: artifact.length, completed: 1 };
    expect(() => validateRetainedPair(sample, { ...sample })).not.toThrow();
    expect(() => validateRetainedPair(sample, { ...sample, svgSha256: sha256(artifact.replace('M2 2', 'M3 2')) })).toThrow(/retained/);
    expect(() => validateRetainedPair(sample, { ...sample, completed: 0 })).toThrow(/retained/);
  });
});
