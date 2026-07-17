import { describe, expect, it } from 'vitest';
import {
  compareDebtSnapshot,
  findingSetSha256,
  validateLegacyQualitySnapshot,
} from '../scripts/lib/legacy-quality-snapshot.js';

const snapshot = {
  comment: 'Measured fixture debt with explicit immutable provenance.',
  pathQuality: {
    findingSetSha256: findingSetSha256(['old-a', 'old-b']),
    maximumFindings: 2,
    maximumMajorFindings: 1,
  },
  variantParity: {
    findingSetSha256: findingSetSha256(['old-a']),
    maximumFindings: 1,
  },
  version: 1,
};

describe('legacy quality snapshot', () => {
  it('принимает только точный frozen debt', () => {
    expect(validateLegacyQualitySnapshot(snapshot)).toBe(snapshot);
    expect(compareDebtSnapshot(['old-b', 'old-a'], snapshot.pathQuality, {
      major: (finding) => finding === 'old-b',
    })).toEqual([]);
  });

  it('ловит подмену находки даже при неизменном количестве', () => {
    expect(compareDebtSnapshot(['old-a', 'new-regression'], snapshot.pathQuality))
      .toEqual([expect.stringContaining('finding-set')]);
  });

  it('fail-closed отвергает расширение схемы и major ceiling', () => {
    expect(() => validateLegacyQualitySnapshot({ ...snapshot, magic: true })).toThrow(/ключи/);
    expect(compareDebtSnapshot(['old-a', 'old-b'], {
      ...snapshot.pathQuality,
      maximumMajorFindings: 0,
    }, { major: (finding) => finding === 'old-b' }))
      .toEqual([expect.stringContaining('major 1 > ceiling 0')]);
  });
});
