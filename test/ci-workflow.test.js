import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

const directory = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const sources = () => new Map(readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => [name, readFileSync(join(directory, name), 'utf8')]));
const events = (value) => typeof value === 'string' ? [value]
  : Array.isArray(value) ? value : Object.keys(value);
const candidateEvents = new Set(['pull_request', 'pull_request_target', 'merge_group']);
const matrix = [
  { os: 'ubuntu-latest', node: '22.14.0' },
  { os: 'ubuntu-latest', node: '24' },
  { os: 'ubuntu-latest', node: '26' },
  { os: 'windows-latest', node: '24' },
  { os: 'macos-latest', node: '24' },
];
const gateCommand = `set -euo pipefail
[[ "$MATRIX_RESULT" == 'success' ]]`;

function assertNativeGraph(files) {
  const workflows = new Map([...files].map(([name, source]) => [name, parse(source)]));
  const candidates = [...workflows]
    .filter(([, workflow]) => events(workflow.on).some((event) => candidateEvents.has(event)))
    .map(([name]) => name).sort();
  expect(candidates).toEqual(['ci.yml']);
  expect(files.has('ci-gate.yml')).toBe(false);
  const workflow = workflows.get('ci.yml');
  expect(workflow.on).toEqual({ push: { branches: ['main'] }, pull_request: null, merge_group: null });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.defaults).toBeUndefined();
  expect(Object.keys(workflow.jobs).sort()).toEqual(['required', 'verify']);
  const verify = workflow.jobs.verify;
  expect(verify['runs-on']).toBe('${{ matrix.os }}');
  expect(verify.if).toBeUndefined();
  expect(verify['continue-on-error']).toBeUndefined();
  expect(verify.permissions).toBeUndefined();
  expect(verify.defaults).toBeUndefined();
  expect(verify.strategy).toEqual({ 'fail-fast': false, matrix: { include: matrix } });
  for (const command of ['pnpm install --frozen-lockfile', 'pnpm verify']) {
    const steps = verify.steps.filter((step) => step.run === command);
    expect(steps).toHaveLength(1);
    expect(steps[0].if).toBeUndefined();
    expect(steps[0]['continue-on-error']).toBeUndefined();
    expect(steps[0].shell).toBeUndefined();
    expect(steps[0]['working-directory']).toBeUndefined();
  }
  const gate = workflow.jobs.required;
  expect(gate.name).toBe('CI');
  expect(gate.needs).toBe('verify');
  expect(gate.if).toBe('${{ always() }}');
  expect(gate['runs-on']).toBe('ubuntu-latest');
  expect(gate.permissions).toEqual({});
  expect(gate['continue-on-error']).toBeUndefined();
  expect(gate.defaults).toBeUndefined();
  expect(gate.steps).toHaveLength(1);
  expect(gate.steps[0]).toEqual({
    name: 'Require the entire verification matrix',
    env: { MATRIX_RESULT: '${{ needs.verify.result }}' },
    shell: 'bash',
    run: `${gateCommand}\n`,
  });
}

describe('нативный итог CI', () => {
  it('покрывает каждую платформу единственным required check', () => {
    assertNativeGraph(sources());
  });

  it.each([
    ...matrix.map(({ os, node }) => [`удалена платформа ${os}/${node}`, (w) => {
      w.jobs.verify.strategy.matrix.include = w.jobs.verify.strategy.matrix.include
        .filter((entry) => entry.os !== os || entry.node !== node);
    }]),
    ['PR path filter', (w) => { w.on.pull_request = { paths: ['src/**'] }; }],
    ['PR branch filter', (w) => { w.on.pull_request = { branches: ['main'] }; }],
    ['merge_group filter', (w) => { w.on.merge_group = { types: ['other'] }; }],
    ['push master', (w) => { w.on.push.branches = ['master']; }],
    ['нет needs', (w) => { delete w.jobs.required.needs; }],
    ['пропуск после отказа', (w) => { w.jobs.required.if = '${{ success() }}'; }],
    ['не required имя', (w) => { w.jobs.required.name = 'Required CI'; }],
    ['неизвестная job вне итога', (w) => { w.jobs.extra = { 'runs-on': 'ubuntu-latest' }; }],
    ['пропуск verify job', (w) => { w.jobs.verify.if = false; }],
    ['игнорирование verify job', (w) => { w.jobs.verify['continue-on-error'] = true; }],
    ['игнорирование итога', (w) => { w.jobs.required['continue-on-error'] = true; }],
    ['пропуск pnpm verify', (w) => { w.jobs.verify.steps.find((s) => s.run === 'pnpm verify').if = false; }],
    ['игнорирование pnpm verify', (w) => {
      w.jobs.verify.steps.find((s) => s.run === 'pnpm verify')['continue-on-error'] = true;
    }],
    ['смена shell verify', (w) => { w.jobs.verify.steps.find((s) => s.run === 'pnpm verify').shell = 'bash {0}'; }],
    ['смена default shell', (w) => { w.defaults = { run: { shell: 'bash {0}' } }; }],
    ['фальшивый результат', (w) => { w.jobs.required.steps[0].env.MATRIX_RESULT = 'success'; }],
    ['пустой успех', (w) => { w.jobs.required.steps[0].run = 'true\n'; }],
    ['пропуск shell итога', (w) => { w.jobs.required.steps[0].if = false; }],
    ['игнорирование shell итога', (w) => { w.jobs.required.steps[0]['continue-on-error'] = true; }],
    ['лишние права итога', (w) => { w.jobs.required.permissions = { actions: 'read' }; }],
  ])('отвергает изменение: %s', (_, mutate) => {
    const files = sources();
    assertNativeGraph(files);
    const workflow = parse(files.get('ci.yml'));
    mutate(workflow);
    files.set('ci.yml', stringify(workflow));
    expect(() => assertNativeGraph(files)).toThrow();
  });

  it.each([{ trigger: 'pull_request' }, { trigger: ['merge_group'] }, { trigger: { pull_request_target: null } }])(
    'новый кандидатский workflow требует явного включения в граф: %j', ({ trigger }) => {
      const files = sources();
      assertNativeGraph(files);
      files.set('new-check.yaml', stringify({ on: trigger, jobs: {} }));
      expect(() => assertNativeGraph(files)).toThrow();
    },
  );

  it('исполняет shell итога и принимает только реальный success', () => {
    const workflow = parse(sources().get('ci.yml'));
    const gate = workflow.jobs.required.steps[0];
    expect(gate.env).toEqual({ MATRIX_RESULT: '${{ needs.verify.result }}' });
    expect(gate.shell).toBe('bash');
    const bash = process.platform === 'win32'
      ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/bin/bash.exe') : 'bash';
    for (const result of ['success', 'failure', 'cancelled', 'skipped', 'neutral', 'pending', '', undefined]) {
      const env = { ...process.env };
      delete env.MATRIX_RESULT;
      if (result !== undefined) env.MATRIX_RESULT = result;
      const actual = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', gate.run], {
        env, encoding: 'utf8', timeout: 5000,
      });
      expect(actual.error).toBeUndefined();
      expect(actual.status === 0, `результат ${JSON.stringify(result)}: ${actual.stderr}`).toBe(result === 'success');
    }
  });
});
