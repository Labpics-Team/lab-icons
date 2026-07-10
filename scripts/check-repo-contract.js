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

const REQUIRED_PACKAGE_MANAGER = 'pnpm@10.30.3';
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

function workflowErrors({ relativePath, text, expectedPnpmVersion }) {
  const errors = [];
  const versions = [...text.matchAll(/^\s*version:\s*['"]?([^'"\s#]+)/gm)].map((match) => match[1]);

  if (!text.includes('pnpm/action-setup@')) {
    errors.push(`${relativePath}: нет pnpm/action-setup`);
  }

  if (versions.length !== 1 || versions[0] !== expectedPnpmVersion) {
    errors.push(
      `${relativePath}: pnpm action обязан использовать ${expectedPnpmVersion}; найдено: ${versions.join(', ') || 'ничего'}`,
    );
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

  if (pkg.packageManager !== REQUIRED_PACKAGE_MANAGER) {
    errors.push(
      `package.json: packageManager обязан быть ${REQUIRED_PACKAGE_MANAGER}; найдено ${String(pkg.packageManager)}`,
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

  const expectedPnpmVersion = REQUIRED_PACKAGE_MANAGER.slice('pnpm@'.length);
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
  console.log('check-repo-contract: OK — один pnpm, один lockfile, CI/release запускают канонический pnpm verify');
}
