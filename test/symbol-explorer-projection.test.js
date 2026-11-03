import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stateExplorerGroups, symbolExplorerBrowserFiles, symbolExplorerVariationIds, symbolExplorerStateVariationIds,
  symbolExplorerGestureProjection } from '../scripts/lib/symbol-explorer.js';
import { symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';

const base = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));
const spec = { groups: { 'status-circle': { states: {
  question: { icon: 'fixture', variant: 'outline' },
} } } };

describe('browser-проекция принятых symbol capabilities', () => {
  const gestureFixture = () => {
    const contract = symbolReleaseProjection(base, ['timer', 'mic'], [], [], [], [], [], [], [], ['timer']);
    contract.files.push('dist/gestures/mic.js', 'dist/gestures/mic.d.ts');
    const surface = { './gestures/timer': ['compileMotionEffect', 'motionCapabilities', 'renderMotionSvg'],
      './gestures/mic': ['motionCapabilities', 'prepareBodyWidth'] };
    return { contract, surface };
  };

  it('копирует публичные gesture targets и отличает rotation от prepared sampler', () => {
    const { contract, surface } = gestureFixture();
    expect(symbolExplorerGestureProjection(contract, ['timer', 'mic'], surface))
      .toEqual({ iconIds: ['mic', 'timer'], rotationIconIds: ['timer'], preparedWidthIconIds: ['mic'] });
    const files = symbolExplorerBrowserFiles(contract, ['timer', 'mic'], [], surface);
    expect(files).toContain('dist/gestures/timer.js');
    expect(files).toContain('dist/gestures/mic.js');
    expect(files).toContain('dist/ir/gesture-runtime.js');
    expect(files).not.toContain('dist/gestures/timer.d.ts');
  });

  it.each([
    ['private export', value => { delete value.contract.exports['./gestures/*']; }, /публичного package entry/],
    ['missing types', value => { value.contract.files = value.contract.files.filter(file => file !== 'dist/gestures/timer.d.ts'); }, /declaration/],
    ['missing surface', value => { delete value.surface['./gestures/timer']; }, /export surface/],
    ['incomplete rotation', value => { value.surface['./gestures/timer'].pop(); }, /неполный rotation contract/],
    ['incomplete prepared width', value => { value.surface['./gestures/mic'] = ['prepareBodyWidth']; }, /неполный prepared width contract/],
    ['orphan surface', value => { value.surface['./gestures/other'] = ['prepareBodyWidth']; }, /не имеет package target/],
  ])('не выдаёт %s за browser capability', (_, mutate, reason) => {
    const value = gestureFixture(); mutate(value);
    expect(() => symbolExplorerBrowserFiles(value.contract, ['timer', 'mic'], [], value.surface)).toThrow(reason);
  });

  it('не связывает gesture target с чужим авторским каталогом', () => {
    const { contract, surface } = gestureFixture();
    expect(() => symbolExplorerGestureProjection(contract, ['mic'], surface)).toThrow(/авторскому каталогу/);
  });

  it('opt-in оболочка принадлежит реальной группе и публичной паре JS/types', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], ['status-circle']);
    contract.exports['./state-variations/*'] = { import: './dist/state-variations/*.js', types: './dist/state-variations/*.d.ts' };
    contract.files.push('dist/state-variations/status-circle.js', 'dist/state-variations/status-circle.d.ts');
    const groups = stateExplorerGroups(spec);
    expect(symbolExplorerStateVariationIds(contract, groups)).toEqual(['status-circle']);
    expect(symbolExplorerBrowserFiles(contract, ['fixture'], groups)).toContain('dist/state-variations/status-circle.js');
    expect(() => symbolExplorerStateVariationIds(contract, [])).toThrow(/semantic group/);
    const privateEntry = { ...contract, exports: { ...contract.exports } };
    delete privateEntry.exports['./state-variations/*'];
    expect(() => symbolExplorerStateVariationIds(privateEntry, groups)).toThrow(/публичного package entry/);
    expect(() => symbolExplorerStateVariationIds({ ...contract, files: contract.files.filter(file => !file.endsWith('state-variations/status-circle.d.ts')) }, groups))
      .toThrow(/declaration/);
  });
  it('пустые state-группы сохраняют статические symbol и Lottie entries', () => {
    const contract = symbolReleaseProjection(base, ['fixture']);
    const groups = stateExplorerGroups({ groups: {} });
    const files = symbolExplorerBrowserFiles(contract, ['fixture'], groups);
    expect(symbolExplorerVariationIds(contract, ['fixture'])).toEqual([]);
    expect(files).toContain('dist/symbols/fixture.js');
    expect(files).toContain('dist/lottie/fixture.js');
    expect(files).not.toContain('dist/ir/state-runtime.js');
    expect(files.filter(file => file.startsWith('dist/states/'))).toEqual([]);
  });

  it('непустые группы получают runtime и точный публичный state entry', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], ['status-circle']);
    const groups = stateExplorerGroups(spec);
    const files = symbolExplorerBrowserFiles(contract, ['fixture'], groups);
    expect(files.filter(file => file === 'dist/ir/state-runtime.js')).toHaveLength(1);
    expect(files.filter(file => file.startsWith('dist/states/'))).toEqual(['dist/states/status-circle.js']);
    expect(groups).toEqual([{ group: 'status-circle', members: [
      { state: 'question', icon: 'fixture', variant: 'outline' },
    ] }]);
  });

  it('semantic group не открывает entry вне package contract', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], ['status-circle']);
    expect(() => symbolExplorerBrowserFiles(contract, ['fixture'], [{ group: 'unpublished' }]))
      .toThrow(/dist\/states\/unpublished\.js не принадлежит package contract/);
  });

  it('устаревший state entry в контракте не выдаётся за актуальную semantic group', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], ['status-circle']);
    expect(() => symbolExplorerBrowserFiles(contract, ['fixture'], []))
      .toThrow(/dist\/states\/status-circle\.js не имеет semantic group/);
  });

  it('variation и будущий private runtime приходят из владельца package contract', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], [], ['fixture']);
    const futureRuntime = 'dist/ir/fixture-source-runtime.js';
    contract.runtimeDependencies.push(futureRuntime);
    contract.files.push(futureRuntime);
    const files = symbolExplorerBrowserFiles(contract, ['fixture'], []);
    expect(symbolExplorerVariationIds(contract, ['fixture'])).toEqual(['fixture']);
    expect(files.filter(file => file === 'dist/variations/fixture.js')).toHaveLength(1);
    expect(files.filter(file => file === 'dist/ir/variation-runtime.js')).toHaveLength(1);
    expect(files.filter(file => file === futureRuntime)).toHaveLength(1);
    expect(files).not.toContain('dist/ir/authored-variation.d.ts');
  });

  it('не открывает вариативность вне каталога, публичных exports или declarations', () => {
    const contract = symbolReleaseProjection(base, ['fixture'], [], ['fixture']);
    expect(() => symbolExplorerVariationIds(contract, ['other'])).toThrow(/не принадлежит авторскому каталогу/);
    const privateEntry = { ...contract, exports: { ...contract.exports } };
    delete privateEntry.exports['./variations/*'];
    expect(() => symbolExplorerVariationIds(privateEntry, ['fixture'])).toThrow(/публичного package entry/);
    const wrongTypes = { ...contract, exports: { ...contract.exports,
      './variations/*': { ...contract.exports['./variations/*'], types: './dist/unpublished/*.d.ts' } } };
    expect(() => symbolExplorerVariationIds(wrongTypes, ['fixture'])).toThrow(/публичного package entry/);
    const missingDeclaration = { ...contract, files: contract.files.filter(file => file !== 'dist/variations/fixture.d.ts') };
    expect(() => symbolExplorerVariationIds(missingDeclaration, ['fixture'])).toThrow(/не имеет declaration/);
  });

  it('private runtime вне package files отклоняется до записи browser-проекции', () => {
    const contract = symbolReleaseProjection(base, ['fixture']);
    contract.runtimeDependencies.push('dist/ir/unpublished.js');
    expect(() => symbolExplorerBrowserFiles(contract, ['fixture'], []))
      .toThrow(/dist\/ir\/unpublished\.js не принадлежит package contract/);
  });
});
