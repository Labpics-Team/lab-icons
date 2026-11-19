import { describe, expect, it } from 'vitest';
import { clockDisplayPathMatches } from '../scripts/bench/explorer-journey.js';
import { prepareClockHands } from '../dist/gestures/time.js';

const path = (x = 1) => `M0 0C${x} 2 3 4 5 6L0 0Z`;

describe('clock display observation', () => {
  it('accepts the actual Chromium 156 range roundtrip without changing the exact sampler', () => {
    const { prepared } = prepareClockHands('outline');
    const original = prepared.sample(0.12345678912345678), displayed = prepared.sample(0.123456789123457);
    expect(original.ok && displayed.ok).toBe(true);
    expect(original.d).not.toBe(displayed.d);
    expect(clockDisplayPathMatches(original.d, displayed.d, 128 / 24)).toBe(true);
  });

  it('accepts native serialization roundoff while bounding every Bezier control in CSS pixels', () => {
    expect(clockDisplayPathMatches(path(), path(1 + 2.2e-14), 128 / 24)).toBe(true);
    expect(clockDisplayPathMatches(path(), path(1 + 1 / 4096), 1)).toBe(true);
    expect(clockDisplayPathMatches(path(), path(1 + 1 / 4096), 8)).toBe(false);
    expect(clockDisplayPathMatches(path(), path(1 + 1 / 512), 1)).toBe(false);
  });

  it('refuses topology changes, invalid paths and missing display scale', () => {
    for (const actual of ['M0 0L1 2L3 4L5 6L0 0Z', path() + 'M0 0L1 1Z', 'M0 0LNaN 1Z', undefined]) {
      expect(clockDisplayPathMatches(path(), actual, 1)).toBe(false);
    }
    for (const scale of [0, -1, NaN, Infinity]) expect(clockDisplayPathMatches(path(), path(), scale)).toBe(false);
  });
});
