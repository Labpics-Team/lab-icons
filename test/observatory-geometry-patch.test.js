import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyEnclosurePatch, visibleStateSvg } from '../observatory/geometry-patch.js';

const identity = { group: 'fixture', variant: 'outline', enclosurePartId: 'frame',
  states: [{ partId: 'state-first' }, { partId: 'state-second' }] };
const patch = { contract: 'labpics.symbol-geometry-patch/1', version: 1,
  group: 'fixture', variant: 'outline', partId: 'frame', attributes: { d: 'VARIED_OUTER_AND_COUNTER' } };
function node(id, tagName = 'path', role = 'container') {
  return { dataset: { part: id, role }, tagName, style: {}, attributes: { d: 'AUTHORED_MASTER' }, writes: 0,
    setAttribute(name, value) { this.attributes[name] = value; this.writes++; }, closest: () => null };
}

afterEach(() => vi.unstubAllGlobals());

describe('Observatory: готовая геометрия общей части', () => {
  it('меняет одну часть, сохраняя все узлы и видимую смесь', () => {
    const enclosure = node('frame'), first = node('state-first', 'g', 'state'), second = node('state-second', 'g', 'state');
    first.style.opacity = '0.35'; second.style.opacity = '0.65';
    const nodes = [first, second, enclosure];
    const root = { querySelectorAll: () => nodes };
    applyEnclosurePatch(root, patch, identity);
    expect(root.querySelectorAll()).toEqual(nodes);
    expect(enclosure.attributes.d).toBe(patch.attributes.d);
    expect(enclosure.writes).toBe(1);
    expect([first.writes, second.writes]).toEqual([0, 0]);
    expect([first.style.opacity, second.style.opacity]).toEqual(['0.35', '0.65']);
  });

  it.each([
    { contract: 'unknown' }, { version: 2 }, { group: 'other' }, { variant: 'filled' },
    { partId: 'state-first' }, { attributes: { d: '' } }, { attributes: { d: 'OK', opacity: 0 } },
  ])('отказывает чужому или неоднозначному patch до записи: %j', change => {
    const enclosure = node('frame');
    expect(() => applyEnclosurePatch({ querySelectorAll: () => [enclosure] }, { ...patch, ...change }, identity)).toThrow();
    expect(enclosure.writes).toBe(0);
  });

  it('не выбирает первый контур при дублировании ID или оболочке внутри state', () => {
    const left = node('frame'), right = node('frame');
    expect(() => applyEnclosurePatch({ querySelectorAll: () => [left, right] }, patch, identity)).toThrow();
    expect([left.writes, right.writes]).toEqual([0, 0]);
    left.closest = () => node('state-first', 'g');
    expect(() => applyEnclosurePatch({ querySelectorAll: () => [left] }, patch, identity)).toThrow();
    expect(left.writes).toBe(0);
  });
});

describe('Observatory: экспорт видимой смеси', () => {
  function fixture(ids = ['state-first', 'state-second']) {
    const groups = ids.map(id => node(id, 'g', 'state'));
    groups.forEach((group, index) => { group.attributes.opacity = index ? '0' : '1'; });
    const copies = groups.map(group => ({ ...group, dataset: { ...group.dataset }, style: {}, attributes: { ...group.attributes } }));
    const clone = { style: {}, querySelectorAll: () => copies };
    const source = { querySelectorAll: () => groups, cloneNode: () => clone };
    const reads = [];
    vi.stubGlobal('getComputedStyle', element => {
      reads.push(element); return { opacity: element === groups[0] ? '0.35' : '0.65' };
    });
    vi.stubGlobal('XMLSerializer', class { serializeToString(svg) {
      return JSON.stringify({ color: svg.style.color, groups: svg.querySelectorAll().map(group => group.attributes.opacity) });
    } });
    return { root: { querySelector: () => source }, groups, copies, reads };
  }

  it('экспортирует computed opacity один раз на группу; original defaults не выдаются за видимую позу', () => {
    const input = fixture();
    expect(JSON.parse(visibleStateSvg(input.root, identity, '#336699')))
      .toEqual({ color: '#336699', groups: ['0.35', '0.65'] });
    expect(input.reads).toEqual(input.groups);
    expect(input.groups.map(group => group.attributes.opacity)).toEqual(['1', '0']);
    expect(input.groups.map(group => group.writes)).toEqual([0, 0]);
  });

  it.each([['state-first'], ['state-first', 'state-first'], ['state-first', 'unknown']])
    ('отказывает неполной или чужой mounted composition: %j', (...ids) => {
      const input = fixture(ids);
      expect(() => visibleStateSvg(input.root, identity, '#000')).toThrow();
      expect(input.groups.every(group => group.writes === 0)).toBe(true);
    });
});
