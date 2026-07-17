#!/usr/bin/env node
/**
 * Гейт воспроизводимости репозитория.
 *
 * Почему он существует: локальная verify-цепь, CI и release workflow уже
 * расходились. Такой дрейф опаснее красного CI — часть обязательных проверок
 * могла вообще не запускаться. Гейт держит один package manager, один lockfile
 * и один вход в полный набор проверок: `pnpm verify`.
 *
 * Workflow проверяется ПО JOB, а не как плоский текст: второй runner не должен
 * получать зелёный статус за счёт install/verify, которые находятся в соседнем
 * job и на его платформе никогда не выполнялись.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  validatePackageProjection,
  validateReleaseContract,
} from './lib/release-contract.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXACT_PNPM = /^pnpm@(\d+\.\d+\.\d+)$/;
const PINNED_ACTION_REF = /^[0-9a-f]{40}$/;
const FORBIDDEN_LOCKFILES = [
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
];
const CANONICAL_BUILD_SCRIPTS = Object.freeze({
  build: 'pnpm build:static && pnpm build:catalog && pnpm build:runtime',
  'build:static': 'node scripts/build.js && node scripts/build-anatomy.js',
  'build:catalog': 'node scripts/build-catalog.mjs',
  'build:runtime':
    'node scripts/clean-runtime-dist.js && tsup && node scripts/build-animate-cjs-types.js',
  prepack: 'pnpm build',
});

function defaultReadText(root, relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * Простая структурная выборка job-блоков GitHub Actions.
 *
 * Job ID по синтаксису Actions находится ровно на два пробела глубже `jobs:`.
 * Мы не пытаемся реализовать YAML-парсер: гейт проверяет репозиторный workflow,
 * а тесты фиксируют поддерживаемую структуру и не дают молча спутать nested key
 * с отдельным job.
 */
export function workflowJobBlocks(text) {
  const lines = text.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => /^jobs:\s*(?:#.*)?$/.test(line));
  if (jobsLine < 0) return [];

  const jobs = [];
  let current = null;
  for (let index = jobsLine + 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const indent = line.match(/^\s*/)?.[0].length ?? 0;

    if (trimmed && !trimmed.startsWith('#') && indent === 0) break;

    const header = line.match(/^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(?:#.*)?$/);
    if (header) {
      if (current) jobs.push({ id: current.id, text: current.lines.join('\n') });
      current = { id: header[1], lines: [line] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) jobs.push({ id: current.id, text: current.lines.join('\n') });
  return jobs;
}

/**
 * Извлекает только блоки pnpm/action-setup. Чужие inputs с ключом `version`
 * намеренно игнорируются: общий regex по YAML создавал бы ложные срабатывания.
 */
export function pnpmSetupBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const action = line.match(/^(\s*)(?:-\s+)?uses:\s*pnpm\/action-setup@([^\s#]+)/);
    if (!action) continue;

    const baseIndent = action[1].length;
    let version = null;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const next = lines[nextIndex];
      const trimmed = next.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = next.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed.startsWith('- ') && indent <= baseIndent) break;

      const versionMatch = trimmed.match(/^version:\s*['"]?([^'"\s#]+)/);
      if (versionMatch) version = versionMatch[1];
    }

    blocks.push({ ref: action[2], version });
  }

  return blocks;
}

/** Observatory опирается на hand blobs из истории, поэтому shallow запрещён. */
export function checkoutBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const action = lines[index].match(/^(\s*)(?:-\s+)?uses:\s*actions\/checkout@([^\s#]+)/);
    if (!action) continue;
    const baseIndent = action[1].length;
    let fetchDepth = null;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
      const next = lines[nextIndex];
      const trimmed = next.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const indent = next.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed.startsWith('- ') && indent <= baseIndent) break;
      const match = trimmed.match(/^fetch-depth:\s*['"]?([^'"\s#]+)/);
      if (match) fetchDepth = match[1];
    }
    blocks.push({ ref: action[2], fetchDepth });
  }
  return blocks;
}

/**
 * Допустим прямой `run: pnpm verify` либо два закрытых логирующих wrapper-а:
 *
 * - Bash: `set -o pipefail` + точная pipe-команда в `verify-linux.log`;
 * - PowerShell: точная pipe-команда + захват и проброс `$LASTEXITCODE`.
 *
 * Произвольные `|| true`, `continue-on-error` и логирование без сохранения кода
 * завершения этим контрактом не маскируются. Сокращённый YAML step `- run:`
 * эквивалентен развёрнутому `run:` и обязан распознаваться теми же правилами.
 */
export function hasCanonicalVerify(text) {
  if (/^\s*(?:-\s+)?run:\s*pnpm verify\s*$/m.test(text)) return true;

  const linuxPipefail = /^\s*set -o pipefail\s*$/m.test(text);
  const linuxLoggedCommand = /^\s*pnpm verify 2>&1 \| tee verify-linux\.log\s*$/m.test(text);
  if (linuxPipefail && linuxLoggedCommand) return true;

  const windowsLoggedCommand = /^\s*pnpm verify 2>&1 \| Tee-Object -FilePath verify-windows\.log\s*$/m.test(text);
  const capturesExit = /^\s*\$verifyExit = \$LASTEXITCODE\s*$/m.test(text);
  const propagatesExit = /^\s*if \(\$verifyExit -ne 0\) \{ exit \$verifyExit \}\s*$/m.test(text);
  return windowsLoggedCommand && capturesExit && propagatesExit;
}

/**
 * Извлекает shell-тело каждого `run` step без попытки исполнить YAML/shell.
 * Для release policy этого достаточно: remote mutation surface закрыта до
 * одного дословного command, а любое иное употребление token `push` в run
 * fail-closed запрещено.
 */
export function workflowRunScripts(text) {
  const lines = text.split(/\r?\n/);
  const scripts = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/);
    if (!match) continue;
    const baseIndent = match[1].length;
    const scalar = match[2];
    if (scalar && !/^[>|][+-]?$/.test(scalar)) {
      scripts.push(scalar);
      continue;
    }
    const body = [];
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      const trimmed = line.trim();
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (trimmed && indent <= baseIndent) break;
      if (indent > baseIndent) body.push(line.slice(baseIndent + 1));
      index = next;
    }
    scripts.push(body.join('\n'));
  }
  return scripts;
}

/** Любой standalone `push` внутри executable run-body считается mutation. */
export function pushTokenLinesFromRunSteps(text) {
  const token = /(?:^|[^A-Za-z0-9_])push(?:$|[^A-Za-z0-9_])/;
  return workflowRunScripts(text).flatMap((script) =>
    script.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && token.test(line)),
  );
}

function pnpmJobErrors({ relativePath, job, expectedPnpmVersion }) {
  const errors = [];
  const prefix = `${relativePath} job ${job.id}`;
  const setups = pnpmSetupBlocks(job.text);
  const checkouts = checkoutBlocks(job.text);

  if (checkouts.length !== 1) {
    errors.push(`${prefix}: должен быть ровно один actions/checkout; найдено ${checkouts.length}`);
  } else if (checkouts[0].fetchDepth !== '0') {
    errors.push(
      `${prefix}: checkout обязан иметь fetch-depth: 0 для historical-hand provenance; ` +
        `найдено ${checkouts[0].fetchDepth ?? 'ничего'}`,
    );
  }

  if (setups.length !== 1) {
    errors.push(`${prefix}: должен быть ровно один pnpm/action-setup; найдено ${setups.length}`);
  } else {
    const [setup] = setups;
    if (!PINNED_ACTION_REF.test(setup.ref)) {
      errors.push(
        `${prefix}: pnpm/action-setup обязан быть запинен полным 40-символьным SHA; найдено ${setup.ref}`,
      );
    }
    if (expectedPnpmVersion && setup.version !== expectedPnpmVersion) {
      errors.push(
        `${prefix}: pnpm action обязан использовать ${expectedPnpmVersion} из packageManager; ` +
          `найдено ${setup.version ?? 'ничего'}`,
      );
    }
  }

  if (!/^\s*(?:-\s+)?run:\s*pnpm install --frozen-lockfile\s*$/m.test(job.text)) {
    errors.push(`${prefix}: зависимости обязаны ставиться через «pnpm install --frozen-lockfile»`);
  }

  if (!hasCanonicalVerify(job.text)) {
    errors.push(`${prefix}: полный гейт должен запускаться канонической командой «pnpm verify»`);
  }

  const duplicatedEntrypoints = [
    ...job.text.matchAll(
      /^\s*(?:-\s+)?run:\s*pnpm\s+(build(?::\S+)?|typecheck|test|check:\S+)\s*$/gm,
    ),
  ].map((match) => match[0].trim());
  if (duplicatedEntrypoints.length > 0) {
    errors.push(
      `${prefix}: отдельные верхнеуровневые шаги дублируют verify и создают второй список истины: ` +
        duplicatedEntrypoints.join(', '),
    );
  }

  return errors;
}

function workflowErrors({ relativePath, text, expectedPnpmVersion }) {
  const errors = [];
  const jobs = workflowJobBlocks(text);
  if (jobs.length === 0) {
    return [`${relativePath}: секция jobs отсутствует или не распознана`];
  }

  const pnpmJobs = jobs.filter((job) => pnpmSetupBlocks(job.text).length > 0);
  if (pnpmJobs.length === 0) {
    errors.push(`${relativePath}: нет ни одного job с pnpm/action-setup`);
  }
  for (const job of pnpmJobs) {
    errors.push(...pnpmJobErrors({ relativePath, job, expectedPnpmVersion }));
  }

  // Verify без setup в том же job — типичный ложнозелёный matrix copy.
  for (const job of jobs) {
    if (hasCanonicalVerify(job.text) && pnpmSetupBlocks(job.text).length === 0) {
      errors.push(`${relativePath} job ${job.id}: pnpm verify есть, но pnpm/action-setup находится не в этом job`);
    }
  }

  if (/^\s*(?:-\s+)?run:\s*(npm|yarn)\s+(ci|install)\b/m.test(text)) {
    errors.push(`${relativePath}: установка зависимостей разрешена только через pnpm`);
  }

  return errors;
}

/** Release manual dispatch принимает только существующий tag package version. */
export function releaseWorkflowErrors(text) {
  const errors = [];
  const jobs = workflowJobBlocks(text);
  const owner = jobs.length === 1 && jobs[0].id === 'release-dist' ? jobs[0].text : '';
  if (jobs.length !== 1 || jobs[0]?.id !== 'release-dist') {
    errors.push(
      `.github/workflows/release-dist.yml: contents:write разрешён ровно одному job release-dist; ` +
        `найдено [${jobs.map((job) => job.id).join(', ')}]`,
    );
  }
  const exactCheckout =
    "ref: ${{ github.event_name == 'workflow_dispatch' && format('refs/tags/{0}', inputs.tag) || github.ref }}";
  if (!owner.includes(exactCheckout)) {
    errors.push('.github/workflows/release-dist.yml: checkout обязан разрешать manual input только как refs/tags/<tag>');
  }
  if (!/description:\s*['"][^'"\n]*branch\/SHA запрещены[^'"\n]*['"]/m.test(text)) {
    errors.push('.github/workflows/release-dist.yml: manual ref policy обязана явно запрещать branch/SHA');
  }
  const releaseTagEnv = [...owner.matchAll(/^\s*RELEASE_TAG:\s*\$\{\{ inputs\.tag \|\| github\.ref_name \}\}\s*$/gm)];
  if (releaseTagEnv.length !== 2) {
    errors.push(
      `.github/workflows/release-dist.yml: untrusted ref обязан входить в shell только через RELEASE_TAG env; ` +
        `найдено ${releaseTagEnv.length} bindings`,
    );
  }
  if (/run:\s*[^\n]*\$\{\{ inputs\.tag|TAG="\$\{\{ inputs\.tag/m.test(owner)) {
    errors.push('.github/workflows/release-dist.yml: inputs.tag запрещено интерполировать прямо в shell');
  }
  const sourceChecks = [...owner.matchAll(/^\s*run:\s*node scripts\/check-release-ref\.js source /gm)];
  const distChecks = [...owner.matchAll(/^\s*node scripts\/check-release-ref\.js dist /gm)];
  const stageChecks = [...owner.matchAll(/^\s*node scripts\/stage-release-dist\.js\s*$/gm)];
  if (sourceChecks.length !== 1) {
    errors.push(`.github/workflows/release-dist.yml: source ref check обязан быть ровно один; найдено ${sourceChecks.length}`);
  }
  if (distChecks.length !== 2) {
    errors.push(
      `.github/workflows/release-dist.yml: dist provenance обязан проверяться для existing и new tag; ` +
        `найдено ${distChecks.length}`,
    );
  }
  if (stageChecks.length !== 1) {
    errors.push(
      `.github/workflows/release-dist.yml: release-dist owner обязан ровно один раз stage-ить manifest; ` +
        `найдено ${stageChecks.length}`,
    );
  }
  if (!hasCanonicalVerify(owner)) {
    errors.push('.github/workflows/release-dist.yml: pnpm verify обязан выполняться внутри owner job release-dist');
  }
  if (!/^\s*git fetch --no-tags origin "refs\/tags\/\$\{DIST_TAG\}:refs\/tags\/\$\{DIST_TAG\}"\s*$/m.test(owner)) {
    errors.push('.github/workflows/release-dist.yml: existing sibling tag обязан fetch-иться перед provenance check');
  }
  const pushLines = pushTokenLinesFromRunSteps(owner);
  const canonicalPush = 'git push origin "refs/tags/${DIST_TAG}"';
  if (pushLines.length !== 1 || pushLines[0] !== canonicalPush) {
    errors.push(
      `.github/workflows/release-dist.yml: remote mutation surface обязан быть ровно «${canonicalPush}»; ` +
        `найдено [${pushLines.join(', ')}]`,
    );
  }
  const finalProvenance = owner.lastIndexOf('node scripts/check-release-ref.js dist "$TAG"');
  const pushIndex = owner.indexOf(canonicalPush);
  if (finalProvenance < 0 || pushIndex < finalProvenance) {
    errors.push('.github/workflows/release-dist.yml: tag push обязан идти после final new-dist provenance check');
  }
  return errors;
}

/**
 * Чистая проверка контракта. Инъекции readText/fileExists нужны не для моков
 * ради моков, а чтобы bite-тесты доказывали каждое запрещающее правило.
 */
export function validateRepoContract({
  root = ROOT,
  readText = (relativePath) => defaultReadText(root, relativePath),
  fileExists = (relativePath) => existsSync(join(root, relativePath)),
} = {}) {
  const errors = [];

  let pkg;
  try {
    pkg = JSON.parse(readText('package.json'));
  } catch (error) {
    return [`package.json: не читается как JSON (${error.message})`];
  }

  let releaseContract;
  try {
    releaseContract = JSON.parse(readText('release/contract.json'));
    errors.push(...validateReleaseContract(releaseContract));
    errors.push(...validatePackageProjection(pkg, releaseContract));
  } catch (error) {
    errors.push(`release/contract.json: не читается как JSON (${error.message})`);
  }

  const packageManagerMatch = EXACT_PNPM.exec(String(pkg.packageManager ?? ''));
  if (!packageManagerMatch) {
    errors.push(
      `package.json: packageManager обязан быть точной версией вида pnpm@X.Y.Z; найдено ${String(pkg.packageManager)}`,
    );
  }

  if (pkg.engines?.node !== '>=20') {
    errors.push(`package.json: engines.node обязан быть >=20; найдено ${String(pkg.engines?.node)}`);
  }
  if (pkg.engines?.pnpm !== '>=9') {
    errors.push(`package.json: engines.pnpm обязан быть >=9; найдено ${String(pkg.engines?.pnpm)}`);
  }

  if (!fileExists('pnpm-lock.yaml')) {
    errors.push('нет pnpm-lock.yaml — frozen install невоспроизводим');
  }
  for (const lockfile of FORBIDDEN_LOCKFILES) {
    if (fileExists(lockfile)) {
      errors.push(`${lockfile}: второй lockfile запрещён; SSOT зависимостей — pnpm-lock.yaml`);
    }
  }

  if (pkg.scripts?.['check:repo-contract'] !== 'node scripts/check-repo-contract.js') {
    errors.push('package.json: script check:repo-contract отсутствует или указывает не на канонический гейт');
  }
  if (
    typeof pkg.scripts?.verify !== 'string' ||
    !pkg.scripts.verify.startsWith('node scripts/check-repo-contract.js && ')
  ) {
    errors.push('package.json: verify обязан начинаться с check-repo-contract, чтобы дрейф кусался до сборки');
  }
  for (const [name, expected] of Object.entries(CANONICAL_BUILD_SCRIPTS)) {
    if (pkg.scripts?.[name] !== expected) {
      errors.push(`package.json: ${name} обязан быть «${expected}»; найдено «${String(pkg.scripts?.[name])}»`);
    }
  }
  if (typeof pkg.scripts?.verify === 'string') {
    const commands = pkg.scripts.verify.split('&&').map((command) => command.trim());
    if (commands[1] !== 'node scripts/check-catalog.js') {
      errors.push(
        'package.json: verify обязан проверять catalog drift до typecheck/build, иначе build скроет stale projection',
      );
    }
    if (commands.filter((command) => command === 'pnpm build').length !== 1) {
      errors.push('package.json: verify обязан ровно один раз вызывать канонический pnpm build');
    }
    for (const bypass of [
      'node scripts/build.js',
      'node scripts/build-anatomy.js',
      'pnpm build:static',
      'pnpm build:catalog',
      'pnpm build:runtime',
    ]) {
      if (commands.includes(bypass)) {
        errors.push(`package.json: verify обходит канонический build через «${bypass}»`);
      }
    }
  }

  const expectedPnpmVersion = packageManagerMatch?.[1] ?? null;
  for (const relativePath of ['.github/workflows/ci.yml', '.github/workflows/release-dist.yml']) {
    let text;
    try {
      text = readText(relativePath);
    } catch (error) {
      errors.push(`${relativePath}: не читается (${error.message})`);
      continue;
    }
    errors.push(...workflowErrors({ relativePath, text, expectedPnpmVersion }));
    if (relativePath === '.github/workflows/release-dist.yml') {
      errors.push(...releaseWorkflowErrors(text));
    }
  }

  return errors;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = validateRepoContract();
  if (errors.length > 0) {
    console.error(`check-repo-contract: HARD — ${errors.length} нарушений:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('check-repo-contract: OK — один pnpm/lockfile, CI и release выполняют канонический pnpm verify');
}
