import { describe, expect, it, vi } from 'vitest';
import { inspectLoadingGraphs, loadingAdapterSource, validateLoadingIdentity, verifiedLoadingIcons, withIndependentBrowser } from '../scripts/bench/loading-consumer.js';
import { bundleMeasurements } from '../scripts/bench/static-consumer.js';

const names = ['accessibility', 'alert', 'time'];
const report = () => ({ manifestSha256: 'a'.repeat(64), expectedCounts: { families: names.length, variants: names.length * 2 },
  completed: names.length * 2, icons: Object.fromEntries(names.map(icon => [icon, Object.fromEntries(['outline', 'filled'].map(variant =>
    [variant, { icon, variant, svgSha256: 'b'.repeat(64) }]))])) });
const packet = () => ({ staticSvg: '<svg/>', glyph: { icon: 'alert', svg: '<svg data-part="source-0"/>',
  parts: [{ id: 'source-0', role: 'unclassified', d: 'M1 1L2 2', fillRule: 'evenodd', zIndex: 0 }],
  provenance: { file: 'svg/Outline/alert.svg', author: { fileKey: 'figma-file', nodeId: '1:2', version: '3' } } } });
const graph = (label, retainedNames, parsedNames = retainedNames) => ({ label,
  inputs: parsedNames.map(icon => ({ file: `/installed/dist/symbols/${icon}.js`, bytes: 100 })),
  retainedInputs: [...retainedNames.map(icon => ({ file: `/installed/dist/symbols/${icon}.js`, bytesInOutput: 20 })),
    { file: '/installed/dist/ir/symbol-runtime.js', bytesInOutput: 10 }] });
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function mockAdapter(icon, label) {
  let source = loadingAdapterSource(names, icon, label);
  for (const name of names) {
    const value = packet(); value.glyph.icon = name;
    const symbol = moduleUrl(`const value=${JSON.stringify(value)}; export const outline=value.staticSvg; export const glyph=()=>value.glyph;`);
    source = source.replaceAll(JSON.stringify(`@labpics/icons/symbols/${name}`), JSON.stringify(symbol));
  }
  return import(moduleUrl(source));
}

describe('same-artifact glyph loading control', () => {
  it('полная проверенная manifest-проекция совпадает с публичными release names', () => {
    expect(verifiedLoadingIcons(report(), [...names].reverse())).toEqual(names);
    for (const change of [value => { value.completed--; }, value => { delete value.icons.time; },
      value => { delete value.icons.alert.filled; }, value => { value.icons.alert.outline.icon = 'time'; },
      value => { value.manifestSha256 = ''; }, value => { value.failure = {}; }]) {
      const bad = report(); change(bad);
      expect(() => verifiedLoadingIcons(bad, names)).toThrow();
    }
    expect(() => verifiedLoadingIcons(report(), names.slice(1))).toThrow();
    expect(() => verifiedLoadingIcons(report(), [...names, '../private'])).toThrow();
    expect(() => verifiedLoadingIcons(report(), [...names, 'alert'])).toThrow();
  });

  it('registry создаёт обычные публичные glyph imports без принуждения bundler retention', () => {
    const eager = loadingAdapterSource(names, 'alert', 'eager-registry');
    const direct = loadingAdapterSource(names, 'alert', 'direct-icon');
    expect(eager.match(/import \{ glyph as/g)).toHaveLength(names.length);
    for (const icon of names) expect(eager).toContain(`from "@labpics/icons/symbols/${icon}"`);
    expect(eager).toContain('const selectedGlyph = registry["alert"]');
    expect(direct.match(/import \{ glyph as/g)).toHaveLength(1);
    expect(direct).toContain('from "@labpics/icons/symbols/alert"');
    for (const source of [eager, direct]) {
      expect(source).toContain('export const create = () => glyph().svg');
      expect(source).toContain('export { outline } from "@labpics/icons/symbols/alert"');
      expect(source).not.toMatch(/globalThis|window|eval|measureScene|@__NO_SIDE_EFFECTS__/);
    }
    expect(() => loadingAdapterSource(names, 'unknown', 'direct-icon')).toThrow();
    expect(() => loadingAdapterSource(names, 'alert', 'literal')).toThrow();
  });

  it('same GlyphIR не допускает drift геометрии, static SVG, winding, частей или Figma provenance', () => {
    expect(validateLoadingIdentity(packet(), packet())).toMatchObject({ completedBytes: packet().glyph.svg.length });
    for (const change of [value => { value.glyph.svg += ' '; }, value => { value.staticSvg += ' '; },
      value => { value.glyph.parts[0].d = 'M1 1L3 3'; }, value => { value.glyph.parts[0].fillRule = 'nonzero'; },
      value => { value.glyph.parts[0].id = 'source-1'; }, value => { value.glyph.provenance.author.version = '4'; }]) {
      const bad = packet(); change(bad);
      expect(() => validateLoadingIdentity(packet(), bad)).toThrow(/различаются/);
    }
  });

  it('оба настоящих adapter источника выбирают тот же mock GlyphIR и create SVG', async () => {
    const eager = await mockAdapter('alert', 'eager-registry'), direct = await mockAdapter('alert', 'direct-icon');
    expect(eager.glyph()).toEqual(packet().glyph);
    expect(direct.glyph()).toEqual(packet().glyph);
    expect(eager.create()).toBe(packet().glyph.svg);
    expect(direct.create()).toBe(eager.create());
    expect(() => validateLoadingIdentity({ glyph: eager.glyph(), staticSvg: eager.outline }, { glyph: direct.glyph(), staticSvg: direct.outline })).not.toThrow();
    const wrong = await mockAdapter('time', 'eager-registry');
    expect(() => validateLoadingIdentity({ glyph: wrong.glyph(), staticSvg: wrong.outline }, { glyph: direct.glyph(), staticSvg: direct.outline })).toThrow();
  });

  it('каждому browser sample даёт отдельный launch и закрывает process после отказа', async () => {
    const launched = [];
    const chromium = { launch: vi.fn(async () => {
      const browser = { id: launched.length, close: vi.fn(async () => {}) }; launched.push(browser); return browser;
    }) };
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(await withIndependentBrowser(chromium, async browser => browser.id)).toBe(repeat);
    }
    await expect(withIndependentBrowser(chromium, async () => { throw new Error('measurement failed'); })).rejects.toThrow('measurement failed');
    expect(chromium.launch).toHaveBeenCalledTimes(4);
    for (const browser of launched) expect(browser.close).toHaveBeenCalledOnce();
    expect(chromium.launch).toHaveBeenCalledWith({ headless: true });
  });

  it('actual bytesInOutput подтверждает полный registry и одиночный symbol, разрешая общий compiler', () => {
    const result = inspectLoadingGraphs([graph('eager-registry', names), graph('direct-icon', ['alert'])], names, 'alert');
    expect(result.status).toBe('QUALIFIED');
    expect(result.graphs[0].retainedSymbols).toHaveLength(names.length);
    expect(result.graphs[1].retainedSymbols).toEqual([{ icon: 'alert', bytesInOutput: 20 }]);
    const windows = graph('direct-icon', ['alert']);
    windows.retainedInputs[0].file = 'E:\\installed\\dist\\symbols\\alert.js';
    expect(inspectLoadingGraphs([graph('eager-registry', names), windows], names, 'alert').status).toBe('QUALIFIED');
  });

  it('parsed full-catalog против retained one — отрицательный контроль, а не выигрыш full loading', () => {
    const bytes = Buffer.from('export const create=()=>"svg";');
    const facts = bundleMeasurements(bytes, { inputs: Object.fromEntries(names.map(icon => [`/installed/dist/symbols/${icon}.js`, { bytes: 100 }])),
      outputs: { 'consumer.js': { inputs: Object.fromEntries(names.map(icon => [`/installed/dist/symbols/${icon}.js`, { bytesInOutput: icon === 'alert' ? 20 : 0 }])) } } });
    expect(facts.inputs).toHaveLength(names.length);
    expect(facts.retainedInputs).toHaveLength(1);
    expect(inspectLoadingGraphs([{ label: 'eager-registry', ...facts }, graph('direct-icon', ['alert'])], names, 'alert'))
      .toMatchObject({ status: 'INCOMPLETE', reason: 'EAGER_REGISTRY_NOT_RETAINED' });
  });

  it('неполный direct graph и повреждённое evidence не квалифицируют loading control', () => {
    expect(inspectLoadingGraphs([graph('eager-registry', names), graph('direct-icon', names)], names, 'alert'))
      .toMatchObject({ status: 'INCOMPLETE', reason: 'DIRECT_ICON_GRAPH_UNQUALIFIED' });
    expect(inspectLoadingGraphs([], names, 'alert').status).toBe('INCOMPLETE');
    expect(inspectLoadingGraphs([graph('eager-registry', names), { label: 'direct-icon', inputs: [], retainedInputs: [{ file: 'x', bytesInOutput: 0 }] }], names, 'alert'))
      .toMatchObject({ status: 'INCOMPLETE', reason: 'INVALID_LOADING_GRAPH' });
  });
});
