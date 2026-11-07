import { readFileSync } from 'node:fs';
import { optimize } from 'svgo';
import { describe, expect, it } from 'vitest';
import { capsuleAuthoredFrameMatches, capsuleContentShapeMatches, capsuleSvgFrameMatches } from '../scripts/bench/explorer-journey.js';

// SVGO читает реальный XML без преобразований; adapter даёт DOM-поверхность observer.
function dom(svg) {
  let tree;
  optimize(svg, { multipass: false, plugins: [{ name: 'capture-tree', fn: root => { tree = root; return {}; } }] });
  const convert = (node, parent) => {
    const element = { localName: node.name, namespaceURI: node.attributes.xmlns ?? parent?.namespaceURI,
      attributes: Object.entries(node.attributes).map(([name, value]) => ({ name, value })), parentElement: parent };
    element.children = node.children.filter(child => child.type === 'element').map(child => convert(child, element));
    element.querySelectorAll = () => element.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return element;
  };
  return convert(tree.children.find(node => node.type === 'element'));
}
const frame = svg => ({ viewBox: [0, 0, 24, 24], intrinsicWidth: 24, intrinsicHeight: 24,
  preserveAspectRatio: 'xMidYMid meet', untransformed: true,
  directPathsOnly: capsuleContentShapeMatches(svg), inertGroupsOnly: capsuleContentShapeMatches(svg, true) });

describe('авторские и канонические capsule frames', () => {
  it.each(['Outline/mic', 'Filled/mic', 'Outline/mic-circle', 'Filled/mic-circle'])(
    'читает нейтральные группы настоящего Figma master %s', name => {
      const raw = readFileSync(new URL(`../masters/figma/2416636003859748575/${name}.svg`, import.meta.url), 'utf8');
      const observed = frame(dom(raw));
      expect(observed.directPathsOnly).toBe(false);
      expect(capsuleSvgFrameMatches(observed, [0, 0, 24, 24])).toBe(false);
      expect(capsuleAuthoredFrameMatches(observed, [0, 0, 24, 24])).toBe(true);
    });

  it('канонический output сохраняет отдельный строгий direct-path contract', () => {
    const observed = frame(dom('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 0L1 1Z"/></svg>'));
    expect(capsuleSvgFrameMatches(observed, [0, 0, 24, 24])).toBe(true);
    expect(capsuleAuthoredFrameMatches(observed, [0, 0, 24, 24])).toBe(true);
  });

  it.each(['transform="scale(.8)"', 'opacity="0"', 'style="fill:none"', 'filter="url(#x)"', 'onclick="bad()"'])(
    'отвергает действующий атрибут группы %s', attribute => {
      const svg = dom(`<svg xmlns="http://www.w3.org/2000/svg"><g ${attribute}><path d="M0 0L1 0L1 1Z"/></g></svg>`);
      expect(capsuleAuthoredFrameMatches(frame(svg), [0, 0, 24, 24])).toBe(false);
    });

  it('не принимает другой namespace, вложенный viewport или отсутствие paths', () => {
    for (const content of ['<g xmlns="urn:other"><path d="M0 0Z"/></g>', '<svg><path d="M0 0Z"/></svg>', '<g id="empty"/>']) {
      expect(capsuleContentShapeMatches(dom(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`), true)).toBe(false);
    }
  });
});
