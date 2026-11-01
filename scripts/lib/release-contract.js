import { isDeepStrictEqual } from 'node:util';
import { posix } from 'node:path';
import { buildSync } from 'esbuild';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROOT_KEYS = [
  'exports',
  'fallback',
  'files',
  'packageName',
  'primary',
  'runtimeDependencies',
  'typeDependencies',
  'version',
];
const PRIMARY_KEYS = ['access', 'install', 'kind'];
const FALLBACK_KEYS = ['immutable', 'kind', 'specifier'];
const EXPORT_KEYS = ['.', './ir', './ir/candidates', './ir/recipes', './ir/render', './motion', './symbols/*', './lottie/*'];
const EXPORT_CONDITIONS = Object.freeze({
  '.': ['types', 'import'],
  './ir': ['types', 'import'],
  // INV-06: candidate-корпус — отдельный opt-in субпат, не default-поставка.
  './ir/candidates': ['types', 'import'],
  './ir/recipes': ['types', 'import'],
  './ir/render': ['types', 'import'],
  './motion': ['types', 'import'],
  './symbols/*': ['types', 'import'],
  './lottie/*': ['types', 'import'],
});
export const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExactDistFile(value) {
  if (typeof value !== 'string') return false;
  const segments = value.split('/');
  const filename = segments.at(-1) ?? '';
  return segments.length >= 2 && segments[0] === 'dist' &&
    segments.every((segment) => SAFE_SEGMENT.test(segment) && segment !== '..') &&
    filename.includes('.') && !filename.endsWith('.');
}

function validateExactKeys(value, expected, label, errors) {
  if (!isRecord(value)) {
    errors.push(`${label} обязан быть объектом`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (!isDeepStrictEqual(actual, canonical)) {
    errors.push(`${label} имеет неканонические ключи: [${actual.join(', ')}]`);
    return false;
  }
  return true;
}

function validateOrderedKeys(value, expected, label, errors) {
  if (!validateExactKeys(value, expected, label, errors)) return false;
  const actual = Object.keys(value);
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(`${label} имеет опасный порядок conditions: [${actual.join(', ')}]`);
    return false;
  }
  return true;
}

function validateExportTarget({ target, label, suffix, files, referenced, errors }) {
  if (typeof target !== 'string' || !target.startsWith('./dist/')) {
    errors.push(`${label} указывает вне ./dist`);
    return;
  }
  const file = target.slice(2);
  if (!files.has(file)) errors.push(`${label} отсутствует в release files: ${target}`);
  else referenced.add(file);
  if (!target.endsWith(suffix)) errors.push(`${label} обязан указывать на ${suffix}`);
}

/**
 * Контракт принимает только физические файлы. Directory entries и glob-ы
 * делают allowlist открытым и возвращают stale-файлы в tarball.
 */
export function validateReleaseContract(contract) {
  const errors = [];
  if (!isRecord(contract)) return ['release/contract.json обязан быть объектом'];
  validateExactKeys(contract, ROOT_KEYS, 'release contract', errors);
  if (contract.version !== 5) {
    errors.push(`release contract version обязан быть 5; найдено ${String(contract.version)}`);
  }
  if (contract.packageName !== '@labpics/icons') {
    errors.push(`release packageName изменён: ${String(contract.packageName)}`);
  }
  if (validateExactKeys(contract.primary, PRIMARY_KEYS, 'release primary', errors)) {
    if (
      contract.primary.kind !== 'npm' ||
      contract.primary.access !== 'public' ||
      contract.primary.install !== 'pnpm add @labpics/icons'
    ) {
      errors.push('release primary не равен каноническому public npm channel');
    }
  }
  if (validateExactKeys(contract.fallback, FALLBACK_KEYS, 'release fallback', errors)) {
    if (
      contract.fallback.kind !== 'github-dist-tag' ||
      contract.fallback.specifier !== 'github:Labpics-Team/lab-icons#vX.Y.Z-dist' ||
      contract.fallback.immutable !== true
    ) {
      errors.push('release fallback не равен каноническому immutable github-dist-tag channel');
    }
  }
  if (!Array.isArray(contract.files) || contract.files.length === 0) {
    errors.push('release files обязан быть непустым массивом точных файлов');
  } else {
    const unique = new Set(contract.files);
    if (unique.size !== contract.files.length) errors.push('release files содержит дубликаты');
    const sorted = [...contract.files].sort();
    if (!isDeepStrictEqual(contract.files, sorted)) {
      errors.push('release files обязан быть лексикографически отсортирован');
    }
    for (const file of contract.files) {
      if (!isExactDistFile(file)) {
        errors.push(`release files содержит не точный dist-файл: ${String(file)}`);
        continue;
      }
      if (file.endsWith('.map')) errors.push(`sourcemap запрещён в release manifest: ${file}`);
    }
  }

  const typeDependencies = new Set();
  if (!Array.isArray(contract.typeDependencies)) {
    errors.push('release typeDependencies обязан быть массивом точных .d.ts файлов');
  } else {
    if (new Set(contract.typeDependencies).size !== contract.typeDependencies.length) {
      errors.push('release typeDependencies содержит дубликаты');
    }
    const sorted = [...contract.typeDependencies].sort();
    if (!isDeepStrictEqual(contract.typeDependencies, sorted)) {
      errors.push('release typeDependencies обязан быть лексикографически отсортирован');
    }
    const files = new Set(Array.isArray(contract.files) ? contract.files : []);
    for (const file of contract.typeDependencies) {
      if (!isExactDistFile(file) || !file.endsWith('.d.ts')) {
        errors.push(`release typeDependencies содержит не точный .d.ts файл: ${String(file)}`);
      } else if (!files.has(file)) {
        errors.push(`release typeDependency отсутствует в release files: ${file}`);
      } else {
        typeDependencies.add(file);
      }
    }
  }

  const runtimeDependencies = new Set();
  if (!Array.isArray(contract.runtimeDependencies)) {
    errors.push('release runtimeDependencies обязан быть массивом точных .js файлов');
  } else {
    if (new Set(contract.runtimeDependencies).size !== contract.runtimeDependencies.length ||
        !isDeepStrictEqual(contract.runtimeDependencies, [...contract.runtimeDependencies].sort())) {
      errors.push('release runtimeDependencies обязан быть отсортирован без дубликатов');
    }
    const files = new Set(Array.isArray(contract.files) ? contract.files : []);
    for (const file of contract.runtimeDependencies) {
      if (!isExactDistFile(file) || !file.endsWith('.js')) {
        errors.push(`release runtimeDependencies содержит не точный .js файл: ${String(file)}`);
      } else if (!files.has(file)) {
        errors.push(`release runtimeDependency отсутствует в release files: ${file}`);
      } else runtimeDependencies.add(file);
    }
  }

  if (validateExactKeys(contract.exports, EXPORT_KEYS, 'release exports', errors)) {
    const files = new Set(Array.isArray(contract.files) ? contract.files : []);
    const referenced = new Set();
    for (const [subpath, conditions] of Object.entries(contract.exports)) {
      if (!validateOrderedKeys(
        conditions,
        EXPORT_CONDITIONS[subpath] ?? [],
        `release export ${subpath}`,
        errors,
      )) {
        continue;
      }
      if (subpath === './symbols/*' || subpath === './lottie/*') {
        const directory = subpath.slice(2, -2);
        if (conditions.types !== `./dist/${directory}/*.d.ts` || conditions.import !== `./dist/${directory}/*.js`) {
          errors.push(`release ${directory} wildcard обязан указывать только на dist/${directory}/<name>`);
        }
        continue;
      }
      for (const [condition, target] of Object.entries(conditions)) {
        validateExportTarget({
          target,
          label: `release export ${subpath}.${condition}`,
          suffix: condition === 'types' ? '.d.ts' : '.js',
          files,
          referenced,
          errors,
        });
      }
    }
    const expanded = expandReleaseExports(contract);
    const symbols = Object.entries(expanded).filter(([subpath]) => subpath.startsWith('./symbols/') || subpath.startsWith('./lottie/'));
    if (symbols.length === 0) errors.push('release symbols wildcard не имеет точных symbol outputs');
    for (const [subpath, conditions] of symbols) {
      for (const [condition, target] of Object.entries(conditions)) validateExportTarget({
        target, label: `release export ${subpath}.${condition}`,
        suffix: condition === 'types' ? '.d.ts' : '.js', files, referenced, errors,
      });
    }
    for (const file of files) {
      if (!referenced.has(file) && !typeDependencies.has(file) && !runtimeDependencies.has(file)) {
        errors.push(`release file не достижим из export или dependency: ${file}`);
      }
    }
    for (const file of runtimeDependencies) {
      if (referenced.has(file)) errors.push(`release runtimeDependency уже является export target: ${file}`);
    }
    for (const file of typeDependencies) {
      if (referenced.has(file)) {
        errors.push(`release typeDependency обязан быть транзитивным, но уже является export target: ${file}`);
      }
    }
  }
  return errors;
}

/** Node subpath pattern раскрывается только в exact allowlist уже объявленных файлов. */
export function expandReleaseExports(contract) {
  const result = {};
  for (const [subpath, conditions] of Object.entries(contract?.exports ?? {})) {
    if (!subpath.includes('*')) { result[subpath] = conditions; continue; }
    if (!['./symbols/*', './lottie/*'].includes(subpath)) continue;
    const directory = subpath.slice(2, -2);
    if (conditions?.import !== `./dist/${directory}/*.js`) continue;
    for (const file of contract.files ?? []) {
      const match = new RegExp(`^dist/${directory}/([a-z][a-z0-9-]*)\\.js$`).exec(file);
      if (!match) continue;
      const name = match[1];
      result[`./${directory}/${name}`] = {
        types: typeof conditions.types === 'string' ? conditions.types.replace('*', name) : conditions.types,
        import: conditions.import.replace('*', name),
      };
    }
  }
  return result;
}

function declarationTarget(fromFile, specifier) {
  const resolved = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  if (!resolved.startsWith('dist/')) return null;
  if (/\.(?:m|c)?js$/.test(resolved)) return resolved.replace(/\.(?:m|c)?js$/, '.d.ts');
  if (resolved.endsWith('.d.ts')) return resolved;
  return `${resolved}.d.ts`;
}

function declarationTokens(source) {
  const tokens = [];
  const errors = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '/') {
      const end = source.indexOf('\n', index + 2);
      index = end < 0 ? source.length : end + 1;
      continue;
    }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) {
        errors.push('незакрытый block comment');
        break;
      }
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      let value = '';
      let escaped = false;
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          escaped = true;
          index += 2;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (index >= source.length) {
        errors.push(`незакрытый string literal на offset ${start}`);
        break;
      }
      index += 1;
      tokens.push({ kind: 'string', value, escaped, offset: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1;
      tokens.push({ kind: 'identifier', value: source.slice(start, index), offset: start });
      continue;
    }
    tokens.push({ kind: 'punctuator', value: char, offset: index });
    index += 1;
  }
  return { tokens, errors };
}

/**
 * Минимальный lexer деклараций, а не regex по произвольному тексту.
 *
 * Он различает код, строки и комментарии и закрывает все module-reference
 * формы, которые способен эмитить TypeScript: `from`, side-effect import,
 * import-type и `require()`. Escape в module specifier запрещён: канонический
 * build никогда его не создаёт, а молча декодировать неоднозначный путь в
 * supply-chain gate опаснее явного отказа.
 */
export function declarationModuleSpecifiers(source) {
  if (typeof source !== 'string') {
    return { specifiers: [], errors: ['declaration source обязан быть строкой'] };
  }
  const references = [...source.matchAll(
    /^\s*\/\/\/\s*<reference\s+(?:path|types)\s*=\s*["']([^"']+)["'][^>]*>/gm,
  )].map((match) => match[1]);
  const { tokens, errors } = declarationTokens(source);
  const found = [...references];
  const addString = (token) => {
    if (!token || token.kind !== 'string') return false;
    if (token.escaped) {
      errors.push(`escaped module specifier запрещён на offset ${token.offset}`);
      return true;
    }
    found.push(token.value);
    return true;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind !== 'identifier') continue;
    if (token.value === 'from') {
      addString(tokens[index + 1]);
      continue;
    }
    if (token.value === 'import') {
      if (addString(tokens[index + 1])) continue;
      if (tokens[index + 1]?.value === '(') addString(tokens[index + 2]);
      continue;
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '(') {
      addString(tokens[index + 2]);
    }
  }

  return {
    specifiers: [...new Set(found)],
    errors,
  };
}

/**
 * Доказывает, что auxiliary declarations — точная транзитивная closure
 * публичных type entrypoints. Само перечисление в manifest не должно уметь
 * легализовать orphan .d.ts.
 */
export function validateReleaseTypeDependencyGraph({ contract, readText }) {
  const errors = [];
  const files = new Set(Array.isArray(contract?.files) ? contract.files : []);
  const declared = new Set(
    Array.isArray(contract?.typeDependencies) ? contract.typeDependencies : [],
  );
  const entrypoints = new Set();
  for (const value of Object.values(expandReleaseExports(contract))) {
    const target = value?.types;
    if (typeof target === 'string' && target.startsWith('./')) entrypoints.add(target.slice(2));
  }

  const reached = new Set();
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    let source;
    try {
      source = readText(file);
    } catch (error) {
      errors.push(`release declaration graph: ${file} не читается (${error.message})`);
      continue;
    }
    const parsed = declarationModuleSpecifiers(source);
    for (const error of parsed.errors) {
      errors.push(`release declaration graph: ${file}: ${error}`);
    }
    const specifiers = parsed.specifiers;
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) {
        errors.push(
          `release declaration graph: ${file} содержит внешнюю type-зависимость ${specifier}`,
        );
        continue;
      }
      const target = declarationTarget(file, specifier);
      if (!target) {
        errors.push(`release declaration graph: ${file} выходит за dist через ${specifier}`);
        continue;
      }
      if (!files.has(target)) {
        errors.push(`release declaration graph: ${file} импортирует отсутствующий ${target}`);
        continue;
      }
      if (!reached.has(target)) queue.push(target);
    }
  }

  const actual = [...reached].filter((file) => !entrypoints.has(file)).sort();
  const expected = [...declared].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    errors.push(
      `release typeDependencies не равен import closure: ` +
        `declared [${expected.join(', ')}], actual [${actual.join(', ')}]`,
    );
  }
  return errors;
}

/** Parser закреплённого esbuild видит imports и в template expressions. */
export function runtimeModuleSpecifiers(source) {
  if (typeof source !== 'string') return { specifiers: [], errors: ['runtime source обязан быть строкой'] };
  let built;
  try {
    built = buildSync({
      stdin: { contents: source, loader: 'js' },
      bundle: false, write: false, metafile: true, format: 'esm',
      treeShaking: false, supported: { 'template-literal': false }, logLevel: 'silent',
    });
  } catch (error) {
    return { specifiers: [], errors: [`runtime module не разбирается (${error.message})`] };
  }
  const output = Object.values(built.metafile.outputs)[0];
  const errors = [];
  const { tokens } = declarationTokens(built.outputFiles[0].text);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].kind === 'identifier' && tokens[index].value === 'import' &&
        tokens[index + 1]?.value === '(' && tokens[index - 1]?.value !== '.') {
      let closing = index + 1;
      let depth = 0;
      for (; closing < tokens.length; closing++) {
        if (tokens[closing].value === '(') depth++;
        if (tokens[closing].value === ')' && --depth === 0) break;
      }
      // Метод с именем import — обычный JS-идентификатор, не module load.
      if (tokens[closing + 1]?.value === '{') continue;
      if (tokens[index + 2]?.kind !== 'string' || ![',', ')'].includes(tokens[index + 3]?.value)) {
        errors.push('runtime module имеет неразрешимый dynamic import');
      }
    }
  }
  return { specifiers: [...new Set((output.imports ?? []).map(entry => entry.path))], errors };
}

/** Private compiler-файл разрешён только как доказанная closure публичных imports. */
export function validateReleaseRuntimeDependencyGraph({ contract, readText }) {
  const errors = [];
  const files = new Set(contract?.files ?? []);
  const entrypoints = new Set(Object.values(expandReleaseExports(contract))
    .map(conditions => conditions?.import)
    .filter(target => typeof target === 'string' && target.startsWith('./'))
    .map(target => target.slice(2)));
  const reached = new Set();
  const queue = [...entrypoints];
  while (queue.length) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    let parsed;
    try { parsed = runtimeModuleSpecifiers(readText(file)); }
    catch (error) { errors.push(`release runtime graph: ${file} не читается (${error.message})`); continue; }
    for (const error of parsed.errors) errors.push(`release runtime graph: ${file}: ${error}`);
    for (const specifier of parsed.specifiers) {
      let target;
      if (specifier === contract.packageName) target = contract.exports['.'].import.slice(2);
      else if (specifier.startsWith('.')) target = posix.normalize(posix.join(posix.dirname(file), specifier));
      else {
        errors.push(`release runtime graph: ${file} содержит внешнюю runtime-зависимость ${specifier}`);
        continue;
      }
      if (!target.startsWith('dist/') || !target.endsWith('.js') || !files.has(target)) {
        errors.push(`release runtime graph: ${file} импортирует отсутствующий или внешний ${target}`);
        continue;
      }
      if (!reached.has(target)) queue.push(target);
    }
  }
  const actual = [...reached].filter(file => !entrypoints.has(file)).sort();
  const declared = [...(contract?.runtimeDependencies ?? [])].sort();
  if (!isDeepStrictEqual(actual, declared)) {
    errors.push(`release runtimeDependencies не равен import closure: declared [${declared.join(', ')}], actual [${actual.join(', ')}]`);
  }
  return errors;
}

/** package.json — npm-проекция канона, но не второй источник истины. */
export function validatePackageProjection(pkg, contract) {
  const errors = [];
  if (pkg?.name !== contract?.packageName) {
    errors.push('package.json#name дрейфует от release contract');
  }
  if (!isDeepStrictEqual(pkg?.files, contract?.files)) {
    errors.push('package.json#files дрейфует от release contract');
  }
  // Conditional exports зависят от порядка ключей (`types` до `default`),
  // поэтому обычного структурного deep-equal недостаточно.
  if (JSON.stringify(pkg?.exports) !== JSON.stringify(contract?.exports)) {
    errors.push('package.json#exports дрейфует от release contract');
  }
  if (pkg?.publishConfig?.access !== contract?.primary?.access) {
    errors.push('package.json#publishConfig.access дрейфует от release contract');
  }
  if (pkg?.private !== false) {
    errors.push('package.json#private обязан быть false для public npm channel');
  }
  if (typeof pkg?.version !== 'string' || !STRICT_SEMVER.test(pkg.version)) {
    errors.push(`package.json#version обязан быть строгим SemVer; найдено ${String(pkg?.version)}`);
  }
  const root = contract?.exports?.['.'];
  if (pkg?.main !== root?.import || pkg?.module !== root?.import || pkg?.types !== root?.types) {
    errors.push('package.json main/module/types дрейфуют от root release export');
  }
  return errors;
}

/** npm всегда добавляет эти metadata-файлы сверх package.json#files. */
export function installedAllowlist(contract) {
  const files = Array.isArray(contract?.files) ? contract.files : [];
  return Object.freeze([
    'LICENSE',
    'README.md',
    ...files,
    'package.json',
  ].sort());
}
