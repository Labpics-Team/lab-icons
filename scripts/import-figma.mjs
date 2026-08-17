#!/usr/bin/env node
/**
 * Fail-closed intake парного Figma-экспорта.
 *
 * Dry-run проверяет только экспорт в памяти. Promotion (--write) имеет более
 * сильный контракт: один proposal на одну пару, существующий exact corpus id,
 * обязательный proposal gate и атомарная замена полного svg-дерева после
 * staging/readback. Поэтому ни parse-error, ни partial write не могут изменить
 * рабочий corpus.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recoverOwnedDirectory, replaceOwnedDirectory } from './lib/owned-directory.js';
import { EXPECTED_ICON_NAMES } from './lib/corpus-contract.js';
import {
  canonicalIconName,
  normalizeFigmaSvg,
} from './lib/figma-import.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FS = Object.freeze({
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
});

function usage() {
  return [
    'Usage: node scripts/import-figma.mjs --source <export-dir> [--icons id,id] [--proposal file] [--write]',
    '',
    'Ожидается <export-dir>/{Outline,Filled}/*.svg. Без --write файлы только',
    'нормализуются и валидируются в памяти.',
    'Для --write export-dir должен содержать ровно одну выбранную пару и proposal.json.',
  ].join('\n');
}

export function argumentsFrom(argv) {
  const result = { source: null, proposal: null, icons: null, write: false };
  const valueAt = (index, flag) => {
    const value = argv[index];
    if (value == null || value.startsWith('--')) {
      throw new Error(`figma-import: ${flag} отсутствует значение\n${usage()}`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--write') result.write = true;
    else if (value === '--source') result.source = valueAt(++index, '--source');
    else if (value === '--proposal') result.proposal = valueAt(++index, '--proposal');
    else if (value === '--icons') {
      const raw = valueAt(++index, '--icons');
      result.icons = raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => canonicalIconName(item));
      if (result.icons.length === 0) {
        throw new Error(`figma-import: --icons пуст\n${usage()}`);
      }
    } else if (value === '--help' || value === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`figma-import: неизвестный аргумент ${value}\n${usage()}`);
    }
  }
  if (!result.source) throw new Error(`figma-import: обязателен --source\n${usage()}`);
  if (result.icons && new Set(result.icons).size !== result.icons.length) {
    throw new Error('figma-import: --icons содержит повторяющийся canonical id');
  }
  return result;
}

function variantCatalog(sourceRoot, variant, fs, label = variant) {
  const directory = join(sourceRoot, variant);
  if (!fs.existsSync(directory)) {
    throw new Error(`figma-import: ожидается каталог ${directory} для варианта ${variant}`);
  }
  const catalog = new Map();
  for (const file of fs.readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.svg')).sort()) {
    const id = canonicalIconName(basename(file, '.svg'));
    if (catalog.has(id)) {
      throw new Error(`figma-import: ${label} collision для ${id}: ${catalog.get(id)} и ${file}`);
    }
    catalog.set(id, file);
  }
  return catalog;
}

function destinationName(id, variant) {
  return variant === 'Filled' ? `${id}_filled.svg` : `${id}.svg`;
}

function sortedDifference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

function exactNameSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) === JSON.stringify(expectedSorted)) return;
  const missing = sortedDifference(expectedSorted, actualSorted);
  const extra = sortedDifference(actualSorted, expectedSorted);
  throw new Error(
    `figma-import: ${label} exact corpus/name contract нарушен; ` +
    `missing=${missing.join(',') || '-'}; extra=${extra.join(',') || '-'}`,
  );
}

function repositoryVariantCatalog(svgRoot, variant, fs) {
  const directory = join(svgRoot, variant);
  if (!fs.existsSync(directory)) {
    throw new Error(`figma-import: repository ${directory} отсутствует`);
  }
  const catalog = new Map();
  const suffix = variant === 'Filled' ? '_filled.svg' : '.svg';
  for (const file of fs.readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.svg')).sort()) {
    if (variant === 'Filled' && !file.endsWith(suffix)) {
      throw new Error(`figma-import: repository ${variant}/${file} не имеет канонического suffix _filled.svg`);
    }
    const raw = file.slice(0, -suffix.length);
    const id = canonicalIconName(raw);
    if (file !== destinationName(id, variant)) {
      throw new Error(`figma-import: repository ${variant}/${file} имеет неканоническое имя для ${id}`);
    }
    if (catalog.has(id)) {
      throw new Error(`figma-import: repository ${variant} collision для ${id}`);
    }
    catalog.set(id, file);
  }
  return catalog;
}

function readCatalogNames(repoRoot, fs) {
  const path = join(repoRoot, 'semantics', 'catalog.json');
  let document;
  try {
    document = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`figma-import: catalog.json не читается (${cause.message})`);
  }
  if (!document || typeof document !== 'object' || !document.icons || typeof document.icons !== 'object') {
    throw new Error('figma-import: catalog.json не содержит object icons');
  }
  return Object.keys(document.icons).sort();
}

function assertRepositoryCorpus(repoRoot, fs, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) {
    throw new TypeError('figma-import: expectedIconNames обязан быть положительным целым');
  }
  const svgRoot = join(repoRoot, 'svg');
  const outline = repositoryVariantCatalog(svgRoot, 'Outline', fs);
  const filled = repositoryVariantCatalog(svgRoot, 'Filled', fs);
  const outlineIds = [...outline.keys()].sort();
  const filledIds = [...filled.keys()].sort();
  if (outlineIds.length !== expectedCount || filledIds.length !== expectedCount) {
    throw new Error(
      `figma-import: repository corpus count contract нарушен; ` +
      `expected=${expectedCount} outline=${outlineIds.length} filled=${filledIds.length}`,
    );
  }
  exactNameSet(filledIds, outlineIds, 'repository Outline/Filled');
  const catalogNames = readCatalogNames(repoRoot, fs);
  if (catalogNames.length !== expectedCount) {
    throw new Error(
      `figma-import: catalog corpus count contract нарушен; expected=${expectedCount} got=${catalogNames.length}`,
    );
  }
  exactNameSet(catalogNames, outlineIds, 'repository catalog');
  return outlineIds;
}

function proposalGate({ sourceRoot, proposalPath, icon, validator = runProposalValidator }) {
  const result = validator({ sourceRoot, proposalPath, icon });
  if (
    !result ||
    result.status !== 'PASS' ||
    result.selected !== 1 ||
    result.variants !== 2 ||
    result.proposal?.icon !== icon
  ) {
    throw new Error('figma-import: proposal gate не доказал единственную согласованную пару');
  }
  return result;
}

function runProposalValidator({ sourceRoot, proposalPath, icon }) {
  const validatorPath = join(root, 'scripts', 'validate-icon-proposal.mjs');
  const result = spawnSync(
    process.execPath,
    [validatorPath, '--source', sourceRoot, '--proposal', proposalPath, '--icons', icon, '--json'],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.error) {
    throw new Error(`figma-import: proposal gate не запустился (${result.error.message})`);
  }
  const detail = [result.stderr, result.stdout]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join('\n');
  if (result.status !== 0) {
    throw new Error(`figma-import: proposal gate отклонён\n${detail}`);
  }
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch (cause) {
    throw new Error(`figma-import: proposal gate вернул невалидный JSON (${cause.message})`);
  }
  if (
    payload.status !== 'PASS' ||
    payload.selected !== 1 ||
    payload.variants !== 2 ||
    payload.proposal?.icon !== icon
  ) {
    throw new Error('figma-import: proposal gate не доказал единственную согласованную пару');
  }
  return payload;
}

function writeTransaction({ repoRoot, staged, names, fs }) {
  const svgRoot = join(repoRoot, 'svg');
  const backup = join(repoRoot, '.svg-figma-import-backup');
  recoverOwnedDirectory({ output: svgRoot, backup, fs });
  const staging = fs.mkdtempSync(join(repoRoot, '.figma-import-'));
  try {
    // mkdtemp gives us a collision-free path; cp needs that destination absent
    // so the staging root is byte-for-byte the future svg root, not svg/svg.
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(svgRoot, staging, { recursive: true, errorOnExist: true });
    for (const item of staged) {
      const targetPath = join(staging, item.variant, destinationName(item.id, item.variant));
      fs.writeFileSync(targetPath, item.content, 'utf8');
      if (fs.readFileSync(targetPath, 'utf8') !== item.content) {
        throw new Error(`figma-import: readback расходится для ${targetPath}`);
      }
    }
    // Staging itself is the commit candidate. Re-checking names ensures no
    // future copy/write change can publish a partial or renamed corpus.
    const stagedOutline = repositoryVariantCatalog(staging, 'Outline', fs);
    const stagedFilled = repositoryVariantCatalog(staging, 'Filled', fs);
    exactNameSet([...stagedFilled.keys()], [...stagedOutline.keys()], 'staged Outline/Filled');
    exactNameSet([...stagedOutline.keys()], names, 'staged repository');
    replaceOwnedDirectory({ staging, output: svgRoot, backup, fs });
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
}

export function importFigma({
  argv,
  repoRoot = root,
  fs = DEFAULT_FS,
  expectedIconNames = EXPECTED_ICON_NAMES,
  validateProposal = runProposalValidator,
} = {}) {
  const options = argumentsFrom(argv ?? []);
  const sourceRoot = resolve(options.source);
  const catalogs = Object.fromEntries(
    ['Outline', 'Filled'].map((variant) => [variant, variantCatalog(sourceRoot, variant, fs)]),
  );
  const outlineIds = [...catalogs.Outline.keys()].sort();
  const filledIds = [...catalogs.Filled.keys()].sort();
  if (JSON.stringify(outlineIds) !== JSON.stringify(filledIds)) {
    const outlineOnly = outlineIds.filter((id) => !catalogs.Filled.has(id));
    const filledOnly = filledIds.filter((id) => !catalogs.Outline.has(id));
    throw new Error(
      `figma-import: Outline/Filled parity нарушен; outline-only=${outlineOnly.join(',')}; filled-only=${filledOnly.join(',')}`,
    );
  }

  const selected = options.icons ?? outlineIds;
  const unknown = selected.filter((id) => !catalogs.Outline.has(id));
  if (unknown.length > 0) throw new Error(`figma-import: в экспорте нет ${unknown.join(', ')}`);

  // Сначала валидируется весь выбранный batch в памяти. Это сохраняет dry-run
  // и гарантирует, что parse-error никогда не появляется после записи.
  const staged = [];
  for (const id of selected) {
    for (const variant of ['Outline', 'Filled']) {
      const sourceFile = catalogs[variant].get(id);
      const sourcePath = join(sourceRoot, variant, sourceFile);
      const content = normalizeFigmaSvg(fs.readFileSync(sourcePath, 'utf8'), {
        source: `${variant}/${sourceFile}`,
      });
      staged.push({ id, variant, sourcePath, content });
    }
  }

  if (options.write) {
    if (selected.length !== 1) {
      throw new Error('figma-import: --write требует ровно одну выбранную пару для proposal gate');
    }
    if (JSON.stringify(outlineIds) !== JSON.stringify(selected)) {
      throw new Error('figma-import: --write требует export-dir ровно с выбранным exact name corpus');
    }
    const repositoryNames = assertRepositoryCorpus(repoRoot, fs, expectedIconNames);
    if (!repositoryNames.includes(selected[0])) {
      throw new Error(`figma-import: ${selected[0]} отсутствует в exact repository corpus`);
    }
    const proposalPath = resolve(options.proposal ?? join(sourceRoot, 'proposal.json'));
    proposalGate({
      sourceRoot,
      proposalPath,
      icon: selected[0],
      validator: validateProposal,
    });
    writeTransaction({ repoRoot, staged, names: repositoryNames, fs });
  }

  return Object.freeze({ names: selected.length, variants: staged.length, mode: options.write ? 'write' : 'check' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = importFigma({ argv: process.argv.slice(2) });
    console.log(
      `figma-import: OK — ${result.names} names / ${result.variants} variants; mode=${result.mode}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
