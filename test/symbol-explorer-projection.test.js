import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stateExplorerGroups, symbolExplorerBrowserFiles } from '../scripts/lib/symbol-explorer.js';
import { symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';

const base = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));
const spec = { groups: { 'status-circle': { states: {
  question: { icon: 'fixture', variant: 'outline' },
} } } };

describe('browser-проекция принятых symbol capabilities', () => {
  it('пустые state-группы сохраняют статические symbol и Lottie entries', () => {
    const contract = symbolReleaseProjection(base, ['fixture']);
    const groups = stateExplorerGroups({ groups: {} });
    const files = symbolExplorerBrowserFiles(contract, ['fixture'], groups);
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
});
