#!/usr/bin/env node
/** Runner после build: factual update и явное retirement сохраняют действующие потолки. */
import { lstatSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, sep, toNamespacedPath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cpus, totalmem } from 'node:os';
import { brotliCompressSync, constants } from 'node:zlib';
import { measureArtifact, PACKAGE_SIZE_MEASUREMENT, parsePackageSizeRatchet } from './check-package-size.js';
import { bundleScenario, CONSUMER_SIZE_MEASUREMENT, parseConsumerSizeRatchet } from './check-consumer-size.js';
import { validateReleaseRuntimeDependencyGraph, validateReleaseTypeDependencyGraph } from './lib/release-contract.js';
import { authorMotionTargets } from './lib/author-motion-targets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output');
const outputPath = outputFlag >= 0 ? args[outputFlag + 1] : undefined;
const retirementAcknowledgments = [];
for (let index = 0; index < args.length; index++) {
  if (args[index] !== '--retire-artifact') continue;
  const file = args[++index];
  if (!file || file.startsWith('--')) throw new TypeError('--retire-artifact требует exact previous dist artifact');
  retirementAcknowledgments.push(file);
}
if (retirementAcknowledgments.length && (!outputPath || outputPath.startsWith('--'))) {
  throw new TypeError('--retire-artifact требует --output <path> для сохранения прежней policy identity');
}
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const contract = read('release/contract.json');
const previous = parsePackageSizeRatchet(read('release/package-size-ratchet.json'));
const oldConsumers = parseConsumerSizeRatchet(read('release/consumer-size-ratchet.json'));

/** Отчёт не меняет входы измерения и не возвращает исключённый dist-файл. */
function independentReportDestination(output) {
  const requested = resolve(output);
  const parent = realpathSync(dirname(requested));
  let entry;
  try { entry = lstatSync(requested); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Неразрешимая существующая ссылка отклоняется, а не считается новым файлом.
  const actual = entry ? realpathSync(requested) : join(parent, basename(requested));
  const comparable = path => process.platform === 'win32'
    ? toNamespacedPath(resolve(path)).toLowerCase() : resolve(path);
  const inside = (directory, candidate) => {
    const base = comparable(directory), target = comparable(candidate);
    return target === base || target.startsWith(`${base}${sep}`);
  };
  const refuse = () => { throw new Error('measurement report destination обязан быть независимым от inputs, release и dist'); };
  const directories = ['dist', 'release', 'scripts', 'semantics'].map(name => join(root, name));
  for (const directory of directories) {
    const physical = realpathSync(directory);
    if ([requested, actual].some(path => inside(directory, path) || inside(physical, path))) refuse();
  }
  const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino;
  const directoryIds = directories.map(path => statSync(path, { bigint: true }));
  // Identity закрывает case aliases и bind-mount aliases существующего parent.
  for (const targetParent of new Set([parent, dirname(actual)])) {
    for (let directory = targetParent; ; directory = dirname(directory)) {
      const identity = statSync(directory, { bigint: true });
      if (directoryIds.some(protectedId => sameIdentity(identity, protectedId))) refuse();
      if (dirname(directory) === directory) break;
    }
  }
  const inputs = ['package.json', 'pnpm-lock.yaml'].map(name => join(root, name));
  if (inputs.some(path => comparable(requested) === comparable(path) || comparable(actual) === comparable(realpathSync(path)))) refuse();
  if (entry) {
    const identity = statSync(actual, { bigint: true });
    // realpath не уникален для hardlinks; shared file не является независимым отчётом.
    if (!identity.isFile() || identity.nlink > 1n || inputs.some(path => sameIdentity(identity, statSync(path, { bigint: true })))) refuse();
  }
  return actual;
}

const motionTargets = authorMotionTargets(read('semantics/author-anatomy.json'));
const rotationEntries = {};
const clockEntries = {};
for (const icon of motionTargets.clocks) {
  const file = `dist/gestures/${icon}.js`;
  if (!contract.files.includes(file)) throw new Error('measurement: clock target отсутствует в release contract');
  const module = await import(pathToFileURL(join(root, file)).href);
  const admitted = module.motionCapabilities();
  if (!admitted.ok || admitted.capabilities.icon !== icon || admitted.capabilities.parameter !== 'elapsed-hours') {
    throw new Error(`measurement: ${icon} не имеет подготовленных часов`);
  }
  const entry = `@labpics/icons/gestures/${icon}`;
  clockEntries[`gesture-${icon}-prepared`] = `import { prepareClockHands } from '${entry}';\nconst result = prepareClockHands();\nconsole.log(result.ok ? result.prepared.sample(0.5) : result);\n`;
  clockEntries[`gesture-${icon}-capabilities`] = `import { motionCapabilities } from '${entry}';\nconsole.log(motionCapabilities());\n`;
  clockEntries[`gesture-${icon}-combined`] = `import { prepareClockHands, motionCapabilities } from '${entry}';\nconsole.log(prepareClockHands(), motionCapabilities());\n`;
}
for (const icon of motionTargets.rotations) {
  const file = `dist/gestures/${icon}.js`;
  if (!/^[a-z][a-z0-9-]*$/.test(icon) || !contract.files.includes(file)) {
    throw new Error('measurement: rotation target отсутствует в release contract');
  }
  const module = await import(pathToFileURL(join(root, file)).href);
  const admitted = ['outline', 'filled'].map(variant => module.motionCapabilities(variant)).find(result => result.ok);
  if (!admitted || admitted.capabilities.icon !== icon || !admitted.capabilities.gestures.length) {
    throw new Error(`measurement: ${icon} не имеет допущенного gesture`);
  }
  const { variant, gestures } = admitted.capabilities;
  const entry = `@labpics/icons/gestures/${icon}`;
  const renderArgument = variant === 'outline' ? '' : JSON.stringify(variant);
  const request = variant === 'outline' ? '{ duration: 400 }' : `{ duration: 400, variant: ${JSON.stringify(variant)} }`;
  rotationEntries[`gesture-${icon}-svg`] = `import { renderMotionSvg } from '${entry}';\nconsole.log(renderMotionSvg(${renderArgument}));\n`;
  rotationEntries[`gesture-${icon}-effect`] = `import { compileMotionEffect } from '${entry}';\nconsole.log(compileMotionEffect('${gestures[0].id}', ${request}));\n`;
  rotationEntries[`gesture-${icon}-combined`] = `import { renderMotionSvg, compileMotionEffect } from '${entry}';\nconsole.log(renderMotionSvg(${renderArgument}), compileMotionEffect('${gestures[0].id}', ${request}));\n`;
}
const entries = {
  ...clockEntries,
  'one-static': oldConsumers.scenarios['one-static'].entry,
  'authored-static': "import { outline } from '@labpics/icons/symbols/time';\nconsole.log(outline);\n",
  'glyph-one': "import { glyph } from '@labpics/icons/symbols/alert';\nconsole.log(glyph());\n",
  'authored-time': "import { glyph } from '@labpics/icons/symbols/time';\nconsole.log(glyph());\n",
  'status-circle-state': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/status-circle';\nconsole.log(renderStateSvg('question'), compileStateEffect('confirmation', { duration: 180 }));\n",
  'status-circle-enclosure-patch': "import { renderEnclosurePatch } from '@labpics/icons/state-variations/status-circle';\nconsole.log(renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } }));\n",
  'playback-circle-enclosure-patch': "import { renderEnclosurePatch } from '@labpics/icons/state-variations/playback-circle';\nconsole.log(renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } }));\n",
  'status-circle-state-variation': "import { renderStateSvg, compileStateEffect, renderEnclosurePatch } from '@labpics/icons/state-variations/status-circle';\nconsole.log(renderStateSvg('question'), compileStateEffect('confirmation', { duration: 180 }), renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } }));\n",
  'playback-circle-state-variation': "import { renderStateSvg, compileStateEffect, renderEnclosurePatch } from '@labpics/icons/state-variations/playback-circle';\nconsole.log(renderStateSvg('play'), compileStateEffect('pause', { duration: 180 }), renderEnclosurePatch({ variation: { enclosureEmphasis: 1.1 } }));\n",
  'recorded-model-axis': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'chevron-forward', axes: { weight: 1.1, opsz: 32 } }));\n",
  'recorded-motion': "import { glyph, glyphCapabilities } from '@labpics/icons/ir';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nconsole.log(compileSymbolEffect(glyph({ icon: 'time' }), glyphCapabilities('time'), 'time.advance', { duration: 400 }));\n",
  'full-ir-opt-in': "import { glyph } from '@labpics/icons/ir';\nconsole.log(glyph({ icon: 'alert' }));\n",
  'full-catalog': oldConsumers.scenarios['full-catalog'].entry,
  'recipes-only': oldConsumers.scenarios['recipes-only'].entry,
  'source-ellipsis-horizontal': "import { glyph } from '@labpics/icons/symbols/ellipsis-horizontal';\nconsole.log(glyph());\n",
  'varied-ellipsis-horizontal': "import { glyph } from '@labpics/icons/variations/ellipsis-horizontal';\nconsole.log(glyph({ variation: { dotScale: 1.1, spacingScale: 0.9 } }));\n",
  'source-ellipsis-vertical': "import { glyph } from '@labpics/icons/symbols/ellipsis-vertical';\nconsole.log(glyph());\n",
  'varied-ellipsis-vertical': "import { glyph } from '@labpics/icons/variations/ellipsis-vertical';\nconsole.log(glyph({ variation: { dotScale: 1.1, spacingScale: 0.9 } }));\n",
  'varied-microphone': "import { glyph } from '@labpics/icons/variations/mic';\nconsole.log(glyph({ variation: { bodyWidth: 0.9 } }));\n",
  'varied-microphone-circle': "import { glyph } from '@labpics/icons/variations/mic-circle';\nconsole.log(glyph({ variant: 'filled', variation: { bodyWidth: 0.8 } }));\n",
  'microphone-state-outline': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/microphone';\nconsole.log(renderStateSvg('muted'), compileStateEffect('unmuted', { duration: 180 }));\n",
  'microphone-state-filled': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/microphone-filled';\nconsole.log(renderStateSvg('muted'), compileStateEffect('unmuted', { duration: 180 }));\n",
  'visibility-state-outline': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/visibility';\nconsole.log(renderStateSvg('hidden'), compileStateEffect('visible', { duration: 180 }));\n",
  'visibility-state-filled': "import { renderStateSvg, compileStateEffect } from '@labpics/icons/states/visibility-filled';\nconsole.log(renderStateSvg('hidden'), compileStateEffect('visible', { duration: 180 }));\n",
  ...rotationEntries,
  ...Object.fromEntries(['reload', 'refresh'].map(icon => [`gesture-${icon}-ir-reference`,
    `import { glyph, glyphCapabilities } from '@labpics/icons/symbols/${icon}';\nimport { renderGlyphSvg } from '@labpics/icons/ir/render';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nconst value = glyph();\nconsole.log(renderGlyphSvg(value), compileSymbolEffect(value, glyphCapabilities(), '${icon}.cycle', { duration: 400 }));\n`])),
  ...Object.fromEntries(['mic', 'mic-circle'].flatMap(icon => [
    [`gesture-${icon}-width`, `import { prepareBodyWidth } from '@labpics/icons/gestures/${icon}';\nconst result = prepareBodyWidth('filled');\nconsole.log(result.ok && result.prepared.sample(0.9));\n`],
    [`gesture-${icon}-width-capabilities`, `import { motionCapabilities } from '@labpics/icons/gestures/${icon}';\nconsole.log(motionCapabilities());\n`],
  ])),
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
    ...(/^dist\/(symbols|states|variations|state-variations)\//.test(file) ? ['semantics/catalog.json', 'anatomy.runtime.json'] : []),
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
const retiredArtifacts = [];
const acknowledged = new Set(retirementAcknowledgments);
if (acknowledged.size !== retirementAcknowledgments.length) policyViolations.push('retirement acknowledgment содержит повторные artifacts');
let retirementGraphErrors = [];
if (acknowledged.size) {
  const readText = file => readFileSync(join(root, file), 'utf8');
  retirementGraphErrors = [
    ...validateReleaseRuntimeDependencyGraph({ contract, readText }),
    ...validateReleaseTypeDependencyGraph({ contract, readText }),
  ];
  policyViolations.push(...retirementGraphErrors);
}
for (const file of acknowledged) {
  if (!Object.hasOwn(previous.artifacts, file)) {
    policyViolations.push(`${file}: unknown previous artifact; retirement запрещён`);
    continue;
  }
  if (artifactSources.has(file)) {
    policyViolations.push(`${file}: active artifact в release contract; retirement запрещён`);
    continue;
  }
  // lstat видит и повреждённую ссылку; только ENOENT удостоверяет отсутствие output.
  try {
    lstatSync(join(root, file));
    policyViolations.push(`${file}: previous output ещё существует; retirement запрещён`);
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      policyViolations.push(`${file}: отсутствие previous output не установлено (${error.message})`);
      continue;
    }
  }
  if (!retirementGraphErrors.length) retiredArtifacts.push({
    file, previousPolicy: previous.artifacts[file],
    previousPolicySha256: createHash('sha256').update(JSON.stringify(previous.artifacts[file])).digest('hex'),
  });
}
for (const file of Object.keys(previous.artifacts)) {
  if (!artifactSources.has(file) && !acknowledged.has(file)) {
    policyViolations.push(`${file}: previous artifact отсутствует в release contract; требуется --retire-artifact ${file}`);
  }
}
for (const [file, limits] of Object.entries(artifacts)) {
  if (limits.identicalTo && !artifactSources.get(file).equals(artifactSources.get(limits.identicalTo) ?? Buffer.alloc(0))) {
    policyViolations.push(`${file}: identicalTo ${limits.identicalTo} обязан быть byte-identical`);
  }
}
const scenarios = {};
const consumerMeasurements = {};
// Ограничения принадлежат exact entry независимо от имени сценария.
// Несколько прежних aliases сохраняют оба наиболее строгих потолка.
const previousConsumerLimits = new Map();
for (const { entry, maxBytes, maxGzipBytes } of Object.values(oldConsumers.scenarios)) {
  const previous = previousConsumerLimits.get(entry);
  previousConsumerLimits.set(entry, {
    maxBytes: Math.min(previous?.maxBytes ?? maxBytes, maxBytes),
    maxGzipBytes: Math.min(previous?.maxGzipBytes ?? maxGzipBytes, maxGzipBytes),
  });
}
for (const [name, entry] of Object.entries(entries)) {
  const measured = await bundleScenario(entry, { includeBrotli: true });
  consumerMeasurements[name] = measured;
  const old = previousConsumerLimits.get(entry);
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
  if (!Object.values(scenarios).some(({ entry }) => entry === oldConsumers.scenarios[name].entry)) {
    policyViolations.push(`${name}: previous consumer entry отсутствует в measurement`);
  }
}
const report = {
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  capturedAt: new Date().toISOString(),
  environment: { node: process.version, versions: process.versions, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, cpuCount: cpus().length, totalMemory: totalmem() },
  packageMeasurement: PACKAGE_SIZE_MEASUREMENT,
  consumerMeasurement: CONSUMER_SIZE_MEASUREMENT,
  brotliMeasurement: 'node:zlib brotliCompressSync quality=11; environment.versions.brotli',
  lockfileSha256: createHash('sha256').update(readFileSync(join(root, 'pnpm-lock.yaml'))).digest('hex'),
  artifacts: artifactMeasurements, consumers: consumerMeasurements, retiredArtifacts,
  candidatePolicies: {
    package: { version: 1, measurement: PACKAGE_SIZE_MEASUREMENT, artifacts },
    consumer: { version: 1, measurement: CONSUMER_SIZE_MEASUREMENT, scenarios },
  },
  policyViolations,
};
if (outputFlag >= 0) writeFileSync(independentReportDestination(outputPath), `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes('--update')) {
  if (policyViolations.length) throw new Error(`measurement policy отказала:\n${policyViolations.join('\n')}`);
  parsePackageSizeRatchet(report.candidatePolicies.package);
  parseConsumerSizeRatchet(report.candidatePolicies.consumer);
  writeFileSync(join(root, 'release/package-size-ratchet.json'), `${JSON.stringify(report.candidatePolicies.package, null, 1)}\n`);
  writeFileSync(join(root, 'release/consumer-size-ratchet.json'), `${JSON.stringify(report.candidatePolicies.consumer, null, 1)}\n`);
}
console.log(JSON.stringify({ sourceSha: report.sourceSha, capturedAt: report.capturedAt, consumers: report.consumers, artifacts: Object.keys(artifacts).length, policyViolations }, null, 2));
