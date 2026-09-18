import { describe, expect, it } from 'vitest';
import { buildSabotageProof } from '../scripts/build-gate3-sabotage-proof.mjs';

describe('GATE-3 sabotage proof', () => {
  it('produces proof with schemaVersion 1 and all vectors passing', () => {
    const proof = buildSabotageProof();
    expect(proof.schemaVersion).toBe(1);
    expect(proof.allPassed).toBe(true);
    expect(proof.failed).toBe(0);
    expect(proof.passed).toBe(proof.totalVectors);
  });

  it('covers at least 12 sabotage vectors', () => {
    const proof = buildSabotageProof();
    expect(proof.totalVectors).toBeGreaterThanOrEqual(12);
  });

  it('every vector has a label and passed status', () => {
    const proof = buildSabotageProof();
    for (const v of proof.vectors) {
      expect(v.label).toBeTruthy();
      expect(typeof v.passed).toBe('boolean');
      if (v.passed) {
        expect(v.errorMessage).toBeTruthy();
      } else {
        expect(v.error).toBeTruthy();
      }
    }
  });

  it('includes trajectory sabotage vectors (anchor, progress, kind, unit)', () => {
    const proof = buildSabotageProof();
    const labels = proof.vectors.map((v) => v.label);
    expect(labels.some((l) => l.includes('anchor'))).toBe(true);
    expect(labels.some((l) => l.includes('progress'))).toBe(true);
    expect(labels.some((l) => l.includes('track kind'))).toBe(true);
    expect(labels.some((l) => l.includes('unit'))).toBe(true);
  });

  it('includes adapter sabotage vectors (reducedMotion, duplicate partId, empty tracks)', () => {
    const proof = buildSabotageProof();
    const labels = proof.vectors.map((v) => v.label);
    expect(labels.some((l) => l.includes('reducedMotion'))).toBe(true);
    expect(labels.some((l) => l.includes('duplicate'))).toBe(true);
    expect(labels.some((l) => l.includes('empty tracks'))).toBe(true);
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildSabotageProof());
    const b = JSON.stringify(buildSabotageProof());
    expect(a).toBe(b);
  });

  it('proof is JSON-serializable without circular references', () => {
    const proof = buildSabotageProof();
    const json = JSON.stringify(proof);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.allPassed).toBe(true);
  });
});