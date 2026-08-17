import { describe, expect, it } from 'vitest';
import {
  glyphCapabilities,
  iconDesignContract,
  iconIds,
  sampleMotionGesture,
} from '../src/ir/index.js';

describe('capability and design contract', () => {
  it('publishes one machine-readable boundary for intake, promotion, and export targets', () => {
    expect(iconDesignContract).toMatchObject({
      version: 1,
      canvas: { viewBox: [0, 0, 24, 24], declarationUnits: 'fraction-of-canvas' },
      source: { paint: 'currentColor', geometry: 'path-only', intake: 'figma-import' },
      lifecycle: {
        sourceOnly: 'exact-source-fallback',
        candidate: 'research-only',
        accepted: 'public-after-proof',
      },
      targets: {
        staticSvg: 'supported',
        glyphIr: 'supported',
        lottie: 'not-exported',
        sfSymbols: 'not-exported',
      },
      agent: {
        proposalCommand: 'pnpm validate:proposal',
        promotionCommand: 'pnpm import:figma --write',
        finalGate: 'pnpm verify',
      },
    });
    expect(Object.isFrozen(iconDesignContract)).toBe(true);
    expect(Object.isFrozen(iconDesignContract.constraints.angleScale)).toBe(true);
  });

  it('does not turn source-only, candidate, semantic, and anchored motion parts into one claim', () => {
    expect(glyphCapabilities('brain', 'outline').motion).toMatchObject({
      state: 'source-only',
      partIds: [],
      tracks: [],
      gestures: [],
      adapters: { lottie: 'not-exported', sfSymbols: 'not-exported' },
    });
    expect(glyphCapabilities('reload', 'outline').motion).toMatchObject({
      state: 'candidate',
      partIds: [],
      tracks: [],
      gestures: [],
    });
    expect(glyphCapabilities('chevron-down', 'outline').motion).toMatchObject({
      state: 'semantic-parts',
      tracks: [],
    });
    expect(glyphCapabilities('time', 'outline').motion).toMatchObject({
      state: 'gesture-ready',
      tracks: [
        { id: 'rotate.hand-minute', kind: 'rotate', partIds: ['hand-minute'], anchor: [0.5, 0.5] },
        { id: 'rotate.hand-hour', kind: 'rotate', partIds: ['hand-hour'], anchor: [0.5, 0.5] },
      ],
      gestures: [{
        id: 'time.advance',
        kind: 'clock-advance',
        partIds: ['hand-minute', 'hand-hour'],
        progress: 'normalized-0-to-1',
        tracks: [
          { partId: 'hand-minute', from: 0, to: 360, unit: 'degrees', interpolation: 'linear' },
          { partId: 'hand-hour', from: 0, to: 30, unit: 'degrees', interpolation: 'linear' },
        ],
      }],
      adapters: { lottie: 'not-exported', sfSymbols: 'not-exported' },
    });
    const gesture = glyphCapabilities('time', 'outline').motion.gestures[0]!;
    expect(sampleMotionGesture(gesture, 0.5).map(({ rotation }) => rotation)).toEqual([180, 15]);
  });

  it('exposes opsz only for variants with an independent sampled optical proof', () => {
    for (const icon of iconIds) {
      for (const variant of ['outline', 'filled'] as const) {
        const supported = glyphCapabilities(icon, variant).supportedAxes;
        if (['chevron-down', 'chevron-up', 'chevron-back', 'chevron-forward'].includes(icon)) {
          expect(supported, `${icon}/${variant}`).toContain('opsz');
        } else {
          expect(supported, `${icon}/${variant}`).not.toContain('opsz');
        }
      }
    }
  });
});
