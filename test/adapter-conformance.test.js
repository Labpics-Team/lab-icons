import { describe, expect, it } from 'vitest';
import { buildConformanceReport } from '../scripts/build-adapter-conformance.mjs';

describe('ADAPTER-01 adapter conformance', () => {
  it('produces report with schemaVersion 1', () => {
    const report = buildConformanceReport();
    expect(report.schemaVersion).toBe(1);
    expect(Array.isArray(report.gestures)).toBe(true);
    expect(report.summary).toBeDefined();
  });

  it('covers at least one gesture (time.advance)', () => {
    const report = buildConformanceReport();
    expect(report.summary.total).toBeGreaterThanOrEqual(1);
    const timeAdvance = report.gestures.find((g) => g.gestureId === 'time.advance');
    expect(timeAdvance).toBeDefined();
  });

  it('all gestures pass equivalence check', () => {
    const report = buildConformanceReport();
    for (const g of report.gestures) {
      expect(g.status, `${g.gestureId} should pass but got ${g.status}: ${(g.findings || []).join('; ')}`).toBe('pass');
    }
  });

  it('summary counters are consistent with gesture statuses', () => {
    const report = buildConformanceReport();
    let passed = 0, failed = 0;
    for (const g of report.gestures) {
      if (g.status === 'pass') passed++;
      else failed++;
    }
    expect(report.summary.passed).toBe(passed);
    expect(report.summary.failed).toBe(failed);
    expect(report.summary.total).toBe(passed + failed);
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildConformanceReport());
    const b = JSON.stringify(buildConformanceReport());
    expect(a).toBe(b);
  });

  it('report is JSON-serializable without circular references', () => {
    const report = buildConformanceReport();
    const json = JSON.stringify(report);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.summary.total).toBeGreaterThanOrEqual(1);
  });

  it('passing gestures have matching layer and track counts', () => {
    const report = buildConformanceReport();
    for (const g of report.gestures) {
      if (g.status === 'pass') {
        expect(g.lottieLayers).toBe(g.trackCount);
        expect(g.sfLayers).toBe(g.trackCount);
      }
    }
  });
});