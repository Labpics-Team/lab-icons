import { describe, expect, it } from 'vitest';
import { capsuleWidthObservationChecks } from '../scripts/bench/explorer-journey.js';

const source = () => [
  { id: 'microphone-support', d: 'M4 11C4 20 20 20 20 11Z', fillRule: 'nonzero', contours: [] },
  { id: 'microphone-body', d: 'authored hollow body', fillRule: 'evenodd', contours: [
    { x: 7, y: 1.5, width: 10, height: 15.3 }, { x: 8.8, y: 3.3, width: 6.4, height: 11.7 },
  ] },
  { id: 'microphone-enclosure', d: 'M12 1.5C25 1.5 25 22.5 12 22.5Z', fillRule: 'evenodd', contours: [] },
];
const narrowed = () => {
  const parts = source(), body = parts[1];
  body.d = 'narrowed hollow body';
  body.contours[0].x = 7.5; body.contours[0].width = 9;
  body.contours[1].x = 9.3; body.contours[1].width = 5.4;
  return parts;
};

describe('browser observation separates body width from whole-symbol scaling', () => {
  it('accepts narrowed body, fixed height, fixed counter side walls and untouched neighboring parts', () => {
    expect(Object.values(capsuleWidthObservationChecks(source(), narrowed(), .9))).toEqual(Array(6).fill(true));
    const before = source(), after = narrowed();
    before[1].fillRule = after[1].fillRule = 'nonzero';
    before[1].contours.pop(); after[1].contours.pop();
    expect(Object.values(capsuleWidthObservationChecks(before, after, .9))).toEqual(Array(6).fill(true));
  });

  it.each([
    ['support shrinks with body', parts => { parts[0].d = 'scaled support'; }, 'unchangedOtherParts'],
    ['enclosure shrinks with body', parts => { parts[2].d = 'scaled enclosure'; }, 'unchangedOtherParts'],
    ['scaleX thins hollow walls', parts => { parts[1].contours[1].width = 6.4 * .9; }, 'counterWalls'],
    ['body also becomes shorter', parts => { parts[1].contours[0].height *= .9; }, 'bodyPosition'],
    ['body drifts off center', parts => { parts[1].contours[0].x += .05; }, 'bodyPosition'],
    ['counter loses vertical identity', parts => { parts[1].contours[1].y += .05; }, 'bodyPosition'],
    ['counter disappears', parts => { parts[1].contours.pop(); }, 'counterWalls'],
    ['filled shape replaces hollow body', parts => { parts[1].fillRule = 'nonzero'; }, 'identity'],
    ['body gains different identity', parts => { parts[1].id = 'unknown-body'; }, 'identity'],
    ['width is clamped instead of requested', parts => { parts[1].contours[0].width = 8.5; }, 'bodyWidth'],
  ])('refuses %s', (_, mutate, property) => {
    const after = narrowed(); mutate(after);
    expect(capsuleWidthObservationChecks(source(), after, .9)[property]).toBe(false);
  });

  it('does not pass no-op, missing anatomy or nonfinite browser measurement', () => {
    expect(capsuleWidthObservationChecks(source(), source(), .9)).toMatchObject({ bodyChanged: false, bodyWidth: false });
    expect(Object.values(capsuleWidthObservationChecks([], [], .9))).toEqual(Array(6).fill(false));
    const after = narrowed(); after[1].contours[0].width = NaN;
    expect(capsuleWidthObservationChecks(source(), after, .9).bodyWidth).toBe(false);
  });
});
