#!/usr/bin/env node
/** Запускается на runner после build; --update явно меняет только factual size policy. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { brotliCompressSync, constants } from 'node:zlib';
import { measureArtifact, PACKAGE_SIZE_MEASUREMENT, parsePackageSizeRatchet } from './check-package-size.js';
import { bundleScenario, CONSUMER_SIZE_MEASUREMENT, parseConsumerSizeRatchet } from './check-consumer-size.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const contract = read('release/contract.json');
const previous = parsePackageSizeRatchet(read('release/package-size-ratchet.json'));
const oldConsumers = parseConsumerSizeRatchet(read('release/consumer-size-ratchet.json'));
const entries = {
  'one-static': oldConsumers.scenarios['one-static'].entry,
  'authored-static': "import { outline } from '@labpics/icons/symbols/time';\nconsole.log(outline);\n",
  'glyph-one': "import { glyph } from '@labpics/icons/symbols/alert';\nconsole.log(glyph());\n",
  'authored-time': "import { glyph } from '@labpics/icons/symbols/time';\nconsole.log(glyph());\n",
  'status-circle-state': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/status-circle';\nconsole.log(renderStateSvg('question'), compileStateEffect('confirmation', { duration: 180 }));\n",
  'recorded-model-axis': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'chevron-forward', axes: { weight: 1.1, opsz: 32 } }));\n",
  'recorded-motion': "import { glyph, glyphCapabilities } from '@labpics/icons/ir';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nconsole.log(compileSymbolEffect(glyph({ icon: 'time' }), glyphCapabilities('time'), 'time.advance', { duration: 400 }));\n",
  'full-ir-opt-in': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'alert' }));\n",
  'full-catalog': oldConsumers.scenarios['full-catalog'].entry,
  'recipes-only': oldConsumers.scenarios['recipes-only'].entry,
};
const artifacts = {};
const artifactMeasurements = {};
const artifactSources = new Map();
const policyViolations = [];
for (const file of contract.files) {
  const source = readFileSync(join(root, file));
  artifactSources.set(file, source);
  const measured = measureArtifact(source);
  const old = previous.artifacts[file];
  const forbiddenNeedles = [...new Set([
    ...(old?.forbiddenNeedles ?? []), 'sourceMappingURL',
    ...(/^dist\/(symbols|states)\//.test(file) ? ['semantics/catalog.json', 'anatomy.runtime.json'] : []),
  ])];
  artifactMeasurements[file] = {
    ...measured,
    sha256: createHash('sha256').update(source).digest('hex'),
    brotliBytes: brotliCompressSync(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength,
  };
  artifacts[file] = {
    baselineBytes: measured.bytes,
    baselineGzipBytes: measured.gzipBytes,
    maxBytes: old?.maxBytes ?? measured.bytes,
    maxGzipBytes: old?.maxGzipBytes ?? measured.gzipBytes,
    allowedModules: old?.allowedModules ?? measured.modules,
    forbiddenNeedles,
    ...(old?.identicalTo ? { identicalTo: old.identicalTo } : {}),
  };
  const limits = artifacts[file];
  if (measured.bytes > limits.maxBytes || measured.gzipBytes > limits.maxGzipBytes) {
    policyViolations.push(`${file}: budget ${limits.maxBytes} B / ${limits.maxGzipBytes} B gzip; measured ${measured.bytes} B / ${measured.gzipBytes} B gzip`);
  }
  if (JSON.stringify([...limits.allowedModules].sort()) !== JSON.stringify(measured.modules)) {
    policyViolations.push(`${file}: module inclusion drift; expected [${limits.allowedModules.join(', ')}], actual [${measured.modules.join(', ')}]`);
  }
  for (const needle of forbiddenNeedles) {
    if (source.toString('utf8').includes(needle)) policyViolations.push(`${file}: forbidden marker ${needle}`);
  }
}
for (const file of Object.keys(previous.artifacts)) {
  if (!artifactSources.has(file)) policyViolations.push(`${file}: previous artifact отсутствует в release contract`);
}
for (const [file, limits] of Object.entries(artifacts)) {
  if (limits.identicalTo && !artifactSources.get(file).equals(artifactSources.get(limits.identicalTo) ?? Buffer.alloc(0))) {
    policyViolations.push(`${file}: identicalTo ${limits.identicalTo} обязан быть byte-identical`);
  }
}
const scenarios = {};
const consumerMeasurements = {};
for (const [name, entry] of Object.entries(entries)) {
  const measured = await bundleScenario(entry, { includeBrotli: true });
  consumerMeasurements[name] = measured;
  const old = oldConsumers.scenarios[name] ??
    (name === 'full-ir-opt-in' ? oldConsumers.scenarios['glyph-one'] : undefined);
  scenarios[name] = {
    entry, baselineBytes: measured.bytes, baselineGzipBytes: measured.gzipBytes,
    maxBytes: old?.maxBytes ?? measured.bytes,
    maxGzipBytes: old?.maxGzipBytes ?? measured.gzipBytes,
  };
  const limits = scenarios[name];
  if (measured.bytes > limits.maxBytes || measured.gzipBytes > limits.maxGzipBytes) {
    policyViolations.push(`${name}: consumer budget ${limits.maxBytes} B / ${limits.maxGzipBytes} B gzip; measured ${measured.bytes} B / ${measured.gzipBytes} B gzip`);
  }
}
for (const name of Object.keys(oldConsumers.scenarios)) {
  if (!Object.hasOwn(scenarios, name)) policyViolations.push(`${name}: previous consumer scenario отсутствует в measurement`);
}
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  capturedAt: new Date().toISOString(),
  environment: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemory: totalmem() },
  packageMeasurement: PACKAGE_SIZE_MEASUREMENT,
  consumerMeasurement: CONSUMER_SIZE_MEASUREMENT,
  brotliMeasurement: 'node:zlib brotliCompressSync quality=11; environment.versions.brotli',
  lockfileSha256: createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'),
  artifacts: artifactMeasurements, consumers: consumerMeasurements,
  candidatePolicies: {
    package: { version: 1, measurement: PACKAGE_SIZE_MEASUREMENT, artifacts },
    consumer: { version: 1, measurement: CONSUMER_SIZE_MEASUREMENT, scenarios },
  },
  policyViolations,
};
const outputFlag = process.argv.indexOf('--output');
if (outputFlag >= 0) writeFileSync(process.argv[outputFlag + 1], `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes('--update')) {
  if (policyViolations.length) throw new Error(`measurement policy отказала:\n${policyViolations.join('\n')}`);
  parsePackageSizeRatchet(report.candidatePolicies.package);
  parseConsumerSizeRatchet(report.candidatePolicies.consumer);
  writeFileSync(join(root, 'release/package-size-ratchet.json'), `${JSON.stringify(report.candidatePolicies.package, null, 1)}\n`);
  writeFileSync(join(root, 'release/consumer-size-ratchet.json'), `${JSON.stringify(report.candidatePolicies.consumer, null, 1)}\n`);
}
console.log(JSON.stringify({ sourceSha: report.sourceSha, capturedAt: report.capturedAt, consumers: report.consumers, artifacts: Object.keys(artifacts).length, policyViolations }, null, 2));
