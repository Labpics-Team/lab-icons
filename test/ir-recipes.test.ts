import { describe, expect, it } from 'vitest';
import {
  buildCalendarNumberGeometry,
  buildDirectionalArrow,
  buildMusicalNotes,
  generateRadialRays,
  glyphOpszRange,
  type NegativeSpaceConstraint,
  type NegativeSpaceContract,
} from '../src/ir/recipes.js';

describe('public recipe kernels', () => {
  it('экспортирует одну opsz-шкалу и формульные directional/radial/note families', () => {
    expect(glyphOpszRange).toEqual({ min: 16, default: 24, max: 48 });
    expect(buildDirectionalArrow({ orientation: 'down', shaftLength: 0.6 }).parts.map((part) => part.id))
      .toEqual(['head', 'shaft']);
    expect(generateRadialRays({ length: 0, count: 8 }).parts.map((part) => part.id))
      .toEqual(['ray.n', 'ray.ne', 'ray.e', 'ray.se', 'ray.s', 'ray.sw', 'ray.w', 'ray.nw']);
    expect(buildMusicalNotes({
      notes: [
        { id: 'left', headCenter: { x: 0.33, y: 0.68 } },
        { id: 'right', headCenter: { x: 0.62, y: 0.58 } },
      ],
    }).parts.at(-1)?.id).toBe('beam');

    const arrow = buildDirectionalArrow();
    const negativeSpace: NegativeSpaceContract = arrow.negativeSpace;
    const constraint: NegativeSpaceConstraint = negativeSpace.constraints[0]!;
    expect(constraint.unit).toBe('normalized-canvas');
    expect(constraint.measured).toBeGreaterThanOrEqual(constraint.requiredMinimum);
    expect(constraint.participants.length).toBeGreaterThanOrEqual(2);
  });

  it('calendar date зависит только от явных instant и timeZone', () => {
    const result = buildCalendarNumberGeometry({
      date: new Date('2026-07-01T00:30:00.000Z'),
      timeZone: 'America/Los_Angeles',
      opsz: 24,
    });
    expect(result.day).toBe(30);
    expect(result.parts.map((part) => part.id)).toEqual([
      'calendar.date.tens',
      'calendar.date.ones',
    ]);
    const digitGap: NegativeSpaceConstraint = result.negativeSpace.constraints[1]!;
    expect(digitGap.measurementMethod).toBe('horizontal-ink-bounds-separation');
  });
});
