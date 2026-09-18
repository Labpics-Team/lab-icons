import { describe, expect, it } from 'vitest';
import { buildBenchmark } from '../scripts/build-motion-benchmark.mjs';

describe('BENCH-01 motion benchmark', () => {
  it('produces benchmark with schemaVersion 1 and time.advance gesture', () => {
    const bench = buildBenchmark();
    expect(bench.schemaVersion).toBe(1);
    expect(bench.gestureId).toBe('time.advance');
    expect(bench.icon).toBe('time');
  });

  it('frame evidence covers 9 progress samples with consistent topology', () => {
    const bench = buildBenchmark();
    expect(bench.frameEvidence.progressSamples).toBe(9);
    expect(bench.frameEvidence.topologyConsistent).toBe(true);
    expect(bench.frameEvidence.entryCountPerFrame).toBeGreaterThan(0);
    expect(bench.frameEvidence.frames).toHaveLength(9);
  });

  it('reduced-motion evidence matches declared value', () => {
    const bench = buildBenchmark();
    expect(bench.reducedMotionEvidence.declared).toBe('static');
    expect(bench.reducedMotionEvidence.frameCount).toBe(1);
  });

  it('cost evidence has positive median times and output sizes', () => {
    const bench = buildBenchmark();
    expect(bench.costEvidence.lottieMedianMs).toBeGreaterThan(0);
    expect(bench.costEvidence.sfMedianMs).toBeGreaterThan(0);
    expect(bench.costEvidence.lottieOutputBytes).toBeGreaterThan(0);
    expect(bench.costEvidence.sfOutputBytes).toBeGreaterThan(0);
    expect(bench.costEvidence.costRuns).toBe(5);
  });

  it('two consecutive builds produce identical JSON (deterministic)', () => {
    const a = JSON.stringify(buildBenchmark());
    const b = JSON.stringify(buildBenchmark());
    expect(a).toBe(b);
  });

  it('benchmark is JSON-serializable without circular references', () => {
    const bench = buildBenchmark();
    const json = JSON.stringify(bench);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.gestureId).toBe('time.advance');
  });

  it('every frame has correct progress value and track samples', () => {
    const bench = buildBenchmark();
    const expectedProgress = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
    for (let i = 0; i < bench.frameEvidence.frames.length; i++) {
      const frame = bench.frameEvidence.frames[i];
      expect(frame.progress).toBe(expectedProgress[i]);
      expect(Array.isArray(frame.trackSamples)).toBe(true);
      expect(frame.trackSamples.length).toBeGreaterThan(0);
      expect(frame.entryCount).toBe(bench.frameEvidence.entryCountPerFrame);
    }
  });
});