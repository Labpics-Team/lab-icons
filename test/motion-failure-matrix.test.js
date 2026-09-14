import { describe, expect, it } from 'vitest';
import { buildFailureMatrix } from '../scripts/build-motion-failure-matrix.mjs';

describe('MO-05 versioned gesture failure-code matrix', () => {
  it('produces matrix with schemaVersion 1 and valid failure codes list', () => {
    const matrix = buildFailureMatrix();
    expect(matrix.schemaVersion).toBe(1);
    expect(Array.isArray(matrix.validFailureCodes)).toBe(true);
    expect(matrix.validFailureCodes).toContain('PROVEN');
    expect(matrix.validFailureCodes).toContain('NO_GESTURE');
    expect(matrix.validFailureCodes).toContain('TRAJECTORY_FAIL');
  });

  it('covers all 8 census families', () => {
    const matrix = buildFailureMatrix();
    expect(matrix.families.length).toBe(8);
    for (const family of matrix.families) {
      expect(family.id).toBeTruthy();
      expect(family.meaning).toBeTruthy();
      expect(Array.isArray(family.requiredTrackKinds)).toBe(true);
    }
  });

  it('icons are sorted alphabetically within each family', () => {
    const matrix = buildFailureMatrix();
    for (const family of matrix.families) {
      const names = family.icons.map((i) => i.icon);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    }
  });

  it('no icon appears twice in the same family', () => {
    const matrix = buildFailureMatrix();
    for (const family of matrix.families) {
      const names = family.icons.map((i) => i.icon);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('every icon has a valid failure code from the declared set', () => {
    const matrix = buildFailureMatrix();
    const validCodes = new Set(matrix.validFailureCodes);
    for (const family of matrix.families) {
      for (const icon of family.icons) {
        expect(validCodes.has(icon.code), `${icon.icon} has invalid code ${icon.code}`).toBe(true);
      }
    }
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildFailureMatrix());
    const b = JSON.stringify(buildFailureMatrix());
    expect(a).toBe(b);
  });

  it('matrix is JSON-serializable without circular references', () => {
    const matrix = buildFailureMatrix();
    const json = JSON.stringify(matrix);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.families.length).toBe(8);
    expect(parsed.summary.totalIcons).toBeGreaterThan(0);
  });
});