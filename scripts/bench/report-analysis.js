import { assessCount, assessQuantile, quantileRatio } from './adjudication.js';

const BYTE_FIELDS = ['rawBytes', 'gzipBytes', 'brotliBytes'];
const QUANTILES = [0.5, 0.95];

function bytes(bundles, baselineLabel, candidateLabel, maximumRatio) {
  const baseline = bundles.find(row => row.label === baselineLabel);
  const candidate = bundles.find(row => row.label === candidateLabel);
  if (!baseline || !candidate) return { verdict: 'INCOMPLETE', reason: 'MISSING_BUNDLE_PAIR' };
  const metrics = Object.fromEntries(BYTE_FIELDS.map(field => [field, assessCount(baseline[field], candidate[field], maximumRatio)]));
  return { verdict: Object.values(metrics).every(value => value.verdict === 'PASS') ? 'PASS' : 'FAIL', metrics };
}

function cold(rows, baselineLabel, candidateLabel, maximumRatio) {
  const output = [];
  for (const baseline of rows.filter(row => row.label === baselineLabel)) {
    const candidate = rows.find(row => row.label === candidateLabel && row.count === baseline.count && row.slowdown === baseline.slowdown);
    if (!candidate || baseline.observations.length < 2 || candidate.observations.length < 2) {
      output.push({ count: baseline.count, slowdown: baseline.slowdown, verdict: 'INCOMPLETE', reason: 'MISSING_COLD_PAIR' });
      continue;
    }
    for (const quantile of QUANTILES) {
      const before = baseline.observations.map(row => row.coldImportToUsefulRenderMs);
      const after = candidate.observations.map(row => row.coldImportToUsefulRenderMs);
      output.push({ count: baseline.count, slowdown: baseline.slowdown, quantile,
        ...(maximumRatio === undefined ? quantileRatio(before, after, { quantile }) : assessQuantile(before, after, maximumRatio, { quantile })) });
    }
  }
  return output;
}

/** Это анализ наблюдённых conjuncts; отсутствующий qualification не становится PASS. */
export function analyzeConsumerReport(report) {
  const staticPairs = (report.staticPairs ?? []).map(pair => {
    const imported = pair.bundles.find(row => row.label === 'imported');
    const forbidden = imported?.retainedInputs?.filter(row => /(?:authoring|motion|catalog\.generated|symbol-runtime|compiler)\.(?:js|ts)$|[\\/]authoring[\\/]|[\\/]motion[\\/]/.test(row.file)) ?? null;
    return { icon: pair.icon, variant: pair.variant, artifact: pair.artifact, svgSha256: pair.svgSha256,
      byteOverhead: bytes(pair.bundles, 'literal', 'imported', 1.05),
      staticRuntime: forbidden === null ? { verdict: 'INCOMPLETE', reason: 'MISSING_RETAINED_GRAPH' } :
        { verdict: forbidden.length ? 'FAIL' : 'PASS', forbidden },
      // Для static cold overhead не вводится новый target: r14 задаёт здесь bytes.
      conditionalColdRatio: cold(pair.browser, 'literal', 'imported') };
  });
  const defaultGlyphBytes = (report.cases ?? []).filter(row => row.lane === 'current-author' && row.kind === 'glyph' && !row.candidateOnly && !row.axes)
    .map(row => ({ id: row.id, geometryAttribution: row.comparison?.attribution,
      bytes: bytes(row.bundles, 'baseline', 'candidate', 0.05) }));
  const comparableCold = (report.cases ?? []).filter(row => row.lane === 'retained-identical-output' && row.comparison?.sameGeometryComparison === true)
    .map(row => ({ id: row.id, conditionalInference: cold(row.browser.filter(value => value.count === 1), 'baseline', 'candidate', 0.8) }));
  const byteFailure = staticPairs.some(row => row.byteOverhead.verdict === 'FAIL' || row.staticRuntime.verdict === 'FAIL') ||
    defaultGlyphBytes.some(row => row.bytes.verdict === 'FAIL');
  return { version: 1, benchmarkVerdict: report.failure || byteFailure ? 'FAIL' : 'INCOMPLETE',
    staticPairs, defaultGlyphBytes, comparableCold,
    inferenceScope: 'Quantile bounds conditional on independent sampling; fresh contexts sharing a browser process do not establish it.',
    openObligations: ['Frozen independent-run protocol and baseline-only calibration before candidate outcomes',
      'Sufficient repetitions and clock-resolution qualification', 'Comparable warm/compile/CPU/DOM/memory and cleanup acceptance',
      'Head-only authored motion frame/resource budgets', 'Full fidelity/a11y/axes/refusal and constrained-hardware qualification'] };
}
