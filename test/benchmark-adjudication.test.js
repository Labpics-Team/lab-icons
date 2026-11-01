import { describe, expect, it } from 'vitest';
import { assessCount, assessQuantile, calibrateNoRegression, quantileInterval, quantileRatio } from '../scripts/bench/adjudication.js';

const copies = (value, count = 96) => Array(count).fill(value);

describe('confidence admission benchmark', () => {
  it('сохраняет точный binomial sign interval для median: n=6, coverage 31/32', () => {
    // P(все ниже или все выше median) = 2 / 2^6 < 0.05.
    expect(quantileInterval([1, 2, 3, 4, 5, 6], 0.5)).toMatchObject({ lowerRank: 1, upperRank: 6, lower: 1, upper: 6 });
    expect(quantileInterval([1, 2, 3, 4, 5], 0.5).upper).toBeNull();
  });
  it('три удачных повтора не доказывают p95 improvement', () => {
    expect(assessQuantile(copies(10, 3), copies(1, 3), 0.8, { quantile: 0.95 })).toMatchObject({ verdict: 'INCOMPLETE', upper: null });
    // p95^n > 0.0125: даже максимум не даёт нужную marginal upper bound.
    expect(quantileRatio(copies(10, 85), copies(1, 85), { quantile: 0.95 }).upper).toBeNull();
    expect(assessQuantile(copies(10, 86), copies(1, 86), 0.8, { quantile: 0.95 }).verdict).toBe('PASS');
  });
  it('достоверные +20% warm и +30% state latency остаются FAIL при любом bundle', () => {
    expect(assessQuantile(copies(10), copies(12), 1.05).verdict).toBe('FAIL');
    expect(assessQuantile(copies(10), copies(13), 1.05, { quantile: 0.95 }).verdict).toBe('FAIL');
    expect(assessQuantile(copies(10), copies(8), 0.8, { quantile: 0.95 }).verdict).toBe('PASS');
  });
  it('uncertain interval не становится доказанной регрессией или PASS', () => {
    expect(assessQuantile([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8], 1.05).verdict).toBe('INCOMPLETE');
  });
  it('доказанная нижней границей регрессия не требует finite upper bound', () => {
    expect(assessQuantile(copies(10), copies(100, 3), 1.05, { quantile: 0.95 })).toMatchObject({ verdict: 'FAIL', lower: 10, upper: null });
  });
  it('calibration не принимает шум более 5% и не смотрит candidate', () => {
    expect(calibrateNoRegression(copies(10), copies(10))).toMatchObject({ verdict: 'PASS', tolerance: 0 });
    expect(calibrateNoRegression(copies(10), copies(11))).toMatchObject({ verdict: 'INCOMPLETE', tolerance: null, reason: 'CALIBRATION_EXCEEDS_FIVE_PERCENT' });
    expect(calibrateNoRegression(copies(10, 3), copies(10, 3))).toMatchObject({ verdict: 'INCOMPLETE', tolerance: null });
  });
  it('calibration сохраняет точную границу5% без floating subtraction refusal', () => {
    expect(calibrateNoRegression(copies(10), copies(10.5))).toMatchObject({ verdict: 'PASS', tolerance: 0.05 });
    expect(calibrateNoRegression(copies(10), copies(10.5001)).verdict).toBe('INCOMPLETE');
  });
  it('zero counts остаются zero; ниже resolution speedup не заявляется', () => {
    expect(assessCount(0, 0)).toMatchObject({ verdict: 'PASS', ratio: null });
    expect(assessCount(0, 1)).toMatchObject({ verdict: 'FAIL', ratio: null });
    expect(assessCount(100, 106, 1.05).verdict).toBe('FAIL');
    expect(assessQuantile(copies(0), copies(0), 0.8).verdict).toBe('INCOMPLETE');
    expect(assessQuantile(copies(0.01), copies(0.005), 0.8, { resolution: 0.1 })).toMatchObject({ verdict: 'INCOMPLETE', reason: 'BELOW_CLOCK_RESOLUTION' });
  });
  it('не удаляет invalid samples и не сериализует Infinity как ложную границу', () => {
    for (const input of [[1, NaN], [1, Infinity], [1, -1], Array(3), [1]]) expect(() => quantileInterval(input, 0.95)).toThrow();
    expect(() => quantileInterval([1, 2], 1)).toThrow();
    expect(() => quantileRatio([1, 2], [1, 2], { confidence: 1 })).toThrow();
    const encoded = JSON.parse(JSON.stringify(quantileRatio([1, 2], [1, 2], { quantile: 0.95 })));
    expect(encoded).toMatchObject({ upper: null, reason: 'INSUFFICIENT_TAIL_OR_ZERO_BASELINE' });
  });
  it('order и scale не меняют ratio или admission', () => {
    const baseline = Array.from({ length: 96 }, (_, index) => 100 + index / 1000);
    const candidate = baseline.map(value => value * 0.5);
    const before = assessQuantile(baseline, candidate, 0.8, { quantile: 0.95 });
    const after = assessQuantile(baseline.toReversed().map(value => value * 7), candidate.toReversed().map(value => value * 7), 0.8, { quantile: 0.95 });
    expect(after.verdict).toBe(before.verdict);
    expect(after.upper).toBeCloseTo(before.upper, 12);
    expect(baseline[0]).toBe(100);
  });
});
