import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertRemoteBenchmark, coldRenderSpan, summarize } from '../scripts/bench/measurement.js';
import { measureColdScene } from '../scripts/bench/browser-scene.js';

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

describe('полный cold render interval', () => {
  const timing = { importStartedAt: 10, importResolvedAt: 20, firstCreateStartedAt: 120,
    firstCreateEndedAt: 130, mountStartedAt: 150, mountEndedAt: 170, contentfulPaintAt: 200 };
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('включает first creation и промежуточную работу в один span, а не сумму partial timers', () => {
    expect(coldRenderSpan(timing)).toEqual({ coldImportMs: 10, coldImportToUsefulRenderMs: 190 });
    expect(coldRenderSpan({ ...timing, firstCreateStartedAt: 25 }).coldImportToUsefulRenderMs).toBe(190);
  });

  it('отвергает старый endpoint до mount и разные clock domains', () => {
    expect(() => coldRenderSpan({ ...timing, contentfulPaintAt: 129 })).toThrow('milestones');
    expect(() => coldRenderSpan({ ...timing, importResolvedAt: 9 })).toThrow('milestones');
    expect(() => coldRenderSpan({ ...timing, contentfulPaintAt: NaN })).toThrow('clock');
    expect(() => coldRenderSpan({ ...timing, mountEndedAt: undefined })).toThrow('clock');
  });

  it('не заменяет unsupported paint или прежний FCP на rAF opportunity', async () => {
    const load = vi.fn();
    vi.stubGlobal('PerformanceObserver', { supportedEntryTypes: [] });
    await expect(measureColdScene(load, 1)).rejects.toThrow('недоступен');
    vi.stubGlobal('PerformanceObserver', { supportedEntryTypes: ['paint'] });
    vi.stubGlobal('performance', { getEntriesByName: () => [{ name: 'first-contentful-paint' }] });
    await expect(measureColdScene(load, 1)).rejects.toThrow('прежнего FCP');
    expect(load).not.toHaveBeenCalled();
  });

  it('ошибка import освобождает observer и paint deadline', async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn(), observe = vi.fn();
    vi.stubGlobal('PerformanceObserver', class {
      static supportedEntryTypes = ['paint'];
      observe = observe;
      disconnect = disconnect;
    });
    vi.stubGlobal('performance', { getEntriesByName: () => [], now: () => 10 });
    vi.stubGlobal('document', { getElementById: () => ({ childElementCount: 0 }) });
    await expect(measureColdScene(async () => { throw new Error('import refused'); }, 1)).rejects.toThrow('import refused');
    expect(observe).toHaveBeenCalledWith({ type: 'paint', buffered: true });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
