import { describe, expect, it } from 'vitest';
import { capsuleWidthObservationChecks, capsuleViewportMatches, capsuleSvgFrameMatches,
  isFreshCapsuleDownload, matchesAuthoredCapsulePath, capsuleSemanticObservations, capsulePaintMatches,
  capsuleExportPathsMatch } from '../scripts/bench/explorer-journey.js';

const outer = 'M12 1.5C15 1.5 17 3 17 6L17 12C17 15 15 16.8 12 16.8C9 16.8 7 15 7 12L7 6C7 3 9 1.5 12 1.5Z';
const counter = 'M12 3.3C10 3.3 8.8 4.5 8.8 6L8.8 12C8.8 14 10 15 12 15C14 15 15.2 14 15.2 12L15.2 6C15.2 4.5 14 3.3 12 3.3Z';
const narrowOuter = 'M12 1.5C14.7 1.5 16.5 3 16.5 6L16.5 12C16.5 15 14.7 16.8 12 16.8C9.3 16.8 7.5 15 7.5 12L7.5 6C7.5 3 9.3 1.5 12 1.5Z';
const narrowCounter = 'M12 3.3C10.3125 3.3 9.3 4.5 9.3 6L9.3 12C9.3 14 10.3125 15 12 15C13.6875 15 14.7 14 14.7 12L14.7 6C14.7 4.5 13.6875 3.3 12 3.3Z';

const source = () => [
  { id: 'microphone-support', d: 'M4 11C4 20 20 20 20 11Z', fillRule: 'nonzero', contours: [] },
  { id: 'microphone-body', d: outer + counter, fillRule: 'evenodd', contours: [
    { x: 7, y: 1.5, width: 10, height: 15.3 }, { x: 8.8, y: 3.3, width: 6.4, height: 11.7 },
  ] },
  { id: 'microphone-enclosure', d: 'M12 1.5C25 1.5 25 22.5 12 22.5Z', fillRule: 'evenodd', contours: [] },
];
const narrowed = () => {
  const parts = source(), body = parts[1];
  body.d = narrowOuter + narrowCounter;
  body.contours[0].x = 7.5; body.contours[0].width = 9;
  body.contours[1].x = 9.3; body.contours[1].width = 5.4;
  return parts;
};

const negativeAnatomy = { kind: 'compound',
  partIds: ['microphone-enclosure', 'microphone-support', 'microphone-body'], roles: ['container', 'counter', 'counter'] };
const compoundPath = (body = outer) => ({ partId: null, role: null,
  partIds: negativeAnatomy.partIds.join(' '), roles: negativeAnatomy.roles.join(' '),
  d: 'M0 0L24 0L24 24L0 24Z' + 'M4 11C4 20 20 20 20 11Z' + body, fillRule: 'evenodd',
  contours: [{ x: 0, y: 0, width: 24, height: 24 }, { x: 4, y: 11, width: 16, height: 9 },
    { x: body === outer ? 7 : 7.5, y: 1.5, width: body === outer ? 10 : 9, height: 15.3 }] });

const painted = () => ({ paths: [{ fill: 'rgb(16, 16, 16)', color: 'rgb(16, 16, 16)', fillRule: 'evenodd',
  declaredFillRule: 'evenodd', stroke: 'none', fillOpacity: '1', opacity: '1', visibility: 'visible', display: 'inline',
  filter: 'none', maskImage: 'none', clipPath: 'none' }], ancestors: [{ opacity: '1', visibility: 'visible', display: 'block',
  filter: 'none', maskImage: 'none', clipPath: 'none' }] });
describe('capsule export keeps semantic and paint attributes from the accepted visible paths', () => {
  const paths = () => [{ d: compoundPath(narrowOuter).d, 'fill-rule': 'evenodd', fill: 'currentColor',
    'data-parts': negativeAnatomy.partIds.join(' '), 'data-roles': negativeAnatomy.roles.join(' ') }];
  it('admits the same attributes independently of XML attribute order', () => {
    expect(capsuleExportPathsMatch(paths(), paths())).toBe(true);
    expect(capsuleExportPathsMatch(paths().map(path => Object.fromEntries(Object.entries(path).reverse())), paths())).toBe(true);
  });
  it.each([
    ['wrong counter role', path => { path['data-roles'] = 'container counter content'; }],
    ['lost semantic target', path => { delete path['data-parts']; }],
    ['paint disabled only in export', path => { path.style = 'fill:none'; }],
    ['wrong parity', path => { path['fill-rule'] = 'nonzero'; }],
  ])('refuses %s with unchanged geometry and viewport', (_, mutate) => {
    const observed = paths(); mutate(observed[0]);
    expect(capsuleExportPathsMatch(observed, paths())).toBe(false);
  });
});
describe('observed CSS paint cannot silently invalidate correct negative contours', () => {
  it('admits the expected visible current-color evenodd fill', () => {
    expect(capsulePaintMatches(painted())).toBe(true);
  });
  it.each([
    ['fill:none', value => { value.paths[0].fill = 'none'; }],
    ['CSS nonzero override', value => { value.paths[0].fillRule = 'nonzero'; }],
    ['hidden fill', value => { value.paths[0].fillOpacity = '0'; }],
    ['unexpected outline', value => { value.paths[0].stroke = 'rgb(16, 16, 16)'; }],
    ['hidden ancestor', value => { value.ancestors[0].opacity = '0'; }],
    ['clipped parent', value => { value.ancestors[0].clipPath = 'circle(1px)'; }],
  ])('refuses %s while the path and viewport are unchanged', (_, mutate) => {
    const observed = painted(); mutate(observed);
    expect(capsulePaintMatches(observed)).toBe(false);
  });
});

describe('compound negative capsule observation retains one fill and every semantic contour', () => {
  it('accepts healthy narrowing with unchanged container/support and a single negative body', () => {
    const before = capsuleSemanticObservations([compoundPath()], negativeAnatomy);
    const after = capsuleSemanticObservations([compoundPath(narrowOuter)], negativeAnatomy);
    expect(before.map(part => part.id)).toEqual(negativeAnatomy.partIds);
    expect(before.map(part => part.role)).toEqual(negativeAnatomy.roles);
    expect(Object.values(capsuleWidthObservationChecks(before, after, .9))).toEqual(Array(7).fill(true));
    const rawMaster = compoundPath(); rawMaster.partIds = rawMaster.roles = null;
    expect(capsuleSemanticObservations([rawMaster], negativeAnatomy)).toEqual(before);
  });

  it.each([
    ['wrong parity', path => { path.fillRule = 'nonzero'; }],
    ['reordered targets', path => { path.partIds = 'microphone-body microphone-support microphone-enclosure'; }],
    ['positive body replaces knockout', path => { path.roles = 'container counter content'; }],
    ['lost body contour', path => { path.d = path.d.slice(0, path.d.indexOf(outer)); path.contours.pop(); }],
    ['extra unaddressed contour', path => { path.d += 'M1 1L2 1L2 2Z'; }],
    ['invented independently painted part', path => { path.partId = 'microphone-body'; }],
  ])('refuses %s before comparing width', (_, mutate) => {
    const path = compoundPath(); mutate(path);
    expect(() => capsuleSemanticObservations([path], negativeAnatomy)).toThrow(TypeError);
  });

  it('requires one painted compound, complete identities and the same counter roles after narrowing', () => {
    expect(() => capsuleSemanticObservations([compoundPath(), compoundPath()], negativeAnatomy)).toThrow(TypeError);
    expect(() => capsuleSemanticObservations([compoundPath()], { ...negativeAnatomy, partIds: ['body', 'body', 'body'] })).toThrow(TypeError);
    const before = capsuleSemanticObservations([compoundPath()], negativeAnatomy);
    const after = capsuleSemanticObservations([compoundPath(narrowOuter)], negativeAnatomy);
    after[2].role = 'content';
    expect(capsuleWidthObservationChecks(before, after, .9).identity).toBe(false);
  });
});

describe('browser observation separates body width from whole-symbol scaling', () => {
  it('accepts narrowed body, fixed height, fixed counter side walls and untouched neighboring parts', () => {
    expect(Object.values(capsuleWidthObservationChecks(source(), narrowed(), .9))).toEqual(Array(7).fill(true));
    const before = source(), after = narrowed();
    before[1].fillRule = after[1].fillRule = 'nonzero';
    before[1].contours.pop(); after[1].contours.pop();
    before[1].d = outer; after[1].d = narrowOuter;
    expect(Object.values(capsuleWidthObservationChecks(before, after, .9))).toEqual(Array(7).fill(true));
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
    expect(Object.values(capsuleWidthObservationChecks([], [], .9))).toEqual(Array(7).fill(false));
    const after = narrowed(); after[1].contours[0].width = NaN;
    expect(capsuleWidthObservationChecks(source(), after, .9).bodyWidth).toBe(false);
  });
});

describe('raw authored contour correspondence rejects equal-bbox impostors', () => {
  it('admits exact cubic/control law and equivalent H/V or relative spelling', () => {
    expect(matchesAuthoredCapsulePath(outer + counter, narrowOuter + narrowCounter, .9)).toBe(true);
    expect(matchesAuthoredCapsulePath(outer.replace('L17 12', 'V12').replace('L7 6', 'V6'), narrowOuter, .9)).toBe(true);
    expect(matchesAuthoredCapsulePath('m12 1.5c3 0 5 1.5 5 4.5v6c0 3 -2 4.8 -5 4.8c-3 0 -5 -1.8 -5 -4.8v-6c0 -3 2 -4.5 5 -4.5z', narrowOuter, .9)).toBe(true);
  });

  it.each([
    ['jagged L segments replace C', narrowCounter.replace(/C([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g, 'L$1 $2L$3 $4L$5 $6')],
    ['self-crossing counter keeps identical bbox', 'M9.3 3.3L14.7 15L9.3 15L14.7 3.3Z'],
    ['wrong x control preserves bbox', narrowCounter.replace('C10.3125 3.3', 'C10.5 3.3')],
    ['wrong y control preserves bbox', narrowCounter.replace('C10.3125 3.3', 'C10.3125 3.4')],
    ['counter contour reversed', 'M12 3.3C13.6875 3.3 14.7 4.5 14.7 6L14.7 12C14.7 14 13.6875 15 12 15C10.3125 15 9.3 14 9.3 12L9.3 6C9.3 4.5 10.3125 3.3 12 3.3Z'],
    ['closure replaced by endpoint', narrowCounter.replace(/Z$/, 'L12 3.3')],
  ])('refuses %s with otherwise unchanged measured bbox', (_, imposter) => {
    const after = narrowed(); after[1].d = narrowOuter + imposter;
    const result = capsuleWidthObservationChecks(source(), after, .9);
    expect(Object.values(result).slice(0, 6)).toEqual(Array(6).fill(true));
    expect(Object.values(result).every(Boolean)).toBe(false);
    expect(result.contourCorrespondence).toBe(false);
  });

  it.each(['garbageM0 0L1 1Z', 'M0 0A1 1 0 0 0 1 1Z', 'M0 0C0 1 2Z', 'M0 0L1 1', 'M0 0L1 1ZZ'])('refuses malformed/unsupported path %s', d => {
    expect(matchesAuthoredCapsulePath(outer, d, .9)).toBe(false);
  });
});

const viewport = () => ({ viewBox: [0, 0, 24, 24], intrinsicWidth: 24, intrinsicHeight: 24,
  preserveAspectRatio: 'xMidYMid meet', untransformed: true, width: 48, height: 48, screen: { a: 2, b: 0, c: 0, d: 2 } });
describe('rendered viewport and export receipts are independent required observations', () => {
  it('admits the true 24-unit frame rendered at the requested size', () => {
    expect(capsuleViewportMatches(viewport(), [0, 0, 24, 24], 48)).toBe(true);
    expect(capsuleSvgFrameMatches(viewport(), [0, 0, 24, 24])).toBe(true);
  });

  it.each([
    ['48-unit viewBox with correct d', value => { value.viewBox = [0, 0, 48, 48]; }],
    ['changed intrinsic export dimensions', value => { value.intrinsicWidth = 48; }],
    ['ancestor transform', value => { value.untransformed = false; }],
    ['hidden screen scaling', value => { value.screen.a = value.screen.d = 1; }],
    ['wrong aspect-ratio policy', value => { value.preserveAspectRatio = 'none'; }],
    ['CSS changes display size', value => { value.width = 24; }],
  ])('rejects %s', (_, mutate) => {
    const observed = viewport(); mutate(observed);
    expect(capsuleViewportMatches(observed, [0, 0, 24, 24], 48)).toBe(false);
  });

  it('requires exactly one new download with the current filename after each click', () => {
    const previous = [{ filename: 'mic-outline-variation.svg' }];
    expect(isFreshCapsuleDownload(previous, 1, 'mic-outline-variation.svg')).toBe(false);
    expect(isFreshCapsuleDownload([...previous, { filename: 'mic-outline-variation.svg' }], 1, 'mic-outline-variation.svg')).toBe(true);
    expect(isFreshCapsuleDownload([...previous, { filename: 'mic-outline.svg' }], 1, 'mic-outline-variation.svg')).toBe(false);
    expect(isFreshCapsuleDownload([...previous, ...previous, ...previous], 1, 'mic-outline-variation.svg')).toBe(false);
  });
});
