#!/usr/bin/env node
/**
 * docs-drift guard for @labpics/icons
 *
 * Доки vs реальность (сверяет утверждения, а не файловые инварианты —
 * файлы/экспорты держит check-parity, чернила dist — check-colors):
 *
 *   1. Конкретные версии в README (`#vX.Y.Z-dist` пины, `git tag vX.Y.Z`
 *      примеры) == package.json.version. Плейсхолдеры `vX.Y.Z` разрешены.
 *   2. Числовые утверждения о корпусе («N имён/иконок/SVG/экспортов/файлов»
 *      в README и docs/*.md) принадлежат множеству фактов ФС
 *      {имена, файлы по весам, всего, экспорты}.
 *   3. `*-HANDOFF.md` в корне запрещены; `handoffs/*.md` обязаны нести
 *      строку `Статус:`.
 *   4. README не обещает конкретный hex чернил (противоречило бы
 *      check-colors, который запрещает hex в dist/svg).
 *   5. Каждый docs/*.md в первых 5 строках объявляет роль
 *      (справка | ADR | канон | гайд | отчёт | «Роль:»).
 *   6. README проецирует public npm/fallback/exports из release contract и
 *      не может вернуться к устаревшему private/git-only рассказу.
 *
 * Функции чистые и экспортируются — каждое поведение доказуемо юнитами
 * (test/docs-drift.test.js), включая «гейт кусается».
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
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
 * 6. Public release surface                                           *
 * ------------------------------------------------------------------ */

/** README — человекочитаемая проекция release SSOT, не второй канон. */
export function validateReadmeReleaseProjection(readme, pkg, contract) {
  const errors = [];
  if (pkg.private !== false) {
    errors.push('package.json#private обязан быть false для документированного public npm channel');
  }
  const install = contract?.primary?.install;
  if (typeof install !== 'string' || !readme.includes(install)) {
    errors.push(`README: отсутствует primary install из release contract: ${String(install)}`);
  }
  const fallback = contract?.fallback?.specifier?.replace('vX.Y.Z', `v${pkg.version}`);
  if (typeof fallback !== 'string' || !readme.includes(fallback)) {
    errors.push(`README: отсутствует versioned fallback из release contract: ${String(fallback)}`);
  }
  for (const subpath of Object.keys(contract?.exports ?? {})) {
    const specifier = subpath === '.'
      ? contract.packageName
      : `${contract.packageName}${subpath.slice(1)}`;
    if (!readme.includes(`\`${specifier}\``)) {
      errors.push(`README: публичный export ${specifier} не документирован как code literal`);
    }
  }
  for (const required of ['release/contract.json', 'pnpm observatory', 'prepack']) {
    if (!readme.includes(required)) errors.push(`README: отсутствует обязательный release/QA marker «${required}»`);
  }
  const releaseCountClaim = `ровно ${contract?.files?.length} release‑файлов`;
  if (!readme.includes(releaseCountClaim)) {
    errors.push(`README: отсутствует точный count release manifest «${releaseCountClaim}»`);
  }
  const stalePrivateClaims = [
    /private\s*:\s*true/i,
    /НЕ\s+публикуется[^\n]*npm/i,
    /ставится\s+только\s+как\s+git[- ]зависимость/i,
  ];
  for (const pattern of stalePrivateClaims) {
    if (pattern.test(readme)) {
      errors.push(`README: найден устаревший private/git-only claim ${pattern}`);
    }
  }
  return errors;
}

/* ------------------------------------------------------------------ *
 * Аудит целиком                                                       *
 * ------------------------------------------------------------------ */

export function auditRepo(root = ROOT) {
  const errors = [];
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const releaseContract = JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8'));

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

  // 6. Public npm + exports + fallback
  errors.push(...validateReadmeReleaseProjection(readme, pkg, releaseContract));

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
