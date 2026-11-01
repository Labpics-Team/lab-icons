import { describe, expect, it } from 'vitest';
import { assertRemoteBenchmark, summarize } from '../scripts/bench/measurement.js';

describe('область и denominator benchmark', () => {
  it('отказывает локальному запуску и неполному runner identity', () => {
    expect(() => assertRemoteBenchmark({})).toThrow(/удалённом/);
    expect(() => assertRemoteBenchmark({ CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1' })).toThrow(/удалённом/);
    expect(() => assertRemoteBenchmark({ CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1', BENCHMARK_RUNNER_ENVIRONMENT: 'self-hosted' })).not.toThrow();
  });
  it('сохраняет все наблюдения, разброс и стандартную ошибку среднего', () => {
    const result = summarize([1, 2, 3]);
    expect(result).toMatchObject({ count: 3, mean: 2, standardDeviation: 1, min: 1, median: 2, max: 3, raw: [1, 2, 3] });
    expect(result.meanStandardError).toBeCloseTo(1 / Math.sqrt(3));
    expect(summarize([1, 2, 4, 8]).median).toBe(3);
  });
  it.each([[1], [], [1, NaN], [1, -1], [1, Infinity]])('не удаляет плохой повтор ради красивого результата: %j', (values) => {
    expect(() => summarize(values)).toThrow();
  });
});
