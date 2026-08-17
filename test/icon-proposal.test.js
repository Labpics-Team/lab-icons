import { describe, expect, it } from 'vitest';
import { validateIconProposal } from '../scripts/lib/icon-proposal.js';

const catalogIconIds = ['alert', 'alert-circle', 'time'];

function proposal(overrides = {}) {
  return {
    version: 1,
    icon: 'sample-alert',
    intent: 'Warn about a recoverable problem without implying destructive failure.',
    family: {
      references: ['alert', 'alert-circle'],
      sharedRules: ['uses the alert stem-and-dot rhythm', 'keeps container lighter than content'],
    },
    keyline: {
      kind: 'square',
      reason: 'The visual mass is a compact upright sign, not a circular enclosure.',
    },
    variants: {
      relationship: 'shared-anatomy',
      outline: {
        role: 'regular-weight contour master',
        negativeSpace: [{
          id: 'signal.aperture',
          kind: 'aperture',
          minimum: 0.033333,
          participants: ['body', 'signal'],
          measurement: 'minimum contour-to-contour distance',
        }],
      },
      filled: {
        role: 'filled mass with a negative stem-and-dot signal',
        negativeSpace: [{
          id: 'signal.knockout',
          kind: 'knockout',
          minimum: 0.033333,
          participants: ['body', 'signal'],
          measurement: 'minimum negative channel width',
        }],
      },
    },
    opticalSizing: {
      mode: 'fixed-master',
      masters: [{ size: 24, source: 'Outline/sample-alert.svg + Filled/sample-alert.svg' }],
      behavior: ['scale only; no opsz capability is claimed'],
    },
    parts: [
      { id: 'body', role: 'body', anchor: null, moves: false },
      { id: 'signal', role: 'content', anchor: [0.5, 0.5], moves: true },
    ],
    motion: {
      state: 'semantic-parts',
      gestures: [],
    },
    ...overrides,
  };
}

describe('icon proposal contract', () => {
  it('requires the catalog boundary before validating family references', () => {
    expect(() => validateIconProposal(proposal())).toThrow(/catalogIconIds.*обязателен/);
  });

  it('accepts an explicit semantic, pair, optical, and motion brief', () => {
    const parsed = validateIconProposal(proposal(), { catalogIconIds });

    expect(parsed.icon).toBe('sample-alert');
    expect(parsed.opticalSizing).toMatchObject({ mode: 'fixed-master' });
    expect(parsed.parts.map(({ id }) => id)).toEqual(['body', 'signal']);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('fails closed on an unknown family reference instead of inventing style', () => {
    const broken = proposal({
      family: { references: ['unknown-family'], sharedRules: ['copy the visual rhythm'] },
    });

    expect(() => validateIconProposal(broken, { catalogIconIds }))
      .toThrow(/неизвестные family.references unknown-family/);
  });

  it('requires multiple masters before claiming opsz variability', () => {
    const broken = proposal({
      opticalSizing: {
        mode: 'continuous-recipe',
        masters: [{ size: 24, source: 'default.svg' }],
        behavior: ['change clearance and detail by target size'],
      },
    });

    expect(() => validateIconProposal(broken, { catalogIconIds }))
      .toThrow(/минимум два optical master/);
  });

  it('requires anchored movable parts before claiming anchored motion', () => {
    const broken = proposal({
      parts: [
        { id: 'body', role: 'body', anchor: null, moves: false },
        { id: 'signal', role: 'content', anchor: null, moves: true },
      ],
      motion: {
        state: 'anchored-parts',
        gestures: [],
      },
    });

    expect(() => validateIconProposal(broken, { catalogIconIds }))
      .toThrow(/подвижные parts с anchor/);
  });

  it('accepts anchored parts without inventing a gesture contract', () => {
    const parsed = validateIconProposal(proposal({
      motion: { state: 'anchored-parts', gestures: [] },
    }), { catalogIconIds });

    expect(parsed.motion).toEqual({ state: 'anchored-parts', gestures: [] });
  });

  it('reserves gestures for gesture-ready proposals', () => {
    const gesture = {
      id: 'signal.pulse',
      kind: 'pulse',
      partIds: ['signal'],
      meaning: 'Draw attention to the warning without moving the container.',
    };

    for (const state of ['semantic-parts', 'anchored-parts']) {
      expect(() => validateIconProposal(proposal({
        motion: { state, gestures: [gesture] },
      }), { catalogIconIds }), state).toThrow(/не допускает gestures/);
    }
  });

  it('requires at least one gesture before claiming gesture-ready', () => {
    expect(() => validateIconProposal(proposal({
      motion: { state: 'gesture-ready', gestures: [] },
    }), { catalogIconIds })).toThrow(/gesture-ready требует хотя бы один gesture/);
  });

  it('requires every gesture-ready referenced part to move around an anchor', () => {
    const gesture = {
      id: 'body.pulse',
      kind: 'pulse',
      partIds: ['body'],
      meaning: 'Pulse the static body to expose an invalid maturity claim.',
    };

    expect(() => validateIconProposal(proposal({
      motion: { state: 'gesture-ready', gestures: [gesture] },
    }), { catalogIconIds })).toThrow(/referenced parts.*подвижными.*anchor/);
  });

  it('accepts gesture-ready only when every referenced part moves with an anchor', () => {
    const parsed = validateIconProposal(proposal({
      motion: {
        state: 'gesture-ready',
        gestures: [{
          id: 'signal.pulse',
          kind: 'pulse',
          partIds: ['signal'],
          meaning: 'Draw attention to the warning without moving the container.',
        }],
      },
    }), { catalogIconIds });

    expect(parsed.motion.state).toBe('gesture-ready');
    expect(parsed.motion.gestures.map(({ id }) => id)).toEqual(['signal.pulse']);
  });
});
