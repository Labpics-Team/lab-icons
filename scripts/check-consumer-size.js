#!/usr/bin/env node
/**
 * Consumer-size ratchet: держит цену пакета в бандле потребителя, а не байты
 * dist-артефактов (это check-package-size). Каждый сценарий — реальный import
 * потребителя, собранный esbuild-ом так, как его соберёт прод-бандлер:
 * tree-shake обязан работать, рост baseline виден в обе стороны.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { gzipSync } from 'fflate';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const PINNED_VERSION = /^\d+\.\d+\.\d+$/;

function pinnedVersion(name) {
  const value = PACKAGE_JSON.devDependencies?.[name];
  if (typeof value !== 'string' || !PINNED_VERSION.test(value)) {
    throw new TypeError(
      `package.json#devDependencies.${name} обязан быть точной версией без range`,
    );
  }
  return value;
}

export const CONSUMER_SIZE_MEASUREMENT =
  `esbuild@${pinnedVersion('esbuild')} bundle+minify+treeshake es2022 browser; ` +
  `fflate@${pinnedVersion('fflate')} gzipSync level=9 mtime=0`;

/** Subpath-резолюция как у потребителя опубликованного пакета: exports → dist. */
const ENTRY_ALIAS = Object.freeze({
  '@labpics/icons': 'dist/index.js',
  '@labpics/icons/ir': 'dist/ir/index.js',
  '@labpics/icons/ir/recipes': 'dist/ir/recipes.js',
});

const ROOT_FIELDS = ['version', 'measurement', 'scenarios'];
const SCENARIO_FIELDS = [
  'entry',
  'baselineBytes',
  'baselineGzipBytes',
  'maxBytes',
  'maxGzipBytes',
];
const SCENARIO_NAME = /^[a-z][a-z0-9-]*$/;
const STATIC_PACKAGE_IMPORT = /\bimport\s+(?:[^'";]+?\s+from\s+)?['"](@labpics\/icons(?:\/[^'"]*)?)['"]/g;

function packageImports(entry) {
  return [...entry.matchAll(STATIC_PACKAGE_IMPORT)].map((match) => match[1]);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value, required, where) {
  if (!isRecord(value)) throw new TypeError(`${where} обязан быть объектом`);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !required.includes(key));
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

/** Единственная parse-граница consumer-size policy; fail-closed на дрейф формы. */
export function parseConsumerSizeRatchet(value) {
  assertExactKeys(value, ROOT_FIELDS, 'consumer size ratchet');
  if (value.version !== 1) {
    throw new TypeError(
      `consumer size ratchet.version обязан быть 1; найдено ${String(value.version)}`,
    );
  }
  if (value.measurement !== CONSUMER_SIZE_MEASUREMENT) {
    throw new TypeError(
      `consumer size ratchet.measurement обязан быть «${CONSUMER_SIZE_MEASUREMENT}»`,
    );
  }
  if (!isRecord(value.scenarios) || Object.keys(value.scenarios).length === 0) {
    throw new TypeError('consumer size ratchet.scenarios обязан быть непустым объектом');
  }
  const scenarios = {};
  for (const [name, limits] of Object.entries(value.scenarios)) {
    if (!SCENARIO_NAME.test(name)) {
      throw new TypeError(`consumer size ratchet: невалидное имя сценария «${name}»`);
    }
    const where = `consumer size ratchet.scenarios.${name}`;
    assertExactKeys(limits, SCENARIO_FIELDS, where);
    if (typeof limits.entry !== 'string' || packageImports(limits.entry).length === 0) {
      throw new TypeError(`${where}.entry обязан содержать static import из @labpics/icons`);
    }
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
    scenarios[name] = Object.freeze({
      entry: limits.entry,
      baselineBytes,
      baselineGzipBytes,
      maxBytes,
      maxGzipBytes,
    });
  }
  return Object.freeze({
    version: 1,
    measurement: CONSUMER_SIZE_MEASUREMENT,
    scenarios: Object.freeze(scenarios),
  });
}

export async function bundleScenario(entry, { root = ROOT } = {}) {
  const alias = Object.fromEntries(
    Object.entries(ENTRY_ALIAS).map(([spec, target]) => [spec, join(root, target)]),
  );
  const out = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'js' },
    bundle: true,
    minify: true,
    treeShaking: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    plugins: [{
      name: 'consumer-package-entry',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^@labpics\/icons(?:\/.*)?$/ }, (args) => {
          const path = alias[args.path];
          if (!path) return { errors: [{ text: `неизвестный package subpath ${args.path}` }] };
          return { path, namespace: 'consumer-package-entry' };
        });
        buildApi.onLoad({ filter: /.*/, namespace: 'consumer-package-entry' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'js',
          resolveDir: dirname(args.path),
        }));
      },
    }],
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  const contributedBytes = Object.values(out.metafile.outputs).reduce(
    (sum, output) => sum + Object.entries(output.inputs)
      .filter(([input]) => input.includes('consumer-package-entry:'))
      .reduce((subtotal, [, input]) => subtotal + input.bytesInOutput, 0),
    0,
  );
  if (contributedBytes === 0) {
    throw new Error('package import не внёс байтов в consumer-бандл');
  }
  const bytes = Buffer.from(out.outputFiles[0].contents);
  return Object.freeze({
    bytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).byteLength,
  });
}

export async function checkConsumerSize({ root = ROOT } = {}) {
  const errors = [];
  const measurements = {};
  let ratchet;
  try {
    ratchet = parseConsumerSizeRatchet(
      JSON.parse(readFileSync(join(root, 'release/consumer-size-ratchet.json'), 'utf8')),
    );
  } catch (error) {
    return {
      errors: [`release/consumer-size-ratchet.json невалиден (${error.message})`],
      measurements,
    };
  }
  for (const [name, limits] of Object.entries(ratchet.scenarios)) {
    let measured;
    try {
      measured = await bundleScenario(limits.entry, { root });
    } catch (error) {
      errors.push(`${name}: bundle не собирается (${error.message})`);
      continue;
    }
    measurements[name] = measured;
    if (measured.bytes !== limits.baselineBytes) {
      errors.push(
        `${name}: ${measured.bytes} B != factual baselineBytes ${limits.baselineBytes} B`,
      );
    }
    if (measured.gzipBytes !== limits.baselineGzipBytes) {
      errors.push(
        `${name}: ${measured.gzipBytes} B gzip != factual baselineGzipBytes ` +
          `${limits.baselineGzipBytes} B gzip`,
      );
    }
    if (measured.bytes > limits.maxBytes) {
      errors.push(`${name}: ${measured.bytes} B > ratchet ${limits.maxBytes} B`);
    }
    if (measured.gzipBytes > limits.maxGzipBytes) {
      errors.push(`${name}: ${measured.gzipBytes} B gzip > ratchet ${limits.maxGzipBytes} B gzip`);
    }
  }
  return { errors, measurements };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = await checkConsumerSize();
  if (result.errors.length > 0) {
    console.error(`check-consumer-size: HARD — ${result.errors.length} нарушений:`);
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const report = Object.entries(result.measurements)
    .map(([name, value]) => `${name}: ${value.bytes} B / ${value.gzipBytes} B gzip`)
    .join('; ');
  console.log(`check-consumer-size: OK — ${report}`);
}
