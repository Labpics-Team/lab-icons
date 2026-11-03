#!/usr/bin/env node
/** Проверяет проекцию поставки и известные противоречия каналам установки. */
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validatePackageProjection, validateReleaseContract } from './lib/release-contract.js';
import { packageReferenceErrors, renderPackageReference } from './lib/docs-reference.js';

import { parseDocumentation } from './lib/docs-markdown.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function normalizeDistributionText(text, { preserveBlocks = false, maskVersionIdentifiers = false } = {}) {
  // Перенос строки внутри абзаца остаётся пробелом; границу блока задаёт parser.
  const separator = '\u2029';
  const blocks = parseDocumentation(text, { blockSeparator: separator, maskVersionIdentifiers }).text.split(separator);
  return blocks.map(block => block.normalize('NFKC')
    .replace(/[‐‑‒–—―]/g, '-').replace(/\s+/g, ' ').trim())
    .filter(Boolean).join(preserveBlocks ? '\n' : ' ');
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
 * Исторический счётчик требует даты или baseline SHA в том же утверждении.
 * Каталог документа не освобождает текущие утверждения от проверки.
 */
export function manualCorpusCountErrors(source) {
  // Помеченный code literal версии — identity источника, не размер корпуса.
  // Обычные числовые code literals рядом с SVG/файлами остаются count claims.
  // marked кодирует > в ASCII-стрелке; entity не задаёт границу утверждения.
  const sentences = normalizeDistributionText(source, { preserveBlocks: true, maskVersionIdentifiers: true })
    .replaceAll('-&gt;', '->').split(/\n|;|[.!?]\s+/u);
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
  // SVG-строка называет представление значения, а не элемент census.
  // Частичное совпадение SVG внутри такого типа давало ложный corpus claim.
  const svgUnit = 'SVG(?![-\\s]+(?:строк[\\p{L}]*|strings?)(?=$|[^\\p{L}\\p{N}_]))';
  const unit = `(?:икон(?:ка|ки|ок|ку)|имён|имени|имен|${svgUnit}|глиф(?:а|ов)?|(?:именованных\\s+)?(?:ESM[- ]?)?экспорт(?:а|ов)?|(?:release[- ]?)?файл(?:а|ов)?|icons?|glyphs?|exports?|files?)`;
  const patterns = [
    new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${number}\\s+${unit})(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
    new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${unit}\\s*[:=]\\s*${number})(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
  ];
  const currentMarker = /(?:текущ[\p{L}]*|сейчас|сегодня|теперь|ныне|настоящ[\p{L}]*\s+врем[\p{L}]*|\bcurrent(?:ly)?\b|\btoday\b|\bnow\b)/iu;
  // Противопоставленная фраза получает собственный anchor. Однородное
  // перечисление count claims продолжает датированное утверждение.
  const countStart = `${number}\\s+${unit}(?=$|[^\\p{L}\\p{N}_])`;
  const clauseSeparator = new RegExp(`,\\s*(?=(?:(?:а|но|but|whereas)\\s+(?!${countStart})|(?:(?:в|на|in|at)\\s+)?${currentMarker.source}))`, 'iu');
  const clauses = sentences.flatMap(sentence => sentence.split(clauseSeparator));
  const singularFileValue = /^(?:(?:release[- ]?)?файл(?:а)?|file)\s*[:=]/iu;
  // Свойство заканчивается у конкретного файла. Одно определение допускает имя
  // артефакта; признак соседнего счётчика, предложения или блока не переносится.
  const filePropertyContext = /(?:^|[^\p{L}\p{N}_])(?:(?:размер|длина)(?:\s+[\p{L}\p{N}_.\/-]+)?|(?:size|length)\s+of(?:\s+(?:this|the))?|baseline\s+(?:поля\s+этого|fields?\s+of\s+(?:this|the)))\s+$/iu;
  const byteUnit = '(?:B|bytes?|байт(?:а|ов)?)';
  const rangeTail = `(?:\\s*(?:→|->)\\s*${number})*`;
  const byteEncoding = '(?:\\s+(?:raw|gzip|brotli))?';
  const measuredBytes = `${number}${rangeTail}\\s+${byteUnit}${byteEncoding}`;
  const byteValueTail = new RegExp(`^${rangeTail}\\s+${byteUnit}${byteEncoding}(?:\\s+(?:и|and)\\s+${measuredBytes})*(?=$|\\s*[,.)!?])`, 'iu');
  function artifactSizeProperty(match, text) {
    const end = match.index + match[0].length;
    const start = end - match[1].length;
    // Английская конструкция начинается с file внутри release-file;
    // определение release относится к этому артефакту, не к его свойству.
    const propertyPrefix = text.slice(0, start).replace(/\brelease[- ]$/iu, '');
    // Байтовая единица сама бывает определением. Исключение требует одновременно
    // явного свойства файла и законченной величины, а не только суффикса B.
    return singularFileValue.test(match[1]) && filePropertyContext.test(propertyPrefix) &&
      byteValueTail.test(text.slice(end));
  }
  function nodeIdentifier(match, text) {
    return /:\s*\d+$/.test(match[1]) &&
      /^:\d+(?=$|[^\p{L}\p{N}_:])/u.test(text.slice(match.index + match[0].length));
  }
  function historical(sentence) {
    // Датированное «в текущем пакете» всё ещё проецирует текущую поставку.
    if (currentMarker.test(sentence)) return false;
    return /(?:на|as of)\s+\d{4}-\d{2}-\d{2}(?=$|[^\d])|(?:baseline commit|на baseline)\s+[a-f\d]{7,40}(?=$|[^a-f\d])/iu.test(sentence);
  }
  return [...new Set(clauses.flatMap(sentence => historical(sentence) ? [] :
    patterns.flatMap(pattern => [...sentence.matchAll(pattern)]
      .filter(match => !nodeIdentifier(match, sentence) && !artifactSizeProperty(match, sentence)).map(match => match[1]))))]
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
    const normalizedPath = file.replaceAll('\\', '/');
    if (normalizedPath !== 'docs/package.md') {
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
