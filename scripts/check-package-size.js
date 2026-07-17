#!/usr/bin/env node
/** Size + inclusion ratchet for independently consumable lightweight entries. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGE_SIZE_MEASUREMENT = 'node:zlib gzipSync level=9 mtime=0 after pnpm build';

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ROOT_FIELDS = ['artifacts', 'measurement', 'version'];
const REQUIRED_ARTIFACT_FIELDS = [
  'allowedModules',
  'baselineBytes',
  'baselineGzipBytes',
  'forbiddenNeedles',
  'maxBytes',
  'maxGzipBytes',
];
const OPTIONAL_ARTIFACT_FIELDS = ['identicalTo'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, required, optional, where) {
  if (!isRecord(value)) throw new TypeError(`${where} обязан быть объектом`);
  const actual = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = actual.filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      missing.length > 0 ? `отсутствуют [${missing.join(', ')}]` : '',
      unknown.length > 0 ? `неизвестны [${unknown.join(', ')}]` : '',
    ].filter(Boolean).join('; ');
    throw new TypeError(`${where}: ${details}`);
  }
}

function positiveInteger(value, where) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${where} обязан быть целым > 0`);
  }
  return value;
}

function isExactDistFile(value) {
  if (typeof value !== 'string') return false;
  const segments = value.split('/');
  const filename = segments.at(-1) ?? '';
  return segments.length >= 2 && segments[0] === 'dist' &&
    segments.every((segment) => SAFE_SEGMENT.test(segment)) &&
    filename.includes('.') && !filename.endsWith('.');
}

function isExactModuleFile(value) {
  if (typeof value !== 'string') return false;
  const segments = value.split('/');
  return segments.length >= 2 && ['scripts', 'semantics', 'src'].includes(segments[0]) &&
    segments.every((segment) => SAFE_SEGMENT.test(segment));
}

function stringSet(value, where, { allowEmpty, item }) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${where} обязан быть ${allowEmpty ? '' : 'непустым '}массивом строк`);
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.length === 0 || !item(entry))) {
    throw new TypeError(`${where} содержит невалидное значение`);
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError(`${where} содержит дубликаты`);
  }
  return Object.freeze([...value]);
}

/**
 * Единственная parse-граница size policy. После неё отсутствующее ограничение
 * нельзя неявно превратить в `undefined`, пустой allowlist или пустой denylist.
 */
export function parsePackageSizeRatchet(value) {
  assertExactKeys(value, ROOT_FIELDS, [], 'package size ratchet');
  if (value.version !== 1) {
    throw new TypeError(`package size ratchet.version обязан быть 1; найдено ${String(value.version)}`);
  }
  if (value.measurement !== PACKAGE_SIZE_MEASUREMENT) {
    throw new TypeError(
      `package size ratchet.measurement обязан быть «${PACKAGE_SIZE_MEASUREMENT}»`,
    );
  }
  if (!isRecord(value.artifacts) || Object.keys(value.artifacts).length === 0) {
    throw new TypeError('package size ratchet.artifacts обязан быть непустым объектом');
  }

  const artifacts = {};
  for (const [file, limits] of Object.entries(value.artifacts)) {
    if (!isExactDistFile(file)) {
      throw new TypeError(`package size ratchet.artifacts содержит не точный dist-файл: ${file}`);
    }
    const where = `package size ratchet.artifacts.${file}`;
    assertExactKeys(limits, REQUIRED_ARTIFACT_FIELDS, OPTIONAL_ARTIFACT_FIELDS, where);
    const baselineBytes = positiveInteger(limits.baselineBytes, `${where}.baselineBytes`);
    const baselineGzipBytes = positiveInteger(
      limits.baselineGzipBytes,
      `${where}.baselineGzipBytes`,
    );
    const maxBytes = positiveInteger(limits.maxBytes, `${where}.maxBytes`);
    const maxGzipBytes = positiveInteger(limits.maxGzipBytes, `${where}.maxGzipBytes`);
    if (maxBytes < baselineBytes) {
      throw new TypeError(`${where}.maxBytes не может быть ниже baselineBytes`);
    }
    if (maxGzipBytes < baselineGzipBytes) {
      throw new TypeError(`${where}.maxGzipBytes не может быть ниже baselineGzipBytes`);
    }
    const allowedModules = stringSet(limits.allowedModules, `${where}.allowedModules`, {
      allowEmpty: true,
      item: isExactModuleFile,
    });
    const forbiddenNeedles = stringSet(limits.forbiddenNeedles, `${where}.forbiddenNeedles`, {
      allowEmpty: false,
      item: () => true,
    });
    let identicalTo;
    if (Object.hasOwn(limits, 'identicalTo')) {
      identicalTo = limits.identicalTo;
      if (!isExactDistFile(identicalTo) || identicalTo === file) {
        throw new TypeError(`${where}.identicalTo обязан указывать на другой точный dist-файл`);
      }
    }
    artifacts[file] = Object.freeze({
      baselineBytes,
      baselineGzipBytes,
      maxBytes,
      maxGzipBytes,
      allowedModules,
      forbiddenNeedles,
      ...(identicalTo === undefined ? {} : { identicalTo }),
    });
  }
  for (const [file, limits] of Object.entries(artifacts)) {
    if (limits.identicalTo && !Object.hasOwn(artifacts, limits.identicalTo)) {
      throw new TypeError(
        `package size ratchet.artifacts.${file}.identicalTo отсутствует в artifacts: ${limits.identicalTo}`,
      );
    }
  }
  return Object.freeze({
    version: 1,
    measurement: PACKAGE_SIZE_MEASUREMENT,
    artifacts: Object.freeze(artifacts),
  });
}

export function measureArtifact(source) {
  // Один source module может появиться в нескольких esbuild sections одного
  // entry. Контракт фиксирует множество включённых модулей, а не внутреннюю
  // раскладку bundler-а и не число его служебных комментариев.
  const modules = [...new Set(
    [...source.toString('utf8').matchAll(/^\/\/ ((?:src|scripts|semantics)\/[^\r\n]+)$/gm)]
      .map((match) => match[1]),
  )].sort();
  return Object.freeze({
    bytes: source.byteLength,
    gzipBytes: gzipSync(source, { level: 9, mtime: 0 }).byteLength,
    modules: Object.freeze(modules),
  });
}

export function checkPackageSize({ root = ROOT } = {}) {
  const errors = [];
  const measurements = {};
  let ratchet;
  try {
    ratchet = parsePackageSizeRatchet(
      JSON.parse(readFileSync(join(root, 'release/package-size-ratchet.json'), 'utf8')),
    );
  } catch (error) {
    return {
      errors: [`release/package-size-ratchet.json невалиден (${error.message})`],
      measurements,
    };
  }
  let releaseFiles = null;
  try {
    const contract = JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8'));
    releaseFiles = Array.isArray(contract.files) ? [...contract.files].sort() : null;
  } catch (error) {
    errors.push(`release/contract.json не читается (${error.message})`);
  }
  const ratchetedFiles = Object.keys(ratchet.artifacts).sort();
  if (!releaseFiles || !isDeepStrictEqual(ratchetedFiles, releaseFiles)) {
    errors.push(
      'package size ratchet обязан покрывать exact release files: ' +
      `release=[${releaseFiles?.join(', ') ?? 'invalid'}], ratchet=[${ratchetedFiles.join(', ')}]`,
    );
  }
  for (const [file, limits] of Object.entries(ratchet.artifacts)) {
    let source;
    try {
      source = readFileSync(join(root, file));
    } catch (error) {
      errors.push(`${file}: output не читается (${error.message})`);
      continue;
    }
    const measured = measureArtifact(source);
    measurements[file] = measured;
    if (measured.bytes !== limits.baselineBytes) {
      errors.push(
        `${file}: ${measured.bytes} B != factual baselineBytes ${limits.baselineBytes} B`,
      );
    }
    if (measured.gzipBytes !== limits.baselineGzipBytes) {
      errors.push(
        `${file}: ${measured.gzipBytes} B gzip != factual baselineGzipBytes ` +
          `${limits.baselineGzipBytes} B gzip`,
      );
    }
    if (measured.bytes > limits.maxBytes) {
      errors.push(`${file}: ${measured.bytes} B > ratchet ${limits.maxBytes} B`);
    }
    if (measured.gzipBytes > limits.maxGzipBytes) {
      errors.push(`${file}: ${measured.gzipBytes} B gzip > ratchet ${limits.maxGzipBytes} B gzip`);
    }
    const expectedModules = [...limits.allowedModules].sort();
    if (JSON.stringify(measured.modules) !== JSON.stringify(expectedModules)) {
      errors.push(
        `${file}: module inclusion drift; expected [${expectedModules.join(', ')}], ` +
          `actual [${measured.modules.join(', ')}]`,
      );
    }
    const text = source.toString('utf8');
    for (const needle of limits.forbiddenNeedles) {
      if (text.includes(needle)) errors.push(`${file}: bundle содержит запрещённый marker ${needle}`);
    }
    if (limits.identicalTo) {
      let counterpart;
      try {
        counterpart = readFileSync(join(root, limits.identicalTo));
      } catch (error) {
        errors.push(`${file}: identicalTo ${limits.identicalTo} не читается (${error.message})`);
      }
      if (counterpart && !source.equals(counterpart)) {
        errors.push(`${file}: обязан быть byte-identical ${limits.identicalTo}`);
      }
    }
  }
  return { errors, measurements };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = checkPackageSize();
  if (result.errors.length > 0) {
    console.error(`check-package-size: HARD — ${result.errors.length} нарушений:`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const report = Object.entries(result.measurements)
    .map(([file, value]) => `${file}: ${value.bytes} B / ${value.gzipBytes} B gzip`)
    .join('; ');
  console.log(`check-package-size: OK — ${report}`);
}
