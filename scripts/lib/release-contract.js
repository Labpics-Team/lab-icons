import { isDeepStrictEqual } from 'node:util';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROOT_KEYS = ['exports', 'fallback', 'files', 'packageName', 'primary', 'version'];
const PRIMARY_KEYS = ['access', 'install', 'kind'];
const FALLBACK_KEYS = ['immutable', 'kind', 'specifier'];
const EXPORT_KEYS = ['.', './ir', './ir/recipes'];
const EXPORT_CONDITIONS = Object.freeze({
  '.': ['types', 'import'],
  './ir': ['types', 'import'],
  './ir/recipes': ['types', 'import'],
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
  if (contract.version !== 3) {
    errors.push(`release contract version обязан быть 3; найдено ${String(contract.version)}`);
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
    for (const file of files) {
      if (!referenced.has(file)) errors.push(`release file не достижим ни из одного export: ${file}`);
    }
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
