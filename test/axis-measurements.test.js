import { describe, expect, it } from 'vitest';
import { buildMeasurements } from '../scripts/build-axis-measurements.mjs';

describe('AX-01 axis measurements', () => {
  it('produces exactly 64 measurement records', () => {
    const result = buildMeasurements();
    expect(result.measurementCount).toBe(64);
    expect(result.measurements).toHaveLength(64);
  });

  it('has schemaVersion 1 and valid metadata', () => {
    const result = buildMeasurements();
    expect(result.schemaVersion).toBe(1);
    expect(result.metadata.sourceFile).toBe('semantics/axis-quality.json');
    expect(result.metadata.generatedDeterministically).toBe(true);
  });

  it('every measurement has required fields and valid structure', () => {
    const result = buildMeasurements();
    for (const m of result.measurements) {
      expect(m.axisKey).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(m.variant).toBeTruthy();
      expect(m.axis).toBeTruthy();
      expect(['oracle-defect', 'law-fix', 'redraw-required', 'owner-blocked-rect-pen']).toContain(m.triageClass);
      expect(['pass', 'fail', 'awaiting-owner']).toContain(m.verdict);
      expect(Array.isArray(m.declaredRasterSizes)).toBe(true);
      expect(m.declaredRasterSizes).toEqual([16, 24, 48]);
      expect(Array.isArray(m.declaredPhases)).toBe(true);
      expect(m.declaredPhases).toHaveLength(4);
    }
  });

  it('ASM-02 is computed from first 20 measurements', () => {
    const result = buildMeasurements();
    const first20 = result.measurements.slice(0, 20);
    const nonRedraw = first20.filter((m) => m.triageClass !== 'redraw-required').length;
    const expected = nonRedraw / 20;
    expect(result.asm02).toBeCloseTo(expected, 4);
  });

  it('verdict summary matches actual verdict counts', () => {
    const result = buildMeasurements();
    let pass = 0, fail = 0, awaiting = 0;
    for (const m of result.measurements) {
      if (m.verdict === 'pass') pass++;
      else if (m.verdict === 'fail') fail++;
      else if (m.verdict === 'awaiting-owner') awaiting++;
    }
    expect(result.verdictSummary.pass).toBe(pass);
    expect(result.verdictSummary.fail).toBe(fail);
    expect(result.verdictSummary['awaiting-owner']).toBe(awaiting);
  });

  it('class summary matches actual class counts', () => {
    const result = buildMeasurements();
    const counts = {};
    for (const m of result.measurements) {
      counts[m.triageClass] = (counts[m.triageClass] || 0) + 1;
    }
    expect(result.classSummary).toEqual(counts);
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildMeasurements());
    const b = JSON.stringify(buildMeasurements());
    expect(a).toBe(b);
  });

  it('result is JSON-serializable without circular references', () => {
    const result = buildMeasurements();
    const json = JSON.stringify(result);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.measurementCount).toBe(64);
  });
});