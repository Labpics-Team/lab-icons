import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
// Одно условие: bash 3.2 на macOS не прерывает скрипт по set -e на упавшем [[ ]] в середине.
const gateCommand = `set -euo pipefail
[[ "$MATRIX_RESULT" == 'success' && "$SECURITY_RESULT" == 'success' ]]`;
// Шаг сканирования одинаков во всех репозиториях; меняются только runner, имя job и место в итоге.
const securityCommand = [
  'set -euo pipefail',
  '# trivy читает переменные TRIVY_* как флаги: охват проверки задаёт только этот шаг.',
  'unset "${!TRIVY_@}"',
  'version=0.74.0',
  'sum=2ae6fe3ee734b7fdf11335663e18c75ea12dccc76062f09f164a3b0f8be4371a',
  'dir="$RUNNER_TEMP/trivy"',
  'mkdir -p "$dir"',
  'curl -fsSL --retry 3 --retry-all-errors -o "$dir/trivy.tgz" \\',
  '  "https://github.com/aquasecurity/trivy/releases/download/v$version/trivy_${version}_Linux-64bit.tar.gz"',
  'echo "$sum  $dir/trivy.tgz" | sha256sum -c -',
  'tar -xzf "$dir/trivy.tgz" -C "$dir" trivy',
  'accepted=(--ignorefile /dev/null)',
  '[ -f .trivyignore.yaml ] && accepted=(--ignorefile .trivyignore.yaml)',
  '# Настройки сканера задаёт шаг: trivy.yaml из проверяемого дерева их не меняет.',
  'scan() { "$dir/trivy" fs --config /dev/null --cache-dir "$dir/cache" --exit-code 1 --no-progress "$@" .; }',
  'scan --scanners vuln,misconfig --severity UNKNOWN,HIGH,CRITICAL --include-dev-deps "${accepted[@]}"',
  '# Исправление вышло — принятая раньше уязвимость снова блокирует.',
  'scan --scanners vuln --severity UNKNOWN,HIGH,CRITICAL --include-dev-deps --ignore-unfixed --ignorefile /dev/null',
  '# Секрет в тестах, примерах и документации — такая же утечка: встроенные исключения trivy для них сняты,',
  '# а записи .trivyignore.yaml к секретам не применяются.',
  "printf 'disable-allow-rules:\\n  - tests\\n  - examples\\n  - markdown\\n' > \"$dir/secret.yaml\"",
  'scan --scanners secret --secret-config "$dir/secret.yaml" --ignorefile /dev/null',
  '',
].join('\n');
// Модель trivy с флагами шага. Находка из FINDINGS — «сканер:id:состояние:файл», состояние уязвимости —
// fixed или unfixed, у остальных «-». Находка роняет проход с --exit-code, если её сканер включён,
// --ignore-unfixed её не отсеял и в --ignorefile нет записи её раздела с её id, у которой нет paths
// или среди paths есть её файл. Секрет в тестах, примерах и документации скрывают встроенные исключения
// trivy (tests, examples, markdown), пока настройка секретов их не снимет. Как и trivy, без --config
// модель читает trivy.yaml из дерева, и его skip-files скрывают находку, а TRIVY_SKIP_FILES из окружения
// скрывает находку и с ним; без --secret-config модель читает trivy-secret.yaml из дерева, и его
// allow-rules скрывают секрет.
// На проходе с номером CRASH_CALL сканер падает сам, как при сбое сети или базы.
const fakeTrivy = `#!/usr/bin/env bash
scanners= ignorefile= unfixed=0 code=0 config=trivy.yaml secrets=trivy-secret.yaml
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config=$2; shift 2 ;;
    --scanners) scanners=$2; shift 2 ;;
    --ignorefile) ignorefile=$2; shift 2 ;;
    --secret-config) secrets=$2; shift 2 ;;
    --exit-code) code=$2; shift 2 ;;
    --ignore-unfixed) unfixed=1; shift ;;
    *) shift ;;
  esac
done
printf '%s %s %s\\n' "$scanners" "$ignorefile" "$unfixed" >> "$SCAN_CALLS"
(( $(wc -l < "$SCAN_CALLS") == \${CRASH_CALL:-0} )) && exit 2
# Записи о принятии — строки «раздел id файл»; файл «*» у записи без paths.
records=$(awk -v any='*' '
  function flush() { if (id) { if (!n) print section, id, any; for (i = 1; i <= n; i++) print section, id, paths[i] } id = 0; n = 0 }
  /^[a-z]+:$/ { flush(); section = substr($0, 1, length($0) - 1); next }
  /^  - id: / { flush(); id = $3; key = 0; next }
  /^    paths:/ { key = 1; next }
  /^    [a-z]+:/ { key = 0; next }
  /^      - / { if (key) paths[++n] = $2; next }
  END { flush() }
' "$ignorefile")
tests='(^test|/test|-test|_test|\\.test)'
for finding in $FINDINGS; do
  IFS=: read -r scanner id state path <<< "$finding"
  [[ ",$scanners," == *",$scanner,"* ]] || continue
  [[ $unfixed == 1 && $state == unfixed ]] && continue
  grep -qxF -- "    - $path" "$config" 2>/dev/null && continue
  [[ ",$TRIVY_SKIP_FILES," == *",$path,"* ]] && continue
  case $scanner in vuln) section=vulnerabilities ;; misconfig) section=misconfigurations ;; *) section=secrets ;; esac
  if [[ $section == secrets ]]; then
    grep -q '^allow-rules:' "$secrets" 2>/dev/null && continue
    hidden=
    [[ $path =~ $tests ]] && ! grep -qxF -- '  - tests' "$secrets" 2>/dev/null && hidden=1
    [[ $path == *example* ]] && ! grep -qxF -- '  - examples' "$secrets" 2>/dev/null && hidden=1
    [[ $path == *.md ]] && ! grep -qxF -- '  - markdown' "$secrets" 2>/dev/null && hidden=1
    [[ -n $hidden ]] && continue
  fi
  grep -qxF -e "$section $id *" -e "$section $id $path" <<< "$records" && continue
  exit "$code"
done
exit 0
`;
// .trivyignore.yaml в формате trivy: раздел, записи с id, необязательными paths и statement.
function trivyignore(accepted) {
  return Object.entries(accepted).flatMap(([section, records]) => [
    `${section}:`,
    ...records.flatMap(([id, ...paths]) => [
      `  - id: ${id}`,
      ...(paths.length ? ['    paths:', ...paths.map((path) => `      - ${path}`)] : []),
      '    statement: синтетический образец теста',
    ]),
  ]).map((line) => `${line}\n`).join('');
}
const stubs = {
  curl: '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done\nprintf archive > "$out"\n',
  tar: `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = -C ] && dir=$2; shift; done\ncat > "$dir/trivy" <<'EOF'\n${fakeTrivy}EOF\nchmod +x "$dir/trivy"\n`,
  sha256sum: '#!/usr/bin/env bash\ncat > /dev/null\n',
};

function runSecurityStep({ findings = [], accepted, candidate = {}, env = {}, crash = 0, realChecksum = false }) {
  const step = parse(sources().get('ci.yml')).jobs.security.steps
    .find((entry) => entry.name === 'Scan dependencies, configuration and secrets');
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-security-'));
  try {
    const [bin, tree, temp] = ['bin', 'tree', 'temp'].map((name) => join(root, name));
    for (const path of [bin, tree, temp]) mkdirSync(path);
    for (const [name, body] of Object.entries(stubs)) {
      if (name !== 'sha256sum' || !realChecksum) writeFileSync(join(bin, name), body, { mode: 0o755 });
    }
    if (accepted) writeFileSync(join(tree, '.trivyignore.yaml'), trivyignore(accepted));
    for (const [name, body] of Object.entries(candidate)) writeFileSync(join(tree, name), body);
    const calls = join(root, 'calls');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-c', step.run], {
      cwd: tree,
      env: {
        ...process.env,
        ...env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: temp,
        FINDINGS: findings.join(' '),
        CRASH_CALL: String(crash),
        SCAN_CALLS: calls,
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.error).toBeUndefined();
    return { passed: result.status === 0, calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const biteSpecs = [
  {
    name: 'Parity guard bites on extra icon',
    command: 'pnpm check:parity',
    mutation: 'cp svg/Filled/accessibility_filled.svg svg/Filled/_EXTRA_TEST_filled.svg',
    capture: 'parity_output="$(pnpm check:parity 2>&1)"',
    status: 'parity_status',
    witness: 'grep -F -- \'_EXTRA_TEST\' <<<"$parity_output"',
  },
  {
    name: 'Colour guard bites on hardcoded hex',
    command: 'pnpm check:colors',
    mutation: '> dist/svg/Filled/_colour_test.svg',
    capture: 'colour_output="$(pnpm check:colors 2>&1)"',
    status: 'colour_status',
    witness: 'grep -F -- \'_colour_test.svg\' <<<"$colour_output"',
  },
];

function assertBiteStep(step, spec) {
  expect(step).toBeDefined();
  expect(step.if).toBe("matrix.os == 'ubuntu-latest' && matrix.node == '24'");
  expect(step.shell).toBe('bash');
  expect(step['continue-on-error']).toBeUndefined();
  expect(step.run.startsWith(`${spec.command}\n`)).toBe(true);
  expect(step.run.split(spec.command)).toHaveLength(3);
  const clean = step.run.indexOf(spec.command);
  const mutation = step.run.indexOf(spec.mutation);
  const capture = step.run.indexOf(spec.capture);
  const statusCheck = step.run.indexOf(`if [[ "$${spec.status}" -eq 0 ]]; then`);
  const witness = step.run.indexOf(spec.witness);
  expect(clean).toBeGreaterThanOrEqual(0);
  expect(mutation).toBeGreaterThan(clean);
  expect(capture).toBeGreaterThan(mutation);
  expect(statusCheck).toBeGreaterThan(capture);
  expect(witness).toBeGreaterThan(statusCheck);
}

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
  expect(Object.keys(workflow.jobs).sort()).toEqual(['required', 'security', 'verify']);
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
  for (const spec of biteSpecs) {
    assertBiteStep(verify.steps.find((step) => step.name === spec.name), spec);
  }
  // Свежий checkout без установки зависимостей и без сохранённого токена.
  expect(workflow.jobs.security).toEqual({
    name: 'Security',
    'runs-on': 'ubuntu-latest',
    'timeout-minutes': 15,
    steps: [
      {
        name: 'Checkout',
        uses: verify.steps.find((step) => step.name === 'Checkout').uses,
        with: { 'persist-credentials': false },
      },
      { name: 'Scan dependencies, configuration and secrets', run: securityCommand },
    ],
  });
  const gate = workflow.jobs.required;
  expect(gate.name).toBe('CI');
  expect(gate.needs).toEqual(['verify', 'security']);
  expect(gate.if).toBe('${{ always() }}');
  expect(gate['runs-on']).toBe('ubuntu-latest');
  expect(gate.permissions).toEqual({});
  expect(gate['continue-on-error']).toBeUndefined();
  expect(gate.defaults).toBeUndefined();
  expect(gate.steps).toHaveLength(1);
  expect(gate.steps[0]).toEqual({
    name: 'Require the entire verification matrix and the security scan',
    env: {
      MATRIX_RESULT: '${{ needs.verify.result }}',
      SECURITY_RESULT: '${{ needs.security.result }}',
    },
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
    ['parity bite без clean baseline', (w) => {
      const step = w.jobs.verify.steps.find((s) => s.name === biteSpecs[0].name);
      step.run = step.run.replace(`${biteSpecs[0].command}\n`, '');
    }],
    ['parity bite без diagnostic witness', (w) => {
      const step = w.jobs.verify.steps.find((s) => s.name === biteSpecs[0].name);
      step.run = step.run.replace(`${biteSpecs[0].witness}\n`, '');
    }],
    ['colour bite без clean baseline', (w) => {
      const step = w.jobs.verify.steps.find((s) => s.name === biteSpecs[1].name);
      step.run = step.run.replace(`${biteSpecs[1].command}\n`, '');
    }],
    ['colour bite без diagnostic witness', (w) => {
      const step = w.jobs.verify.steps.find((s) => s.name === biteSpecs[1].name);
      step.run = step.run.replace(`${biteSpecs[1].witness}\n`, '');
    }],
    ['фальшивый результат', (w) => { w.jobs.required.steps[0].env.MATRIX_RESULT = 'success'; }],
    ['security вне итога', (w) => { w.jobs.required.needs = 'verify'; }],
    ['фальшивый результат security', (w) => { w.jobs.required.steps[0].env.SECURITY_RESULT = 'success'; }],
    ['пропуск security job', (w) => { w.jobs.security.if = false; }],
    ['игнорирование security job', (w) => { w.jobs.security['continue-on-error'] = true; }],
    ['security сохраняет токен', (w) => { w.jobs.security.steps[0].with['persist-credentials'] = true; }],
    ['security ставит зависимости', (w) => {
      w.jobs.security.steps.splice(1, 0, { run: 'pnpm install --frozen-lockfile' });
    }],
    ['security без прохода по исправленным', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace(/^scan --scanners vuln --.*--ignore-unfixed.*\n/m, '');
    }],
    ['security без порога выхода', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace(' --exit-code 1', '');
    }],
    ['security без сканера уязвимостей', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace('--scanners vuln,misconfig', '--scanners misconfig');
    }],
    ['security без настройки секретов', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace(' --secret-config "$dir/secret.yaml"', '');
    }],
    ['security принимает секреты по записям', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace('"$dir/secret.yaml" --ignorefile /dev/null', '"$dir/secret.yaml" "${accepted[@]}"');
    }],
    ['security без своих настроек сканера', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace(' --config /dev/null', '');
    }],
    ['security оставляет переменные TRIVY_*', (w) => {
      const step = w.jobs.security.steps[1];
      step.run = step.run.replace('unset "${!TRIVY_@}"\n', '');
    }],
    ['пустой успех', (w) => { w.jobs.required.steps[0].run = 'true\n'; }],
    ['пропуск shell итога', (w) => { w.jobs.required.steps[0].if = false; }],
    ['игнорирование shell итога', (w) => { w.jobs.required.steps[0]['continue-on-error'] = true; }],
    ['лишние права итога', (w) => { w.jobs.required.permissions = { actions: 'read' }; }],
  ])('отвергает изменение: %s', (_, mutate) => {
    const files = sources();
    assertNativeGraph(files);
    const workflow = parse(files.get('ci.yml'));
    mutate(workflow);
    // Мутация, которая ничего не поменяла, ничего и не доказывает.
    expect(workflow).not.toEqual(parse(files.get('ci.yml')));
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
    expect(gate.env).toEqual({
      MATRIX_RESULT: '${{ needs.verify.result }}',
      SECURITY_RESULT: '${{ needs.security.result }}',
    });
    expect(gate.shell).toBe('bash');
    const bash = process.platform === 'win32'
      ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/bin/bash.exe') : 'bash';
    for (const key of ['MATRIX_RESULT', 'SECURITY_RESULT']) {
      for (const result of ['success', 'failure', 'cancelled', 'skipped', 'neutral', 'pending', '', undefined]) {
        const env = { ...process.env, MATRIX_RESULT: 'success', SECURITY_RESULT: 'success' };
        delete env[key];
        if (result !== undefined) env[key] = result;
        const actual = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', gate.run], {
          env, encoding: 'utf8', timeout: 60_000,
        });
        expect(actual.error).toBeUndefined();
        expect(actual.status === 0, `${key}=${JSON.stringify(result)}: ${actual.stderr}`).toBe(result === 'success');
      }
    }
  });
});

// Шаг security исполняется только на Linux runner, поэтому и его поведение проверяется на Linux.
describe.runIf(process.platform === 'linux')('шаг security исполняет политику принятия', () => {
  it('исправленные уязвимости и секреты проверяются без записей о принятии', () => {
    expect(runSecurityStep({}).calls).toEqual([
      'vuln,misconfig /dev/null 0',
      'vuln /dev/null 1',
      'secret /dev/null 0',
    ]);
    expect(runSecurityStep({ accepted: {} }).calls).toEqual([
      'vuln,misconfig .trivyignore.yaml 0',
      'vuln /dev/null 1',
      'secret /dev/null 0',
    ]);
  });

  const fixed = 'vuln:CVE-1:fixed:pnpm-lock.yaml';
  const unfixed = 'vuln:CVE-2:unfixed:pnpm-lock.yaml';
  const misconfig = 'misconfig:KSV-1:-:Dockerfile';
  const sample = 'secret:aws-access-key-id:-:test/fixture.txt';
  const leak = 'secret:aws-access-key-id:-:src/settings.js';
  it.each([
    ['чистое дерево проходит', [], undefined, true],
    ['уязвимость с исправлением блокирует', [fixed], undefined, false],
    ['уязвимость с исправлением блокирует и после записи о принятии', [fixed], { vulnerabilities: [['CVE-1']] }, false],
    ['уязвимость без исправления блокирует', [unfixed], undefined, false],
    ['уязвимость без исправления проходит по записи', [unfixed], { vulnerabilities: [['CVE-2']] }, true],
    ['ошибка конфигурации блокирует', [misconfig], undefined, false],
    ['ошибка конфигурации проходит по записи', [misconfig], { misconfigurations: [['KSV-1']] }, true],
    ['секрет блокирует', [leak], undefined, false],
    ['секрет в тестах блокирует', [sample], undefined, false],
    ['секрет в примерах блокирует', ['secret:aws-access-key-id:-:examples/demo.js'], undefined, false],
    ['секрет в документации блокирует', ['secret:aws-access-key-id:-:docs/guide.md'], undefined, false],
    ['запись secrets не принимает секрет даже в его файле', [sample], { secrets: [['aws-access-key-id', 'test/fixture.txt']] }, false],
    ['запись secrets без paths не принимает секрет', [leak], { secrets: [['aws-access-key-id']] }, false],
    ['запись другого раздела находку не принимает', [misconfig], { vulnerabilities: [['KSV-1']] }, false],
  ])('%s', (_, findings, accepted, passed) => {
    expect(runSecurityStep({ findings, accepted }).passed).toBe(passed);
  });

  it('настройка секретов из дерева кандидата не скрывает секрет', () => {
    const candidate = { 'trivy-secret.yaml': 'allow-rules:\n  - id: everything\n    path: .*\n' };
    expect(runSecurityStep({ findings: [leak], candidate }).passed).toBe(false);
  });

  it('настройки сканера из дерева кандидата не скрывают находки', () => {
    const candidate = { 'trivy.yaml': 'scan:\n  skip-files:\n    - pnpm-lock.yaml\n    - src/settings.js\n' };
    expect(runSecurityStep({ findings: [fixed], candidate }).passed).toBe(false);
    expect(runSecurityStep({ findings: [leak], candidate }).passed).toBe(false);
  });

  it('переменные TRIVY_* окружения не скрывают находки', () => {
    const env = { TRIVY_SKIP_FILES: 'pnpm-lock.yaml,src/settings.js' };
    expect(runSecurityStep({ findings: [fixed], env }).passed).toBe(false);
    expect(runSecurityStep({ findings: [leak], env }).passed).toBe(false);
  });

  it.each([1, 2, 3])('сбой сканера на проходе %i роняет шаг и останавливает его', (crash) => {
    const result = runSecurityStep({ crash });
    expect(result.passed).toBe(false);
    expect(result.calls).toHaveLength(crash);
  });

  it('архив, не совпавший с закреплённой суммой, не запускается', () => {
    expect(runSecurityStep({ realChecksum: true })).toEqual({ passed: false, calls: [] });
  });
});
