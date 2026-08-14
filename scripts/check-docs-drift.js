#!/usr/bin/env node
/**
 * docs-drift guard for @labpics/icons
 *
 * Доки vs реальность (сверяет утверждения, а не файловые инварианты —
 * файлы/экспорты держит check-parity, чернила dist — check-colors):
 *
 *   1. Конкретные версии в README (`#vX.Y.Z-dist` пины, `git tag vX.Y.Z`
 *      примеры) == package.json.version. Плейсхолдеры `vX.Y.Z` разрешены.
 *   2. Числовые утверждения о корпусе принадлежат множеству фактов ФС.
 *   3. Хендоффы живут только в handoffs/ и объявляют статус.
 *   4. README не обещает конкретный hex чернил.
 *   5. Каждый docs/*.md в первых 5 строках объявляет роль.
 *   6. Каналы поставки README совпадают с release/contract.json и package.json;
 *      ложные заявления private/git-only/PAT запрещены механически.
 *
 * Функции чистые и экспортируются — каждое поведение доказуемо юнитами
 * (test/docs-drift.test.js), включая «гейт кусается».
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ *
 * 1. Версии                                                           *
 * ------------------------------------------------------------------ */

/** Конкретные (не-плейсхолдерные) версии, на которые ссылается текст. */
export function extractVersionRefs(text) {
  const refs = [];
  for (const m of text.matchAll(/#v(\d+\.\d+\.\d+)-dist/g))
    refs.push({ kind: 'dist-pin', version: m[1] });
  for (const m of text.matchAll(/git tag v(\d+\.\d+\.\d+)/g))
    refs.push({ kind: 'tag-example', version: m[1] });
  return refs;
}

/* ------------------------------------------------------------------ *
 * 2. Счётчики корпуса                                                 *
 * ------------------------------------------------------------------ */

const COUNT_UNITS =
  /(\d{2,})\s*(имени|имён|иконки|иконок|SVG|экспорта|экспортов|именованных|файла|файлов)/gi;

/** Числовые утверждения «N <единица корпуса>» из текста дока. */
export function extractCountClaims(text) {
  return [...text.matchAll(COUNT_UNITS)].map((m) => ({
    n: Number(m[1]),
    unit: m[2],
    context: m[0],
  }));
}

/** Факты ФС: имена (union по весам), файлы, экспорты. */
export function computeCorpusFacts(root) {
  const read = (w) =>
    readdirSync(join(root, 'svg', w)).filter((f) => f.endsWith('.svg'));
  const base = (f) => f.replace(/(_(filled|outline))?\.svg$/i, '');
  const outline = read('Outline');
  const filled = read('Filled');
  const names = new Set([...outline.map(base), ...filled.map(base)]);
  return {
    names: names.size,
    outline: outline.length,
    filled: filled.length,
    total: outline.length + filled.length,
    exports: names.size * 2,
  };
}

export function allowedCounts(facts) {
  return new Set([facts.names, facts.outline, facts.filled, facts.total, facts.exports]);
}

/* ------------------------------------------------------------------ *
 * 3. Хендоффы                                                         *
 * ------------------------------------------------------------------ */

/** @returns список нарушений размещения/оформления хендоффов. */
export function handoffViolations({ rootFiles, handoffs }) {
  const errs = [];
  for (const f of rootFiles)
    if (/-HANDOFF\.md$/i.test(f))
      errs.push(`хендофф в корне запрещён: ${f} → handoffs/${f}`);
  for (const [name, text] of Object.entries(handoffs))
    if (!/^Статус:/m.test(text))
      errs.push(`handoffs/${name}: нет строки «Статус:» — судьба волны нечитаема`);
  return errs;
}

/* ------------------------------------------------------------------ *
 * 4. Чернила                                                          *
 * ------------------------------------------------------------------ */

/** Обещания конкретного hex чернил в тексте дока. */
export function findInkHexClaims(text) {
  return [...text.matchAll(/чернила[^\n]*#[0-9a-fA-F]{3,8}/gi)].map((m) => m[0]);
}

/* ------------------------------------------------------------------ *
 * 5. Роли доков                                                       *
 * ------------------------------------------------------------------ */

/** Роль объявлена в первых 5 строках дока. */
export function hasDocRole(text) {
  const head = text.split('\n').slice(0, 5).join('\n');
  return /(справка|ADR|канон|гайд|отчёт|роль:)/i.test(head);
}

/* ------------------------------------------------------------------ *
 * 6. Каналы поставки                                                  *
 * ------------------------------------------------------------------ */

const FALSE_DISTRIBUTION_CLAIMS = [
  {
    re: /["']?private["']?\s*:\s*["']?true["']?/i,
    why: 'package public, private:false',
  },
  {
    re: /не\s+публикуется.{0,160}\bnpm\b/i,
    why: 'npm — основной опубликованный канал',
  },
  { re: /почему\s+не\s+npm\b/i, why: 'npm — основной опубликованный канал' },
  { re: /репозитор(?:ий|ия)[\s-]*приват/i, why: 'репозиторий public' },
  {
    re: /fine\s*-\s*grained\s+PAT|\bGH_PAT\b|Contents\s*:\s*read/i,
    why: 'npm install не требует GitHub PAT',
  },
];

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Нормализация нужна именно для guard-а утверждений: markdown, перенос строки
 * и типографский дефис не должны превращать ложь в невидимую для regex форму.
 */
export function normalizeDistributionText(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[`*_~]/g, '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Фактические аргументы исполняемой команды git add -f, не совпадения в комментариях. */
export function releaseWorkflowFiles(releaseWorkflow) {
  const match = releaseWorkflow.match(/^\s*git\s+add\s+-f\s+([^\n#]+?)\s*$/m);
  return match ? match[1].trim().split(/\s+/) : [];
}

/**
 * Release contract владеет устойчивой формой каналов; внешняя публикация
 * проверяется release-probe, но README не имеет права противоречить контракту.
 */
export function distributionViolations({ readme, pkg, contract, releaseWorkflow }) {
  const errors = [];
  const plainReadme = normalizeDistributionText(readme);

  if (contract.version !== 1) errors.push(`release contract: неизвестная schema version ${contract.version}`);
  if (contract.packageName !== pkg.name)
    errors.push(`release contract packageName ${contract.packageName} != package.json ${pkg.name}`);
  if (pkg.private !== false) errors.push('package.json обязан нести private:false для public npm channel');
  if (contract.primary?.kind !== 'npm') errors.push('release contract: primary channel обязан быть npm');
  if (!nonEmptyString(contract.primary?.install))
    errors.push('release contract: primary.install обязан быть непустой строкой');
  if (contract.fallback?.kind !== 'github-dist-tag' || contract.fallback?.immutable !== true)
    errors.push('release contract: fallback обязан быть immutable github-dist-tag');
  if (!nonEmptyString(contract.fallback?.specifier))
    errors.push('release contract: fallback.specifier обязан быть непустой строкой');
  if (!isDeepStrictEqual(contract.files, pkg.files))
    errors.push('release contract files != package.json#files');
  if (!isDeepStrictEqual(contract.exports, pkg.exports))
    errors.push('release contract exports != package.json#exports');

  if (nonEmptyString(contract.primary?.install) && !readme.includes(contract.primary.install))
    errors.push(`README не содержит primary install «${contract.primary.install}»`);
  if (nonEmptyString(contract.fallback?.specifier) && !readme.includes(contract.fallback.specifier))
    errors.push(`README не содержит fallback specifier «${contract.fallback.specifier}»`);
  if (!/основн.{0,80}\bnpm\b/i.test(plainReadme))
    errors.push('README не объявляет npm основным каналом');
  if (!/(fallback|резервн|дополнительн).{0,120}-dist/i.test(plainReadme))
    errors.push('README не объясняет -dist как дополнительный fallback');

  for (const { re, why } of FALSE_DISTRIBUTION_CLAIMS) {
    const match = plainReadme.match(re);
    if (match) errors.push(`README ложное distribution-утверждение «${match[0]}» (${why})`);
  }

  const actualFiles = releaseWorkflowFiles(releaseWorkflow);
  if (!isDeepStrictEqual(actualFiles, contract.files))
    errors.push(
      `release-dist git add files ${JSON.stringify(actualFiles)} != contract ${JSON.stringify(contract.files)}`,
    );
  if (!/^\s*run:\s*pnpm\s+verify\s*$/m.test(releaseWorkflow))
    errors.push('release-dist workflow не запускает canonical pnpm verify');
  return errors;
}

/* ------------------------------------------------------------------ *
 * Аудит целиком                                                       *
 * ------------------------------------------------------------------ */

export function auditRepo(root = ROOT) {
  const errors = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(join(root, 'README.md'), 'utf8');

  // 1. Версии
  for (const ref of extractVersionRefs(readme))
    if (ref.version !== pkg.version)
      errors.push(
        `README ${ref.kind} v${ref.version} != package.json ${pkg.version}`,
      );

  // 2. Счётчики (README + docs/*.md)
  const facts = computeCorpusFacts(root);
  const allowed = allowedCounts(facts);
  const docsDir = join(root, 'docs');
  const docFiles = existsSync(docsDir)
    ? readdirSync(docsDir).filter((f) => f.endsWith('.md'))
    : [];
  const corpus = [
    ['README.md', readme],
    ...docFiles.map((f) => [`docs/${f}`, readFileSync(join(docsDir, f), 'utf8')]),
  ];
  for (const [file, text] of corpus)
    for (const c of extractCountClaims(text))
      if (!allowed.has(c.n))
        errors.push(
          `${file}: заявлено «${c.context}», факт ФС: ${JSON.stringify(facts)}`,
        );

  // 3. Хендоффы
  const rootFiles = readdirSync(root).filter((f) => f.endsWith('.md'));
  const handoffDir = join(root, 'handoffs');
  const handoffs = existsSync(handoffDir)
    ? Object.fromEntries(
        readdirSync(handoffDir)
          .filter((f) => f.endsWith('.md'))
          .map((f) => [f, readFileSync(join(handoffDir, f), 'utf8')]),
      )
    : {};
  errors.push(...handoffViolations({ rootFiles, handoffs }));

  // 4. Чернила
  for (const claim of findInkHexClaims(readme))
    errors.push(
      `README обещает hex чернил («${claim}») — противоречит check:colors (hex в dist запрещён)`,
    );

  // 5. Роли
  for (const [file, text] of corpus.slice(1))
    if (!hasDocRole(text))
      errors.push(`${file}: роль не объявлена в первых 5 строках (справка/ADR/канон/гайд/отчёт)`);

  // 6. Поставка
  const contract = JSON.parse(readFileSync(join(root, 'release', 'contract.json'), 'utf8'));
  const releaseWorkflow = readFileSync(join(root, '.github', 'workflows', 'release-dist.yml'), 'utf8');
  errors.push(...distributionViolations({ readme, pkg, contract, releaseWorkflow }));

  return { errors, facts };
}

/* ------------------------------------------------------------------ */

const isCLI =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCLI) {
  const { errors, facts } = auditRepo(ROOT);
  console.log(
    `check-docs-drift: факт ФС — имён ${facts.names}, файлов ${facts.total}, экспортов ${facts.exports}`,
  );
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`check-docs-drift: FAIL (${errors.length})`);
    process.exit(1);
  }
  console.log('check-docs-drift: PASS — доки совпадают с реальностью');
}
