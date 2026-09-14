import { describe, expect, it } from 'vitest';
import { buildMotionContract } from '../scripts/build-motion-contract.mjs';

describe('MOTION-CONTRACT-01 versioned gesture contract', () => {
  it('produces contract with semver-compatible schemaVersion', () => {
    const contract = buildMotionContract();
    expect(contract.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('contains at least one gesture snapshot (time.advance)', () => {
    const contract = buildMotionContract();
    expect(contract.gestureCount).toBeGreaterThanOrEqual(1);
    const timeAdvance = contract.snapshots.find((s) => s.gestureId === 'time.advance');
    expect(timeAdvance).toBeDefined();
    expect(timeAdvance.icon).toBe('time');
    expect(timeAdvance.reducedMotion).toBe('static');
  });

  it('every snapshot has required fields and valid track structure', () => {
    const contract = buildMotionContract();
    for (const snapshot of contract.snapshots) {
      expect(snapshot.icon).toBeTruthy();
      expect(snapshot.gestureId).toBeTruthy();
      expect(snapshot.kind).toBeTruthy();
      expect(Array.isArray(snapshot.partIds)).toBe(true);
      expect(snapshot.partIds.length).toBeGreaterThan(0);
      expect(snapshot.progress).toBe('normalized-0-to-1');
      expect(['static', 'fade-only', 'none']).toContain(snapshot.reducedMotion);
      expect(Array.isArray(snapshot.tracks)).toBe(true);
      expect(snapshot.tracks.length).toBeGreaterThan(0);
      for (const track of snapshot.tracks) {
        expect(track.partId).toBeTruthy();
        expect(['rotate', 'translate', 'opacity', 'scale', 'reveal']).toContain(track.kind);
        expect(typeof track.from).toBe('number');
        expect(typeof track.to).toBe('number');
        expect(track.unit).toBeTruthy();
        expect(track.interpolation).toBeTruthy();
      }
    }
  });

  it('snapshots are sorted by icon then gestureId for determinism', () => {
    const contract = buildMotionContract();
    for (let i = 1; i < contract.snapshots.length; i++) {
      const prev = contract.snapshots[i - 1];
      const curr = contract.snapshots[i];
      const cmp = prev.icon.localeCompare(curr.icon) || prev.gestureId.localeCompare(curr.gestureId);
      expect(cmp).toBeLessThanOrEqual(0);
    }
  });

  it('proves census is absent from public IR exports', () => {
    const contract = buildMotionContract();
    expect(contract.censusNonPublic.verified).toBe(true);
    expect(contract.censusNonPublic.findings).toEqual([]);
  });

  it('metadata lists correct source files and excluded artifacts', () => {
    const contract = buildMotionContract();
    expect(contract.metadata.sourceFiles).toContain('semantics/anatomy.json');
    expect(contract.metadata.excludedFromPublicIR).toContain('semantics/motion-census.json');
    expect(contract.metadata.excludedFromPublicIR).toContain('semantics/motion-families.json');
    expect(contract.metadata.invariants).toContain('INV-09');
    expect(contract.metadata.invariants).toContain('INV-12');
    expect(contract.metadata.invariants).toContain('INV-19');
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildMotionContract());
    const b = JSON.stringify(buildMotionContract());
    expect(a).toBe(b);
  });

  it('contract is JSON-serializable without circular references', () => {
    const contract = buildMotionContract();
    const json = JSON.stringify(contract);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(contract.schemaVersion);
    expect(parsed.gestureCount).toBe(contract.gestureCount);
    expect(parsed.snapshots).toHaveLength(contract.snapshots.length);
  });

  it('generatedAt is null for deterministic output', () => {
    const contract = buildMotionContract();
    expect(contract.generatedAt).toBeNull();
  });
});