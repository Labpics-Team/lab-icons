/**
 * test/check-motion.test.js — гейты моушна BL-006: bounds (вылет за канву)
 * и collision (новые наслоения слоёв). Классы: А (юнит на синтетике),
 * Д-паттерн (каждое правило доказано фикстурой-нарушителем). RED-first.
 */

import { describe, expect, it } from 'vitest';
import { validateMotionBounds } from '../scripts/check-motion-bounds.js';
import { validateMotionCollision } from '../scripts/check-motion-collision.js';

// Синтетика: viewBox 24×24, слой 0 — квадрат слева, слой 1 — квадрат справа.
const SVG =
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
  '<path d="M2 10h6v4H2z"/><path d="M16 10h6v4h-6z"/></svg>';

const timing = {
  duration: 500,
  delay: 0,
  iterations: 1,
  direction: 'normal',
  fill: 'both',
  easing: 'linear',
};

function generated(parts) {
  return { icons: { demo: { outline: { parts } } } };
}

const still = { offset: 0, transform: 'translate(0px, 0px)' };

describe('validateMotionBounds — контур ⊆ viewBox во всех кадрах', () => {
  it('А: спокойное движение внутри канвы → ноль ошибок', () => {
    const gen = generated([
      {
        paths: [0],
        anchor: [5, 12],
        keyframes: [still, { offset: 0.5, transform: 'translate(1px, 0px)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    expect(validateMotionBounds({ generated: gen, readSvg: () => SVG })).toEqual([]);
  });

  it('А: вылет за канву (translate -5px от левого края) → ошибка с именем и временем', () => {
    const gen = generated([
      {
        paths: [0],
        anchor: [5, 12],
        keyframes: [still, { offset: 0.5, transform: 'translate(-5px, 0px)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    const errors = validateMotionBounds({ generated: gen, readSvg: () => SVG });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('demo:outline');
    expect(errors[0]).toContain('вылет');
  });

  it('А: масштаб, распирающий слой за край → ошибка', () => {
    const gen = generated([
      {
        paths: [1],
        anchor: [19, 12],
        keyframes: [still, { offset: 0.5, transform: 'scale(2, 1)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    // слой 16..22, якорь 19 → при scale 2 края 13..25 → 25 > 24
    expect(validateMotionBounds({ generated: gen, readSvg: () => SVG }).length).toBeGreaterThan(0);
  });
});

describe('validateMotionCollision — новых наслоений слоёв нет', () => {
  it('А: слои движутся, не встречаясь → ноль ошибок', () => {
    const gen = generated([
      {
        paths: [0],
        anchor: [5, 12],
        keyframes: [still, { offset: 0.5, transform: 'translate(2px, 0px)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    expect(validateMotionCollision({ generated: gen, readSvg: () => SVG })).toEqual([]);
  });

  it('А: движущийся слой наезжает на статичный → ошибка с парой слоёв', () => {
    const gen = generated([
      {
        paths: [0],
        anchor: [5, 12],
        // квадрат 2..8 едет вправо на 10 → 12..18 пересекает слой 16..22
        keyframes: [still, { offset: 0.5, transform: 'translate(10px, 0px)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    const errors = validateMotionCollision({ generated: gen, readSvg: () => SVG });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('наслоение');
  });

  it('А: пара, пересекающаяся уже в покое, не флагается (baseline)', () => {
    const OVERLAP_SVG =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M2 10h10v4H2z"/><path d="M8 10h6v4H8z"/></svg>';
    const gen = generated([
      {
        paths: [0],
        anchor: [7, 12],
        keyframes: [still, { offset: 0.5, transform: 'translate(1px, 0px)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    expect(validateMotionCollision({ generated: gen, readSvg: () => OVERLAP_SVG })).toEqual([]);
  });

  it('А: два слоя одной части (синхронный transform) не флагаются друг о друга', () => {
    const gen = generated([
      {
        paths: [0, 1],
        anchor: [12, 12],
        keyframes: [still, { offset: 0.5, transform: 'rotate(180deg)' }, { offset: 1, transform: 'translate(0px, 0px)' }],
        timing,
      },
    ]);
    expect(validateMotionCollision({ generated: gen, readSvg: () => SVG })).toEqual([]);
  });
});
