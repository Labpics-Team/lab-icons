import { expect, it } from 'vitest';
// @ts-expect-error Build-only JavaScript compiler.
import { compileOpticalGrid } from '../scripts/lib/optical-grid.js';
import { renderIcon, type IconSymbol, type RenderIconOptions } from '../src/render/index.js';

const axes = { weight: [300, 400, 600], opsz: [16, 24, 48] };
const path = (x: number) => ({ d: `M0 0L${x} 0L${x} 8L0 8Z`, fillRule: 'evenodd' });
const compiled = compileOpticalGrid({ axes, source: [path(10)], masters: axes.weight.flatMap(weight => axes.opsz.map(opsz => ({
  weight, opsz, paths: [path(10 + (weight - 400) / 100 + (opsz - 24) / 8)],
}))) });
const symbol: IconSymbol = { id: 'test', outline: '<svg>exact source outline</svg>', filled: '<svg>exact source filled</svg>',
  data: { version: 1, axes: compiled.axes, variants: { outline: compiled, filled: compiled } } };

it('retains the source SVG literal at 400/24 in either style', () => {
  expect(renderIcon(symbol)).toBe(symbol.outline);
  expect(renderIcon(symbol, { variant: 'filled', weight: 400, opsz: 24, size: 24 })).toBe(symbol.filled);
});
it('auto opsz follows and clamps size while explicit opsz is independent', () => {
  expect(renderIcon(symbol, { size: 8 })).toContain('d="M0 0L9 0L9 8L0 8Z"');
  expect(renderIcon(symbol, { size: 64 })).toContain('d="M0 0L13 0L13 8L0 8Z"');
  expect(renderIcon(symbol, { size: 20, opsz: 24 })).toContain('d="M0 0L10 0L10 8L0 8Z"');
  expect(renderIcon(symbol, { size: 20 })).toContain('width="20" height="20"');
  expect(renderIcon(symbol, { size: 20 })).toContain('d="M0 0L9.5 0L9.5 8L0 8Z"');
});
it.each([{ size: 0 }, { size: NaN }, { size: Infinity }, { weight: 601 }, { opsz: 15 }, { opsz: 49 }])(
  'rejects invalid requests without silently rendering the source: %o', options => {
    expect(() => renderIcon(symbol, options)).toThrow(RangeError);
  });
it('uses only explicitly declared semantic states and rejects unknown styles', () => {
  const selected: IconSymbol = { ...symbol, id: 'selected', outline: '<svg>selected outline</svg>' };
  expect(renderIcon({ ...symbol, states: { selected } }, { state: 'selected' })).toBe(selected.outline);
  expect(() => renderIcon(symbol, { state: 'selected' })).toThrow('does not define state');
  expect(() => renderIcon(symbol, { variant: 'bold' } as unknown as RenderIconOptions)).toThrow('variant');
  for (const field of ['variant', 'size', 'weight', 'opsz']) {
    expect(() => renderIcon(symbol, { [field]: null } as unknown as RenderIconOptions)).toThrow(RangeError);
  }
});
