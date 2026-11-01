import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots = [];
const subject = readFileSync(new URL('../scripts/measure-platform-artifacts.mjs', import.meta.url), 'utf8');
const hash = '0'.repeat(40);
const file = 'dist/ir/recipes.js';
const twin = 'dist/ir/retained.js';
const original = '// scripts/lib/kernel.js\nexport const value = 1;\n';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ source = original, other = source, modules = ['scripts/lib/kernel.js'], ceiling = 4096 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-measure-policy-'));
  roots.push(root);
  for (const directory of ['scripts', 'release', 'dist/ir']) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'scripts/measure-platform-artifacts.mjs'), subject.replace(
    "import { execFileSync } from 'node:child_process';", `const execFileSync = () => '${hash}';`,
  ));
  // Здесь проверяется admission policy; compressor и bundler проверяются отдельно.
  writeFileSync(join(root, 'scripts/check-package-size.js'), `
    export const PACKAGE_SIZE_MEASUREMENT = 'fixture package oracle';
    export const parsePackageSizeRatchet = value => value;
    export function measureArtifact(source) {
      return { bytes: source.length, gzipBytes: source.length + 1,
        modules: source.toString().split(String.fromCharCode(10)).filter(line =>
          ['// scripts/', '// src/', '// semantics/'].some(prefix => line.startsWith(prefix))).map(line => line.slice(3)).sort() };
    }
  `);
  writeFileSync(join(root, 'scripts/check-consumer-size.js'), `
    export const CONSUMER_SIZE_MEASUREMENT = 'fixture consumer oracle';
    export const parseConsumerSizeRatchet = value => value;
    export async function bundleScenario() { return { bytes: 10, gzipBytes: 11, modules: ['dist/fixture.js'] }; }
  `);
  writeFileSync(join(root, file), source);
  writeFileSync(join(root, twin), other);
  const artifacts = Object.fromEntries([file, twin].map(path => [path, {
    baselineBytes: original.length, baselineGzipBytes: original.length + 1,
    maxBytes: ceiling, maxGzipBytes: ceiling, allowedModules: modules,
    forbiddenNeedles: ['@labpics/icons', '<svg', 'ICON_IDS', 'semantics/catalog', 'sourceMappingURL'],
    ...(path === file ? { identicalTo: twin } : {}),
  }]));
  const entry = "import { value } from '@labpics/icons';\nconsole.log(value);\n";
  const scenarios = Object.fromEntries(['one-static', 'glyph-one', 'full-catalog', 'recipes-only'].map(name => [name, {
    entry, baselineBytes: 10, baselineGzipBytes: 11, maxBytes: 100, maxGzipBytes: 101,
  }]));
  const policy = { version: 1, measurement: 'fixture package oracle', artifacts };
  writeFileSync(join(root, 'release/package-size-ratchet.json'), JSON.stringify(policy));
  writeFileSync(join(root, 'release/consumer-size-ratchet.json'), JSON.stringify({ version: 1, measurement: 'fixture consumer oracle', scenarios }));
  writeFileSync(join(root, 'release/contract.json'), JSON.stringify({ files: [file, twin] }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'fixture-lock\n');
  return { root, policy };
}

function run(root, args = []) {
  return spawnSync(process.execPath, [join(root, 'scripts/measure-platform-artifacts.mjs'), '--output', join(root, 'report.json'), ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
}

describe('platform measurement admission policy', () => {
  it('сохраняет прежние запреты, equality и оба потолка при factual update', () => {
    const { root, policy } = fixture();
    const result = run(root, ['--update']);
    expect(result.status, result.stderr).toBe(0);
    const next = JSON.parse(readFileSync(join(root, 'release/package-size-ratchet.json')));
    expect(next.artifacts[file].forbiddenNeedles).toEqual(policy.artifacts[file].forbiddenNeedles);
    expect(next.artifacts[file].identicalTo).toBe(twin);
    expect(next.artifacts[file].maxBytes).toBe(policy.artifacts[file].maxBytes);
    expect(next.artifacts[file].maxGzipBytes).toBe(policy.artifacts[file].maxGzipBytes);
    const consumers = JSON.parse(readFileSync(join(root, 'release/consumer-size-ratchet.json'))).scenarios;
    expect(consumers['one-static'].maxBytes).toBe(100);
    expect(consumers['full-ir-opt-in'].maxGzipBytes).toBe(101);
    expect(consumers['status-circle-state'].maxBytes).toBe(10);
  });

  it.each([
    ['forbidden marker', { source: original + '<svg' }, /forbidden|запрещён/],
    ['module inclusion', { source: original.replace('kernel.js', 'private.js') }, /module inclusion|модул/],
    ['equality', { other: original.replace('value = 1', 'value = 2') }, /identicalTo|byte-identical/],
    ['ceiling', { ceiling: 1 }, /budget|потол|ratchet/],
  ])('не принимает %s за новый baseline и оставляет policy прежней', (_name, options, expected) => {
    const { root } = fixture(options);
    const before = readFileSync(join(root, 'release/package-size-ratchet.json'));
    const result = run(root, ['--update']);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toMatch(expected);
    expect(readFileSync(join(root, 'release/package-size-ratchet.json')).equals(before)).toBe(true);
  });

  it('report сохраняет candidate policy и точные нарушения без мутации', () => {
    const { root, policy } = fixture({ source: original.replace('kernel.js', 'private.js') });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(readFileSync(join(root, 'report.json')));
    expect(report.sourceSha).toBe(hash);
    expect(report.policyViolations.join('\n')).toMatch(/kernel\.js.*private\.js/);
    expect(report.candidatePolicies.package.artifacts[file].allowedModules).toEqual(policy.artifacts[file].allowedModules);
    expect(report.candidatePolicies.consumer.scenarios['status-circle-state'].entry).toMatch(/renderStateSvg.*compileStateEffect/s);
    expect(report.consumers['status-circle-state'].bytes).toBe(10);
  });

  it('не удаляет ранее установленный consumer budget при добавлении сценариев', () => {
    const { root } = fixture();
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const consumers = JSON.parse(readFileSync(policyPath));
    consumers.scenarios['previous-extra'] = consumers.scenarios['one-static'];
    writeFileSync(policyPath, JSON.stringify(consumers));
    const before = readFileSync(policyPath);
    const result = run(root, ['--update']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/previous-extra.*previous consumer scenario/);
    expect(readFileSync(policyPath).equals(before)).toBe(true);
  });
  it.each([20, 5])('собственный full-ir потолок %s имеет приоритет после первой миграции', ceiling => {
    const { root } = fixture();
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const policy = JSON.parse(readFileSync(policyPath));
    policy.scenarios['full-ir-opt-in'] = {
      ...policy.scenarios['glyph-one'], maxBytes: ceiling, maxGzipBytes: ceiling + 1,
    };
    writeFileSync(policyPath, JSON.stringify(policy));
    const before = readFileSync(policyPath);
    const result = run(root, ['--update']);
    if (ceiling < 10) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/full-ir-opt-in.*consumer budget/);
      expect(readFileSync(policyPath).equals(before)).toBe(true);
    } else {
      expect(result.status, result.stderr).toBe(0);
      const next = JSON.parse(readFileSync(policyPath)).scenarios['full-ir-opt-in'];
      expect(next.maxBytes).toBe(ceiling);
      expect(next.maxGzipBytes).toBe(ceiling + 1);
    }
  });
});
