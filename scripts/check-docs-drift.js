#!/usr/bin/env node
/** Проверяет проекцию поставки и известные противоречия каналам установки. */
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Авторская русская/английская проза не хранит точный размер корпуса.
 * Числовая грамматика намеренно шире текущих значений: арабская запись,
 * стандартные cardinal number words, их падежные формы для обычных count claims
 * и масштабные слова. Мы не пытаемся решить NLP-задачу; вместо этого запрещаем
 * поддерживаемые точные количественные конструкции рядом с защищаемой единицей.
 * Исторические эксперименты не входят в текущую пользовательскую справку.
 */
export function manualCorpusCountErrors(source) {
  const text = normalizeDistributionText(source);
  const ru = [
    'ноль', 'нуль',
    'один', 'одна', 'одно', 'одну', 'одного', 'одной',
    'два', 'две', 'двух', 'три', 'трех', 'трёх', 'четыре', 'четырех', 'четырёх',
    'пять', 'пяти', 'шесть', 'шести', 'семь', 'семи', 'восемь', 'восьми', 'девять', 'девяти',
    'десять', 'десяти', 'одиннадцать', 'одиннадцати', 'двенадцать', 'двенадцати',
    'тринадцать', 'тринадцати', 'четырнадцать', 'четырнадцати', 'пятнадцать', 'пятнадцати',
    'шестнадцать', 'шестнадцати', 'семнадцать', 'семнадцати', 'восемнадцать', 'восемнадцати',
    'девятнадцать', 'девятнадцати', 'двадцать', 'двадцати', 'тридцать', 'тридцати',
    'сорок', 'сорока', 'пятьдесят', 'пятидесяти', 'шестьдесят', 'шестидесяти',
    'семьдесят', 'семидесяти', 'восемьдесят', 'восьмидесяти', 'девяносто', 'девяноста',
    'сто', 'ста', 'двести', 'двухсот', 'триста', 'трехсот', 'трёхсот', 'четыреста', 'четырехсот', 'четырёхсот',
    'пятьсот', 'пятисот', 'шестьсот', 'шестисот', 'семьсот', 'семисот', 'восемьсот', 'восьмисот', 'девятьсот', 'девятисот',
    'тысяча', 'тысячи', 'тысяч', 'миллион', 'миллиона', 'миллионов',
    'миллиард', 'миллиарда', 'миллиардов', 'триллион', 'триллиона', 'триллионов',
    'квадриллион', 'квадриллиона', 'квадриллионов', 'дюжина', 'дюжины', 'дюжин',
  ];
  const en = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
    'hundred', 'hundreds', 'thousand', 'thousands', 'million', 'millions',
    'billion', 'billions', 'trillion', 'trillions', 'quadrillion', 'quadrillions', 'dozen', 'dozens',
  ];
  const word = `(?:${[...ru, ...en].join('|')})`;
  const connector = '(?:and|и)';
  const words = `${word}(?:[\\s-]+(?:${word}|${connector})){0,12}`;
  const number = `(?:\\d+(?:[.,]\\d+)?|${words})`;
  const unit = '(?:икон(?:ка|ки|ок|ку)|имён|имени|имен|SVG|глиф(?:а|ов)?|(?:именованных\\s+)?(?:ESM[- ]?)?экспорт(?:а|ов)?|(?:release[- ]?)?файл(?:а|ов)?|icons?|glyphs?|exports?|files?)';
  const patterns = [
    new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${number}\\s+${unit})(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
    new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${unit}\\s*[:=]\\s*${number})(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
  ];
  return [...new Set(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1])))]
    .map((claim) => `ручной счётчик «${claim}»: используйте ссылку на контракт или генерируемую справку`);
}

/** Рекурсивный обход авторской Markdown-документации; экспериментальные данные не входят. */
export function documentationFiles(root) {
  const docs = lstatSync(join(root, 'docs'));
  if (docs.isSymbolicLink() || !docs.isDirectory()) {
    throw new Error('docs должен быть обычным каталогом, не symlink');
  }
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!/\.md$/i.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`документация не должна уходить за checkout через symlink: ${entry.name}`);
    if (entry.isFile()) files.push(entry.name);
  }
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

function outsideRoot(root, destination) {
  const rel = relative(realpathSync(root), realpathSync(destination));
  return isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`);
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
      const lexicalRel = relative(resolve(root), destination);
      if (isAbsolute(lexicalRel) || lexicalRel === '..' || lexicalRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
        errors.push(`${file}: ссылка за пределы checkout: ${href}`);
      } else if (!existsSync(destination)) {
        errors.push(`${file}: отсутствует цель ссылки ${href}`);
      } else if (outsideRoot(root, destination)) {
        errors.push(`${file}: цель ссылки через symlink находится за пределами checkout: ${href}`);
      }
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
  const files = documentationFiles(root);
  const { pkg, contract, errors } = inputs(root);
  if (errors.length) return { errors, files: [] };
  errors.push(...sessionHandoffErrors(root));
  const reference = join(root, 'docs/package.md');
  if (!existsSync(reference)) errors.push('отсутствует docs/package.md');
  else errors.push(...packageReferenceErrors(readFileSync(reference, 'utf8'), pkg, contract));
  for (const claim of findInkHexClaims(readFileSync(join(root, 'README.md'), 'utf8'))) {
    errors.push(`README.md: фиксированные чернила «${claim}» противоречат currentColor`);
  }
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    errors.push(...documentationLinkErrors(root, file, source));
    if (file.replaceAll('\\', '/') !== 'docs/package.md') {
      errors.push(...manualCorpusCountErrors(source).map((error) => `${file}: ${error}`));
    }
    for (const error of distributionClaimErrors(source)) {
      errors.push(`${file}: ${error}`);
    }
  }
  return { errors, files };
}

export function writePackageReference(root = ROOT) {
  // Та же проверка путей выполняется до чтения справки и любых операций записи.
  // Checkout не должен одновременно изменяться другим процессом: это не sandbox.
  documentationFiles(root);
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
