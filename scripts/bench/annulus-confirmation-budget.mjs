#!/usr/bin/env node
/** Узкий production emit: motion и две семьи, без полной сборки или timing claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'fflate';
import { bundle as actualBundle } from '../build-ir.mjs';
import { renderSymbolModules } from '../lib/symbol-modules.js';
import { authoredSymbolPayloads } from '../../test/helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const [receiptPath, outputPath, baselineCheckout] = process.argv.slice(2);
assert.ok(receiptPath && outputPath && baselineCheckout, 'Нужны authenticated full-pack receipt, путь отчёта и baseline checkout.');
const baselineRoot = resolve(baselineCheckout);
const hash = value => createHash('sha256').update(value).digest('hex');
const baselineCommit = 'd1f940035924a096fbd209bcc50e824ea8800f6c';
const baselineFiles = ['src/motion/index.ts', 'scripts/lib/author-variation.js', 'scripts/lib/symbol-modules.js', 'scripts/build-ir.mjs'];
const baselineSourceSha256 = Object.fromEntries(baselineFiles.map(file => {
  const actual = hash(readFileSync(join(baselineRoot, file)));
  const recorded = hash(execFileSync('git', ['show', `${baselineCommit}:${file}`], { cwd: root, windowsHide: true }));
  assert.equal(actual, recorded, `Baseline checkout source drift: ${file}`);
  return [file, actual];
}));
const { bundle: baselineBundle } = await import(pathToFileURL(join(baselineRoot, 'scripts/build-ir.mjs')).href);
const { authorVariationCapability: baselineCapability } = await import(pathToFileURL(join(baselineRoot, 'scripts/lib/author-variation.js')).href);
const { renderSymbolModules: baselineRenderSymbolModules } = await import(pathToFileURL(join(baselineRoot, 'scripts/lib/symbol-modules.js')).href);
const measure = value => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return { bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length, sha256: hash(bytes) };
};
const receiptBytes = readFileSync(receiptPath);
assert.equal(hash(receiptBytes), 'c53e162fbe24e0bab7ea92cbdd6f0e2cfd5b7cf2eaa812c7ad663bfc52fea9ff');
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.sourceSha, '68312fc7323ffb9f2db08c2fc9855d916d1ca9e5');
const staging = resolve(dirname(outputPath), 'annulus-confirmation-emitted');
mkdirSync(staging, { recursive: true });
await baselineBundle(baselineRoot, staging, 'src/motion/index.ts', 'baseline-motion.js', ['../ir/contour-runtime.js']);
await actualBundle(root, staging, 'src/motion/index.ts', 'candidate-motion.js', ['../ir/contour-runtime.js']);
const native = { baseline: measure(readFileSync(join(staging, 'baseline-motion.js'))),
  candidate: measure(readFileSync(join(staging, 'candidate-motion.js'))) };
const recorded = receipt.artifacts['dist/motion/index.js'];
assert.equal(native.baseline.sha256, recorded.sha256, 'Baseline emit обязан совпасть с настоящим full-pack artifact.');
const policy = JSON.parse(readFileSync(join(root, 'release/package-size-ratchet.json'))).artifacts['dist/motion/index.js'];
assert.ok(native.candidate.bytes <= policy.maxBytes);
assert.ok(native.candidate.gzipBytes <= policy.maxGzipBytes);
const inputs = await authoredSymbolPayloads(['checkmark-circle', 'plus-circle']);
const projections = Object.fromEntries(Object.entries(inputs).map(([icon, input]) => {
  const previous = { ...input, capabilities: { ...input.capabilities,
    outline: { ...input.capabilities.outline, variation: baselineCapability(input.variation.outline) } } };
  const baseline = baselineRenderSymbolModules(previous), candidate = renderSymbolModules(input);
  assert.equal(candidate.symbol, baseline.symbol, 'Обычный символ не меняется.');
  assert.equal(candidate.data, baseline.data, 'Авторские path и source capabilities не меняются.');
  return [icon, Object.fromEntries(['symbol', 'data', 'variation'].map(entry =>
    [entry, { baseline: measure(baseline[entry]), candidate: measure(candidate[entry]) }]))];
}));
const sourceFiles = ['src/motion/index.ts', 'src/ir/author-annulus-types.ts', 'scripts/lib/author-variation.js',
  'scripts/lib/symbol-modules.js', 'scripts/build-ir.mjs', 'test/annulus-motion.test.js'];
const report = { schemaVersion: 1, scope: 'Bounded native production emit and two-family projections; not full-pack, timing or browser qualification',
  baseline: { sourceSha: receipt.sourceSha, sourceControlCommit: baselineCommit,
    reportSha256: hash(receiptBytes), motionArtifactSha256: recorded.sha256, sourceSha256: baselineSourceSha256 },
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  measurement: 'production scripts/build-ir.mjs bundle; fflate gzipSync level=9 mtime=0',
  sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(join(root, file)))])),
  native: { ...native, limits: { maxBytes: policy.maxBytes, maxGzipBytes: policy.maxGzipBytes } }, projections };
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, native: report.native, projections }));
