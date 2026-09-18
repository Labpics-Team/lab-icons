import { describe, expect, it } from 'vitest';
import { buildProofMatrix } from '../scripts/build-motion-proof-matrix.mjs';

describe('MO-04 closed gesture×icon proof matrix', () => {
  it('produces deterministic matrix covering all census families', () => {
    const matrix = buildProofMatrix();
    expect(matrix.schemaVersion).toBe(1);
    expect(matrix.families.length).toBe(8);
    expect(matrix.summary.totalIcons + matrix.summary.skipped).toBeGreaterThan(0);
  });

  it('every family has id, meaning and requiredTrackKinds', () => {
    const matrix = buildProofMatrix();
    for (const family of matrix.families) {
      expect(family.id).toBeTruthy();
      expect(family.meaning).toBeTruthy();
      expect(Array.isArray(family.requiredTrackKinds)).toBe(true);
      expect(family.requiredTrackKinds.length).toBeGreaterThan(0);
    }
  });

  it('icons are sorted alphabetically within each family', () => {
    const matrix = buildProofMatrix();
    for (const family of matrix.families) {
      const names = family.icons.map((i) => i.icon);
      const sorted = [...names].sort();
      expect(names).toEqual(sorted);
    }
  });

  it('no icon appears twice in the same family', () => {
    const matrix = buildProofMatrix();
    for (const family of matrix.families) {
      const names = family.icons.map((i) => i.icon);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('summary counters are consistent with icon statuses', () => {
    const matrix = buildProofMatrix();
    let passed = 0, skipped = 0, failed = 0;
    for (const family of matrix.families) {
      for (const icon of family.icons) {
        if (icon.status === 'proven') passed++;
        else if (['excluded', 'missing-glyph-or-model', 'needs-declaration'].includes(icon.status)) skipped++;
        else failed++;
      }
    }
    // summary.passed counts variant-level proofs, not icon-level
    expect(matrix.summary.skipped).toBe(skipped);
    expect(matrix.summary.failed).toBe(failed);
  });

  it('matrix is JSON-serializable without circular references', () => {
    const matrix = buildProofMatrix();
    const json = JSON.stringify(matrix);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.families.length).toBe(8);
  });

  it('two consecutive builds produce identical output', () => {
    const a = JSON.stringify(buildProofMatrix());
    const b = JSON.stringify(buildProofMatrix());
    expect(a).toBe(b);
  });
});