#!/usr/bin/env node
/**
 * Гейт воспроизводимости репозитория.
 *
 * Почему он существует: локальная verify-цепь, CI и release workflow уже
 * расходились. Такой дрейф опаснее красного CI — часть обязательных проверок
 * могла вообще не запускаться. Гейт держит один package manager, один lockfile
 * и один вход в полный набор проверок: `pnpm verify`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function defaultReadText(root, relativePath) {
  return readFileSync(join(root, relativePath), 'utf8');
}

/**
 * Извлекает только блоки pnpm/action-setup. Чужие inputs с ключом `version`
 * намеренно игнорируются: общий regex по YAML создавал бы ложные срабатывания.
 */
export function pnpmSetupBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const action = line.match(/^(\s*)(?:-\s+)?uses:\s*pnpm\/action-setup@([^\s#]+)/);
    if (!action) continue;

    const baseIndent = action[1].length;
    let version = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      const trimmed = next.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const indent = next.match(/^\s*/)[0].length;
      if (trimmed.startsWith('- ') && indent <= baseIndent) break;

      const versionMatch = trimmed.match(/^version:\s*['"]?([^'"\s#]+)/);
      if (versionMatch) version = versionMatch[1];
    }

    blocks.push({ ref: action[2], version });
  }

  return blocks;
}

function workflowErrors({ relativePath, text, expectedPnpmVersion }) {
  const errors = [];
  const setups = pnpmSetupBlocks(text);

  if (setups.length !== 1) {
    errors.push(`${relativePath}: должен быть ровно один pnpm/action-setup; найдено ${setups.length}`);
  } else {
    const [setup] = setups;
    if (!PINNED_ACTION_REF.test(setup.ref)) {
      errors.push(`${relativePath}: pnpm/action-setup обязан быть запинен полным 40-символьным SHA; найдено ${setup.ref}`);
    }
    if (expectedPnpmVersion && setup.version !== expectedPnpmVersion) {
      errors.push(
        `${relativePath}: pnpm action обязан использовать ${expectedPnpmVersion} из packageManager; ` +
          `найдено ${setup.version ?? 'ничего'}`,
      );
    }
  }

  if (!/^\s*run:\s*pnpm install --frozen-lockfile\s*$/m.test(text)) {
    errors.push(`${relativePath}: зависимости обязаны ставиться через «pnpm install --frozen-lockfile»`);
  }

  if (!/^\s*run:\s*pnpm verify\s*$/m.test(text)) {
    errors.push(`${relativePath}: полный гейт должен запускаться одной командой «pnpm verify»`);
  }

  const duplicatedEntrypoints = [
    ...text.matchAll(/^\s*run:\s*pnpm\s+(build(?::\S+)?|typecheck|test|check:\S+)\s*$/gm),
  ].map((match) => match[0].trim());
  if (duplicatedEntrypoints.length > 0) {
    errors.push(
      `${relativePath}: отдельные верхнеуровневые шаги дублируют verify и создают второй список истины: ` +
        duplicatedEntrypoints.join(', '),
    );
  }

  if (/^\s*run:\s*(npm|yarn)\s+(ci|install)\b/m.test(text)) {
    errors.push(`${relativePath}: установка зависимостей разрешена только через pnpm`);
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
  }

  return errors;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = validateRepoContract();
  if (errors.length > 0) {
    console.error(`check-repo-contract: HARD — ${errors.length} нарушений воспроизводимости:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('check-repo-contract: OK — packageManager SSOT, один lockfile, CI/release запускают канонический pnpm verify');
}
