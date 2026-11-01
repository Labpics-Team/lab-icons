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
const legacyGlyphEntry = "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'alert' }));\n";
const symbolGlyphEntry = "import { glyph } from '@labpics/icons/symbols/alert';\nconsole.log(glyph());\n";
const authoredTimeEntry = "import { glyph } from '@labpics/icons/symbols/time';\nconsole.log(glyph());\n";

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
  scenarios['glyph-one'].entry = legacyGlyphEntry;
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

function measureConsumer(root, entry, bytes, gzipBytes) {
  const oracle = join(root, 'scripts/check-consumer-size.js');
  const source = readFileSync(oracle, 'utf8');
  const signature = 'export async function bundleScenario()';
  const result = "return { bytes: 10, gzipBytes: 11, modules: ['dist/fixture.js'] };";
  expect(source).toContain(signature);
  expect(source).toContain(result);
  writeFileSync(oracle, source.replace(
    signature,
    'export async function bundleScenario(entry)',
  ).replace(
    result,
    `return { bytes: entry === ${JSON.stringify(entry)} ? ${bytes} : 10, gzipBytes: entry === ${JSON.stringify(entry)} ? ${gzipBytes} : 11, modules: ['dist/fixture.js'] };`,
  ));
}

function swapConsumerNames(root) {
  const program = join(root, 'scripts/measure-platform-artifacts.mjs');
  const source = readFileSync(program, 'utf8');
  const glyphEntry = `'glyph-one': ${JSON.stringify(symbolGlyphEntry)}`;
  const timeEntry = `'authored-time': ${JSON.stringify(authoredTimeEntry)}`;
  expect(source).toContain(glyphEntry);
  expect(source).toContain(timeEntry);
  writeFileSync(program, source.replace(glyphEntry, `'glyph-one': ${JSON.stringify(authoredTimeEntry)}`)
    .replace(timeEntry, `'authored-time': ${JSON.stringify(symbolGlyphEntry)}`));
}

describe('platform measurement admission policy', () => {
  it.each([
    ['signature', 'export async function bundleScenario()', 'export async function bundleScenario(input)'],
    ['return', "return { bytes: 10, gzipBytes: 11, modules: ['dist/fixture.js'] };", "return { bytes: 10.0, gzipBytes: 11, modules: ['dist/fixture.js'] };"],
  ])('отказывает подмене consumer при дрейфе %s и сохраняет fixture', (_, before, after) => {
    const { root } = fixture();
    const oracle = join(root, 'scripts/check-consumer-size.js');
    const changed = readFileSync(oracle, 'utf8').replace(before, after);
    writeFileSync(oracle, changed);
    expect(() => measureConsumer(root, symbolGlyphEntry, 10, 11)).toThrow();
    expect(readFileSync(oracle, 'utf8')).toBe(changed);
  });

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

  it('новый symbol import получает свой потолок, а прежний IR сохраняет entry и budget', () => {
    const { root } = fixture();
    const result = run(root, ['--update']);
    expect(result.status, result.stderr).toBe(0);
    const scenarios = JSON.parse(readFileSync(join(root, 'release/consumer-size-ratchet.json'))).scenarios;
    expect(scenarios['glyph-one'].entry).toMatch(/@labpics\/icons\/symbols\/alert/);
    expect(scenarios['glyph-one'].maxBytes).toBe(10);
    expect(scenarios['glyph-one'].maxGzipBytes).toBe(11);
    expect(scenarios['full-ir-opt-in'].entry).toBe(legacyGlyphEntry);
    expect(scenarios['full-ir-opt-in'].maxBytes).toBe(100);
    expect(scenarios['full-ir-opt-in'].maxGzipBytes).toBe(101);
  });

  it('не ратифицирует возврат symbol import к цене полного каталога', () => {
    const { root } = fixture();
    const initial = run(root, ['--update']);
    expect(initial.status, initial.stderr).toBe(0);
    const consumerOracle = join(root, 'scripts/check-consumer-size.js');
    writeFileSync(consumerOracle, readFileSync(consumerOracle, 'utf8').replace(
      'export async function bundleScenario()',
      'export async function bundleScenario(entry)',
    ).replace(
      "return { bytes: 10, gzipBytes: 11, modules: ['dist/fixture.js'] };",
      "return { bytes: entry.includes('/symbols/alert') ? 50 : 10, gzipBytes: entry.includes('/symbols/alert') ? 51 : 11, modules: ['dist/fixture.js'] };",
    ));
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const before = readFileSync(policyPath);
    const result = run(root, ['--update']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/glyph-one.*consumer budget/);
    expect(readFileSync(policyPath).equals(before)).toBe(true);
  });

  it.each(['glyph-one', 'full-ir-opt-in'])('не удаляет прежний entry при сохранённом имени %s', name => {
    const { root } = fixture();
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const policy = JSON.parse(readFileSync(policyPath));
    policy.scenarios[name] = {
      ...policy.scenarios['glyph-one'],
      entry: "import { glyph } from '@labpics/icons/symbols/reload';\nconsole.log(glyph());\n",
    };
    writeFileSync(policyPath, JSON.stringify(policy));
    const before = readFileSync(policyPath);
    const result = run(root, ['--update']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(new RegExp(`${name}.*previous consumer entry`));
    expect(readFileSync(policyPath).equals(before)).toBe(true);
  });

  it('перестановка имён сохраняет потолки соответствующих exact entries', () => {
    const { root } = fixture();
    const initial = run(root, ['--update']);
    expect(initial.status, initial.stderr).toBe(0);
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const policy = JSON.parse(readFileSync(policyPath));
    policy.scenarios['authored-time'].maxBytes = 20;
    policy.scenarios['authored-time'].maxGzipBytes = 21;
    writeFileSync(policyPath, JSON.stringify(policy));
    swapConsumerNames(root);
    const result = run(root, ['--update']);
    expect(result.status, result.stderr).toBe(0);
    const next = JSON.parse(readFileSync(policyPath)).scenarios;
    expect(next['authored-time'].entry).toBe(symbolGlyphEntry);
    expect(next['authored-time'].maxBytes).toBe(10);
    expect(next['authored-time'].maxGzipBytes).toBe(11);
    expect(next['glyph-one'].entry).toBe(authoredTimeEntry);
    expect(next['glyph-one'].maxBytes).toBe(20);
    expect(next['glyph-one'].maxGzipBytes).toBe(21);
  });

  it('переклассификация сохранённого entry не ратифицирует его рост', () => {
    const { root } = fixture();
    const initial = run(root, ['--update']);
    expect(initial.status, initial.stderr).toBe(0);
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const before = readFileSync(policyPath);
    swapConsumerNames(root);
    measureConsumer(root, symbolGlyphEntry, 50, 51);
    const result = run(root, ['--update']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/authored-time.*consumer budget/);
    expect(readFileSync(policyPath).equals(before)).toBe(true);
  });

  it.each([
    [10, 11, true],
    [21, 11, false],
    [10, 22, false],
  ])('дубликаты entry сохраняют независимые минимумы raw/gzip: %s/%s', (bytes, gzipBytes, accepted) => {
    const { root } = fixture();
    const policyPath = join(root, 'release/consumer-size-ratchet.json');
    const policy = JSON.parse(readFileSync(policyPath));
    policy.scenarios['full-ir-opt-in'] = policy.scenarios['glyph-one'];
    policy.scenarios['glyph-one'] = {
      entry: symbolGlyphEntry, baselineBytes: 10, baselineGzipBytes: 11, maxBytes: 20, maxGzipBytes: 80,
    };
    policy.scenarios['authored-time'] = {
      entry: symbolGlyphEntry, baselineBytes: 10, baselineGzipBytes: 11, maxBytes: 80, maxGzipBytes: 21,
    };
    writeFileSync(policyPath, JSON.stringify(policy));
    const before = readFileSync(policyPath);
    measureConsumer(root, symbolGlyphEntry, bytes, gzipBytes);
    const result = run(root, ['--update']);
    if (accepted) {
      expect(result.status, result.stderr).toBe(0);
      const next = JSON.parse(readFileSync(policyPath)).scenarios['glyph-one'];
      expect(next.maxBytes).toBe(20);
      expect(next.maxGzipBytes).toBe(21);
    } else {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/glyph-one.*consumer budget/);
      expect(readFileSync(policyPath).equals(before)).toBe(true);
    }
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
