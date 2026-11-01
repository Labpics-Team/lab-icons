import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { inspectAuthorSvg, sha256, stableJSON, validateAuthorObservation, validateRetainedPair } from '../scripts/bench/author-oracle.js';

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
