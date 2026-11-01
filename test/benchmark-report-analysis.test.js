import { describe, expect, it } from 'vitest';
import { analyzeConsumerReport } from '../scripts/bench/report-analysis.js';

const bundle = (label, size) => ({ label, rawBytes: size, gzipBytes: size, brotliBytes: size, retainedInputs: [{ file: '/installed/dist/symbols/accessibility.js', bytesInOutput: size }] });
const rows = label => [1, 4].map(slowdown => ({ label, count: 1, slowdown, observations: Array(3).fill({ coldImportToUsefulRenderMs: label === 'literal' ? 10 : 1 }) }));
const pair = variant => ({ icon: 'accessibility', variant, artifact: 'a'.repeat(64), svgSha256: 'b'.repeat(64),
  bundles: [bundle('literal', 100), bundle('imported', 100)], browser: [...rows('literal'), ...rows('imported')] });

describe('наблюдения не подменяют BENCH qualification', () => {
  it('matched static bytes могут пройти, но три cold repeats не закрывают fullBENCH', () => {
    const result = analyzeConsumerReport({ staticPairs: [pair('outline'), pair('filled')], cases: [] });
    expect(result.benchmarkVerdict).toBe('INCOMPLETE');
    expect(result.staticPairs.map(row => row.byteOverhead.verdict)).toEqual(['PASS', 'PASS']);
    expect(result.staticPairs[0].conditionalColdRatio.every(row => row.upper === null)).toBe(true);
    expect(result.openObligations.length).toBeGreaterThan(0);
  });
  it('не заменяет +6% bytes меньшим cold time и не прячет retained runtime', () => {
    const source = pair('outline');
    source.bundles[1] = bundle('imported', 106);
    expect(analyzeConsumerReport({ staticPairs: [source] }).benchmarkVerdict).toBe('FAIL');
    source.bundles[1] = bundle('imported', 100);
    source.bundles[1].retainedInputs.push({ file: '/installed/dist/ir/symbol-runtime.js', bytesInOutput: 1 });
    expect(analyzeConsumerReport({ staticPairs: [source] }).staticPairs[0].staticRuntime.verdict).toBe('FAIL');
  });
  it('не сравнивает geometry-confounded lane как cold speedup', () => {
    const changed = { id: 'current-author-time', lane: 'current-author', kind: 'glyph', comparison: { sameGeometryComparison: false, attribution: 'geometry-and-representation-confounded' },
      bundles: [bundle('baseline', 10000), bundle('candidate', 100)], browser: [...rows('baseline'), ...rows('candidate')] };
    const result = analyzeConsumerReport({ cases: [changed] });
    expect(result.defaultGlyphBytes[0].bytes.verdict).toBe('PASS');
    expect(result.comparableCold).toEqual([]);
  });
  it('пустой partial report и missing bundle не становятся PASS', () => {
    expect(analyzeConsumerReport({}).benchmarkVerdict).toBe('INCOMPLETE');
    const source = pair('outline');
    source.bundles = [];
    expect(analyzeConsumerReport({ staticPairs: [source] }).staticPairs[0].byteOverhead.verdict).toBe('INCOMPLETE');
    expect(analyzeConsumerReport({ failure: { message: 'consumer incomplete' } }).benchmarkVerdict).toBe('FAIL');
  });
});
