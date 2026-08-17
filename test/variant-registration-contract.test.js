import { describe, expect, it } from 'vitest';
import { validateVariantParity } from '../scripts/check-variant-parity.js';

const grid = {
  canvas: { width: 24, height: 24 },
  ratios: {
    keylines: { circle: 22 / 24 },
    strokeWidth: { base: 1.8 / 24, enclosureRing: 1.5 / 24 },
    tolerances: {
      ringWeight: 0.12 / 24,
      ringDiameter: 0.2 / 24,
      variantRegistration: 0.15 / 24,
    },
  },
};

const svg = (d) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="${d}"/></svg>`;

const circle = (cx, cy, r) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

const run = (outline, filled, name) => validateVariantParity({
  grid,
  pairs: [{ name, outline, filled }],
});

describe('variant registration contract', () => {
  it('rejects a keyline ring translated away from the canvas center', () => {
    const outline = svg(`${circle(12.5, 12, 11)}${circle(12.5, 12, 9.5)}M10 10h4v4h-4z`);
    const filled = svg(`${circle(12, 12, 11)}M10 10h4v4h-4z`);
    const { report } = run(outline, filled, 'ring-offset');

    expect(report.some((finding) => finding.startsWith('ring-offset:'))).toBe(true);
  });

  it('rejects a keyline disc translated away from the canvas center', () => {
    const outline = svg(`${circle(12, 12, 11)}${circle(12, 12, 9.5)}M10 10h4v4h-4z`);
    const filled = svg(`${circle(12, 12.5, 11)}M10 10h4v4h-4z`);
    const { report } = run(outline, filled, 'disc-offset');

    expect(report.some((finding) => finding.startsWith('disc-offset:'))).toBe(true);
  });

  it('does not call a different filled silhouette a registration defect merely because its mass moved', () => {
    const outline = svg('M10 10h4v4h-4z');
    const filled = svg('M10.4 10h4v4h-2v-2h-2z');
    const { hard, report } = run(outline, filled, 'different-silhouette');

    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });

  it('detects translation even when the exporter rotates a contour start point', () => {
    const outline = svg('M10 10h4v4h-4z');
    const filled = svg('M14.5 10.25v4h-4v-4z');
    const { report } = run(outline, filled, 'rotated-start');

    expect(report.some((finding) => finding.includes('rotated-start') && finding.includes('регистрац')))
      .toBe(true);
  });

  it('detects translation even when the exporter reverses contour winding', () => {
    const outline = svg('M10 10h4v4h-4z');
    const filled = svg('M10.4 10.3v4h4v-4z');
    const { report } = run(outline, filled, 'reversed-winding');

    expect(report.some((finding) => finding.includes('reversed-winding') && finding.includes('регистрац')))
      .toBe(true);
  });
});
