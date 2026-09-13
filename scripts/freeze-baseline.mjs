#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertPrivateEvidencePath,
  buildBaselineFreezeBundle,
  captureStaticConsumerBaseline,
  inspectExactSourceFence,
  writeBaselineFreezeBundle,
} from './lib/baseline-workflow.js';

function usage(message) {
  if (message) console.error(`freeze-baseline: ${message}`);
  console.error('usage: node scripts/freeze-baseline.mjs --source-root <clean-origin-main> --partition-seed <private-hex-file> --motion-intents <private-json> --motion-evidence <private-json> --output <external-empty-dir> [--contract <relative-path>]...');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { contracts: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) usage(`missing value for ${key}`);
    if (key === '--source-root') options.sourceRoot = resolve(value);
    else if (key === '--partition-seed') options.partitionSeed = resolve(value);
    else if (key === '--motion-intents') options.motionIntents = resolve(value);
    else if (key === '--motion-evidence') options.motionEvidence = resolve(value);
    else if (key === '--output') options.outputRoot = resolve(value);
    else if (key === '--contract') options.contracts.push(value.replaceAll('\\', '/'));
    else usage(`unknown option ${key}`);
    index += 1;
  }
  for (const field of ['sourceRoot', 'partitionSeed', 'motionIntents', 'motionEvidence', 'outputRoot']) {
    if (!options[field]) usage(`--${field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  }
  return options;
}

function json(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadContract(sourceRoot, id) {
  const root = resolve(sourceRoot);
  const normalizedId = id.replaceAll('\\', '/');
  const contractPath = resolve(root, normalizedId);
  const rel = relative(root, contractPath);
  if (isAbsolute(id) || isAbsolute(normalizedId) || rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`freeze-baseline: contract path must stay relative to source root: ${id}`);
  }
  return { id: normalizedId, content: readFileSync(contractPath) };
}

export function runFreezeBaseline(options) {
  const sourceFence = inspectExactSourceFence(options.sourceRoot);
  const partitionSeedPath = assertPrivateEvidencePath({
    inputPath: options.partitionSeed,
    sourceRoot: options.sourceRoot,
    label: 'partition seed',
  });
  const motionIntentsPath = assertPrivateEvidencePath({
    inputPath: options.motionIntents,
    sourceRoot: options.sourceRoot,
    label: 'motion intent evidence',
  });
  const motionEvidencePath = assertPrivateEvidencePath({
    inputPath: options.motionEvidence,
    sourceRoot: options.sourceRoot,
    label: 'motion rationale evidence',
  });
  const partitionSeed = readFileSync(partitionSeedPath, 'utf8').trim();
  const catalog = json(resolve(options.sourceRoot, 'semantics/catalog.json'));
  const axisQuality = json(resolve(options.sourceRoot, 'semantics/axis-quality.json'));
  const motionRowsValue = json(motionIntentsPath);
  const motionRows = Array.isArray(motionRowsValue) ? motionRowsValue : motionRowsValue.rows;
  const motionEvidenceValue = json(motionEvidencePath);
  const motionEvidence = Array.isArray(motionEvidenceValue) ? motionEvidenceValue : motionEvidenceValue.rows;
  const contracts = options.contracts.map((id) => loadContract(options.sourceRoot, id));
  const staticConsumerBaseline = captureStaticConsumerBaseline({
    sourceRoot: options.sourceRoot,
    sourceFence,
  });

  const bundle = buildBaselineFreezeBundle({
    sourceRoot: options.sourceRoot,
    sourceFence,
    partitionSeed,
    catalog,
    axisQuality,
    motionRows,
    motionEvidence,
    staticConsumerBaseline,
    contracts,
  });
  const written = writeBaselineFreezeBundle({
    bundle,
    outputRoot: options.outputRoot,
    sourceRoot: options.sourceRoot,
  });
  return {
    receipt: written.receipt,
    publicSummary: bundle.publicSummary,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runFreezeBaseline(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`freeze-baseline: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
