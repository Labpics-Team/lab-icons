#!/usr/bin/env node
/** Запускается на runner после build; --update явно меняет только factual size policy. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { brotliCompressSync, constants } from 'node:zlib';
import { measureArtifact, PACKAGE_SIZE_MEASUREMENT } from './check-package-size.js';
import { bundleScenario, CONSUMER_SIZE_MEASUREMENT } from './check-consumer-size.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const contract = read('release/contract.json');
const previous = read('release/package-size-ratchet.json');
const oldConsumers = read('release/consumer-size-ratchet.json');
const entries = {
  'one-static': oldConsumers.scenarios['one-static'].entry,
  'authored-static': "import { outline } from '@labpics/icons/symbols/time';\nconsole.log(outline);\n",
  'glyph-one': "import { glyph } from '@labpics/icons/symbols/alert';\nconsole.log(glyph());\n",
  'authored-time': "import { glyph } from '@labpics/icons/symbols/time';\nconsole.log(glyph());\n",
  'recorded-model-axis': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'chevron-forward', axes: { weight: 1.1, opsz: 32 } }));\n",
  'recorded-motion': "import { glyph, glyphCapabilities } from '@labpics/icons/ir';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nconsole.log(compileSymbolEffect(glyph({ icon: 'time' }), glyphCapabilities('time'), 'time.advance', { duration: 400 }));\n",
  'full-ir-opt-in': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'alert' }));\n",
  'full-catalog': oldConsumers.scenarios['full-catalog'].entry,
  'recipes-only': oldConsumers.scenarios['recipes-only'].entry,
};
const artifacts = {};
const artifactMeasurements = {};
for (const file of contract.files) {
  const source = readFileSync(join(root, file));
  const measured = measureArtifact(source);
  artifactMeasurements[file] = {
    ...measured,
    brotliBytes: brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength,
  };
  artifacts[file] = {
    baselineBytes: measured.bytes,
    baselineGzipBytes: measured.gzipBytes,
    maxBytes: Math.min(previous.artifacts[file]?.maxBytes ?? measured.bytes, measured.bytes),
    maxGzipBytes: Math.min(previous.artifacts[file]?.maxGzipBytes ?? measured.gzipBytes, measured.gzipBytes),
    allowedModules: measured.modules,
    forbiddenNeedles: ['sourceMappingURL', ...(file.startsWith('dist/symbols/') ? ['semantics/catalog.json', 'anatomy.runtime.json'] : [])],
  };
}
const scenarios = {};
const consumerMeasurements = {};
for (const [name, entry] of Object.entries(entries)) {
  const measured = await bundleScenario(entry);
  consumerMeasurements[name] = measured;
  const old = name === 'full-ir-opt-in' ? oldConsumers.scenarios['glyph-one'] : oldConsumers.scenarios[name];
  scenarios[name] = {
    entry, baselineBytes: measured.bytes, baselineGzipBytes: measured.gzipBytes,
    maxBytes: old ? Math.min(old.maxBytes, measured.bytes) : measured.bytes,
    maxGzipBytes: old ? Math.min(old.maxGzipBytes, measured.gzipBytes) : measured.gzipBytes,
  };
}
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  capturedAt: new Date().toISOString(),
  environment: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemory: totalmem() },
  packageMeasurement: PACKAGE_SIZE_MEASUREMENT,
  consumerMeasurement: CONSUMER_SIZE_MEASUREMENT,
  artifacts: artifactMeasurements, consumers: consumerMeasurements,
};
const outputFlag = process.argv.indexOf('--output');
if (outputFlag >= 0) writeFileSync(process.argv[outputFlag + 1], `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes('--update')) {
  const outsideBudget = Object.entries(artifacts).filter(([, limits]) => limits.maxBytes < limits.baselineBytes || limits.maxGzipBytes < limits.baselineGzipBytes);
  const outsideConsumers = Object.entries(scenarios).filter(([, limits]) => limits.maxBytes < limits.baselineBytes || limits.maxGzipBytes < limits.baselineGzipBytes);
  if (outsideBudget.length || outsideConsumers.length) throw new Error(`measurement exceeds existing budget: artifacts=${outsideBudget.map(([file]) => file).join(',')}; consumers=${outsideConsumers.map(([name]) => name).join(',')}`);
  writeFileSync(join(root, 'release/package-size-ratchet.json'), `${JSON.stringify({ version: 1, measurement: PACKAGE_SIZE_MEASUREMENT, artifacts }, null, 1)}\n`);
  writeFileSync(join(root, 'release/consumer-size-ratchet.json'), `${JSON.stringify({ version: 1, measurement: CONSUMER_SIZE_MEASUREMENT, scenarios }, null, 1)}\n`);
}
console.log(JSON.stringify({ sourceSha: report.sourceSha, capturedAt: report.capturedAt, consumers: report.consumers, artifacts: Object.keys(artifacts).length }, null, 2));
