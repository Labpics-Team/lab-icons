import { describe, expect, it } from 'vitest';
import { readSemanticPartOpacities } from '../scripts/bench/explorer-journey.js';

const ids = ['dot-leading', 'dot-middle', 'dot-trailing'];
const node = (id, opacity) => ({ id, opacity });
function fixture() {
  const mounted = new Map(ids.map(id => [id, node(id, '0.4')]));
  const root = { querySelector(selector) { return mounted.get(selector.match(/^\[data-part="(.+)"\]$/)[1]); } };
  const style = part => ({ opacity: mounted.get(part.id) === part ? part.opacity : '' });
  return { mounted, root, style };
}

describe('Observatory наблюдает текущие семантические части', () => {
  it('после смены жеста читает новый DOM, сохраняя порядок identity', () => {
    const { mounted, root, style } = fixture();
    const previous = ids.map(id => mounted.get(id));
    expect(readSemanticPartOpacities(root, ids, style)).toEqual([0.4, 0.4, 0.4]);
    for (const id of [...ids].reverse()) mounted.set(id, node(id, '1'));
    expect(previous.map(part => Number(style(part).opacity))).toEqual([0, 0, 0]);
    expect(readSemanticPartOpacities(root, ids, style)).toEqual([1, 1, 1]);
  });

  it('читает реальную незавершённую позу вместо подстановки terminal', () => {
    const { mounted, root, style } = fixture();
    mounted.set(ids[1], node(ids[1], '0.6'));
    mounted.set(ids[2], node(ids[2], '0'));
    expect(readSemanticPartOpacities(root, ids, style)).toEqual([0.4, 0.6, 0]);
  });

  it('отвергает отсутствующий target и пустой набор вместо vacuous success', () => {
    const { mounted, root, style } = fixture();
    mounted.delete(ids[1]);
    expect(() => readSemanticPartOpacities(root, ids, style)).toThrow(/missing semantic opacity target dot-middle/);
    expect(() => readSemanticPartOpacities(root, [], style)).toThrow(/missing semantic opacity targets/);
  });

  it.each(['', ' ', 'NaN', 'Infinity', '-0.1', '1.1'])('не принимает ненаблюдаемую opacity %j', opacity => {
    const { mounted, root, style } = fixture();
    mounted.get(ids[0]).opacity = opacity;
    expect(() => readSemanticPartOpacities(root, ids, style)).toThrow(/unobserved opacity dot-leading/);
  });
});
