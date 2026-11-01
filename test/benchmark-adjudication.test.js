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
    const result = assessQuantile(copies(10), copies(100, 3), 1.05, { quantile: 0.95 });
    expect(result).toMatchObject({ verdict: 'FAIL', upper: null });
    expect(result.lower).toBeCloseTo(10);
  });
  it('calibration не принимает шум более 5% и не смотрит candidate', () => {
    const identical = calibrateNoRegression(copies(10), copies(10));
    expect(identical.verdict).toBe('PASS');
    expect(identical.tolerance).toBeLessThan(1e-15);
    expect(calibrateNoRegression(copies(10), copies(11))).toMatchObject({ verdict: 'INCOMPLETE', tolerance: null, reason: 'CALIBRATION_EXCEEDS_FIVE_PERCENT' });
    expect(calibrateNoRegression(copies(10, 3), copies(10, 3))).toMatchObject({ verdict: 'INCOMPLETE', tolerance: null });
  });
  it('calibration сохраняет точную границу5% без floating subtraction refusal', () => {
    expect(calibrateNoRegression(copies(10), copies(10.5))).toMatchObject({ verdict: 'PASS', tolerance: 0.05 });
    expect(calibrateNoRegression(copies(10), copies(10.5001)).verdict).toBe('INCOMPLETE');
    // binary64 значение1.05 строго больше точного21/20; clipping не скрывает его.
    expect(calibrateNoRegression(copies(1), copies(1.05)).verdict).toBe('INCOMPLETE');
    expect(assessCount(8500000000000019, 8925000000000020, 1.05).verdict).toBe('FAIL');
    expect(() => calibrateNoRegression(copies(10), copies(10), { confidence: 0.9 })).toThrow(/policy/);
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
  it('численная потеря positive ratio не превращается в CI нулевой ширины', () => {
    for (const [base, head] of [[1e308, 1e-308], [1e-308, 1e308]]) {
      const result = assessQuantile(copies(base), copies(head), 0.8);
      expect(result).toMatchObject({ verdict: 'INCOMPLETE', point: null, lower: null, upper: null, reason: 'ARITHMETIC_UNRESOLVED' });
      expect(JSON.parse(JSON.stringify(result)).reason).toBe('ARITHMETIC_UNRESOLVED');
    }
  });
  it('subnormal и normal округление вниз не создаёт ложный PASS на budget', () => {
    const unit = Number.MIN_VALUE;
    const subnormal = assessQuantile(copies(2), copies(5 * unit), 2 * unit);
    expect(subnormal).toMatchObject({ verdict: 'FAIL', lower: unit, upper: 3 * unit, lowerWithinBudget: false });
    // Budget0.3 означает десятичные3/10; границы округляются наружу.
    const normal = assessQuantile(copies(10), copies(3), 0.3);
    expect(normal).toMatchObject({ verdict: 'PASS', upperWithinBudget: true });
    expect(normal.lower).toBeLessThan(0.3);
    expect(normal.upper).toBeGreaterThan(0.3);
    // Ratio3/10 также строго меньше следующего binary64 budget.
    expect(assessQuantile(copies(10), copies(3), 0.30000000000000004).verdict).toBe('PASS');
    expect(assessQuantile(copies(10), copies(3), 0.29999999999999993).verdict).toBe('FAIL');
  });
  it('generic confidence не получает лишний rank из округлённой tail sum', () => {
    const sample = Array.from({ length: 47 }, (_, index) => index + 1);
    expect(quantileInterval(sample, 0.5, 0.960013943173948)).toMatchObject({ lowerRank: 16, upperRank: 32 });
    expect(quantileInterval(sample, 0.5, 0.9600139431739478)).toMatchObject({ lowerRank: 17, upperRank: 31 });
  });
  it('rounded display не отвергает допустимую confidence ниже1', () => {
    const result = quantileRatio([1, 2], [1, 2], { confidence: 0.9999999999999999 });
    expect(result).toMatchObject({ upper: null, reason: 'INSUFFICIENT_TAIL_OR_ZERO_BASELINE' });
    expect(result.baseline.confidenceFraction).toEqual({ numerator: '19999999999999999', denominator: '20000000000000000' });
    expect(result.baseline).not.toHaveProperty('confidence');
  });
  it('nearest rank использует ту же точную probability, что confidence bounds', () => {
    const sample = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(quantileInterval(sample, 0.07).estimate).toBe(7);
    expect(quantileInterval(sample, 0.07000000000000002).estimate).toBe(8);
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
