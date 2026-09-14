import { describe, expect, it } from 'vitest';
import { buildAuthorContract } from '../scripts/build-author-contract.mjs';

describe('AUTHOR-01 authoring capability contract', () => {
  it('produces contract with semver-compatible schemaVersion', () => {
    const contract = buildAuthorContract();
    expect(contract.schemaVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has at least 20 good examples', () => {
    const contract = buildAuthorContract();
    expect(contract.summary.goodCount).toBeGreaterThanOrEqual(20);
    expect(contract.goodExamples).toHaveLength(contract.summary.goodCount);
  });

  it('has at least 20 bad examples', () => {
    const contract = buildAuthorContract();
    expect(contract.summary.badCount).toBeGreaterThanOrEqual(20);
    expect(contract.badExamples).toHaveLength(contract.summary.badCount);
  });

  it('has hostile exact-code tests', () => {
    const contract = buildAuthorContract();
    expect(contract.summary.hostileCount).toBeGreaterThanOrEqual(5);
    expect(contract.hostileTests).toHaveLength(contract.summary.hostileCount);
  });

  it('all bad examples have valid rejection codes from closed-world enum', () => {
    const contract = buildAuthorContract();
    const validCodes = new Set(contract.rejectionCodes);
    for (const example of contract.badExamples) {
      expect(validCodes.has(example.rejectionCode), `${example.id} has invalid code ${example.rejectionCode}`).toBe(true);
    }
  });

  it('all hostile tests have valid rejection codes from closed-world enum', () => {
    const contract = buildAuthorContract();
    const validCodes = new Set(contract.rejectionCodes);
    for (const test of contract.hostileTests) {
      expect(validCodes.has(test.rejectionCode), `${test.id} has invalid code ${test.rejectionCode}`).toBe(true);
    }
  });

  it('good examples have required fields and expectedOutcome=accepted', () => {
    const contract = buildAuthorContract();
    for (const example of contract.goodExamples) {
      expect(example.type).toBe('good');
      expect(example.icon).toBeTruthy();
      expect(example.variant).toBeTruthy();
      expect(example.expectedOutcome).toBe('accepted');
      expect(example.reason).toBeTruthy();
    }
  });

  it('bad examples have required fields and type=bad', () => {
    const contract = buildAuthorContract();
    for (const example of contract.badExamples) {
      expect(example.type).toBe('bad');
      expect(example.id).toBeTruthy();
      expect(example.rejectionCode).toBeTruthy();
      expect(example.reason).toBeTruthy();
    }
  });

  it('hostile tests have description and shouldReject flag', () => {
    const contract = buildAuthorContract();
    for (const test of contract.hostileTests) {
      expect(test.id).toBeTruthy();
      expect(test.description).toBeTruthy();
      expect(typeof test.shouldReject).toBe('boolean');
      expect(test.shouldReject).toBe(true);
    }
  });

  it('generatedAt is null for deterministic output', () => {
    const contract = buildAuthorContract();
    expect(contract.generatedAt).toBeNull();
  });

  it('two consecutive builds produce identical output (deterministic)', () => {
    const a = JSON.stringify(buildAuthorContract());
    const b = JSON.stringify(buildAuthorContract());
    expect(a).toBe(b);
  });

  it('contract is JSON-serializable without circular references', () => {
    const contract = buildAuthorContract();
    const json = JSON.stringify(contract);
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(contract.schemaVersion);
    expect(parsed.summary.goodCount).toBe(contract.summary.goodCount);
    expect(parsed.summary.badCount).toBe(contract.summary.badCount);
  });
});