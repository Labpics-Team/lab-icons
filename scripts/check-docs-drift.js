#!/usr/bin/env node
/** Проверяет проекцию поставки и известные противоречия каналам установки. */
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePackageProjection, validateReleaseContract } from './lib/release-contract.js';
import { packageReferenceErrors, renderPackageReference } from './lib/docs-reference.js';

import { parseDocumentation } from './lib/docs-markdown.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function normalizeDistributionText(text) {
  return parseDocumentation(text).text.normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim();
}

// Это контроль известных противоречий, не доказательство истинности произвольной прозы.
export function distributionClaimErrors(text) {
  const plain = normalizeDistributionText(text);
  const rules = [
    [/["']?private["']?\s*:\s*["']?true["']?/i, 'пакет объявлен публичным'],
    [/не\s+публикуется.{0,160}\bnpm\b/i, 'npm является основным каналом, не обещанием публикации каждой версии'],
    [/почему\s+не\s+npm\b/i, 'npm является основным каналом'],
    [/репозитор(?:ий|ия)[\s-]*приват/i, 'репозиторий публичный'],
    [/ставится\s+только\s+как\s+git[- ]зависимость/i, 'Git не является единственным каналом'],
    [/fine\s*-\s*grained\s+PAT|\bGH_PAT\b|Contents\s*:\s*read/i, 'установка из публичного npm не требует GitHub PAT'],
  ];
  return rules.flatMap(([pattern, reason]) => {
    const match = plain.match(pattern);
    return match ? [`противоречие каналу поставки «${match[0]}»: ${reason}`] : [];
  });
}

/** Рекурсивный обход авторской Markdown-документации; экспериментальные данные не входят. */
export function documentationFiles(root) {
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name);
  function walk(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`документация не должна уходить за checkout через symlink: ${path}`);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(path);
    }
  }
  walk('docs');
  return files.sort();
}

export function findInkHexClaims(text) {
  return [...text.matchAll(/чернила[^\n]*#[0-9a-fA-F]{3,8}/gi)].map((match) => match[0]);
}

/** Сессионные инструкции живут в PR, а не рядом с действующей документацией. */
export function sessionHandoffErrors(root) {
  const errors = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^(?:HANDOFF(?:-.*)?|.*-HANDOFF)\.md$/i.test(entry.name))
    .map((entry) => `сессионный handoff в корне: ${entry.name}`);
  const directory = join(root, 'handoffs');
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    errors.push('handoffs/ содержит сессионные инструкции; сохраните незакрытые работы в PR до удаления');
  }
  return errors;
}

/** Проверка файловых Markdown-ссылок, включая reference-style и изображения. */
export function documentationLinkErrors(root, file, source) {
  const errors = [];
  for (const href of parseDocumentation(source).links) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//') || href.startsWith('#')) continue;
    try {
      const target = decodeURIComponent(href.split(/[?#]/, 1)[0]);
      if (!target) continue;
      const destination = resolve(root, dirname(file), target);
      const rel = relative(resolve(root), destination);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
        errors.push(`${file}: ссылка за пределы checkout: ${href}`);
      } else if (!existsSync(destination)) errors.push(`${file}: отсутствует цель ссылки ${href}`);
    } catch {
      errors.push(`${file}: некорректная ссылка ${href}`);
    }
  }
  return errors;
}

function inputs(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const contract = JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8'));
  const errors = validateReleaseContract(contract);
  if (errors.length === 0) errors.push(...validatePackageProjection(pkg, contract));
  return { pkg, contract, errors };
}

export function auditRepo(root = ROOT) {
  const { pkg, contract, errors } = inputs(root);
  if (errors.length) return { errors, files: [] };
  errors.push(...sessionHandoffErrors(root));
  const reference = join(root, 'docs/package.md');
  if (!existsSync(reference)) errors.push('отсутствует docs/package.md');
  else errors.push(...packageReferenceErrors(readFileSync(reference, 'utf8'), pkg, contract));
  for (const claim of findInkHexClaims(readFileSync(join(root, 'README.md'), 'utf8'))) {
    errors.push(`README.md: фиксированные чернила «${claim}» противоречат currentColor`);
  }
  const files = documentationFiles(root);
  for (const file of files) {
    errors.push(...documentationLinkErrors(root, file, readFileSync(join(root, file), 'utf8')));
    for (const error of distributionClaimErrors(readFileSync(join(root, file), 'utf8'))) {
      errors.push(`${file}: ${error}`);
    }
  }
  return { errors, files };
}

export function writePackageReference(root = ROOT) {
  const { pkg, contract, errors } = inputs(root);
  if (errors.length) throw new Error(errors.join('\n'));
  const target = join(root, 'docs/package.md');
  const temporary = mkdtempSync(join(dirname(target), '.package-reference-'));
  try {
    const file = join(temporary, 'package.md');
    writeFileSync(file, renderPackageReference(pkg, contract), { encoding: 'utf8', flag: 'wx' });
    renameSync(file, target);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && !['--check', '--write'].includes(args[0]))) {
      throw new Error('использование: node scripts/check-docs-drift.js [--check|--write]');
    }
    if (args[0] === '--write') writePackageReference();
    const { errors, files } = auditRepo();
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`check-docs-drift: PASS — проекция поставки актуальна; файловые ссылки и известные противоречия проверены в ${files.length} документах`);
  } catch (error) {
    console.error(`check-docs-drift: FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}
