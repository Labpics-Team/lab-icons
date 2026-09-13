import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const BASELINE_INPUT_PATHS = Object.freeze([
  'semantics/catalog.json',
  'semantics/anatomy.json',
  'semantics/anatomy.runtime.json',
  'semantics/anatomy.candidates.json',
  'semantics/candidate-variants.json',
  'semantics/model-quality.json',
  'semantics/axis-quality.json',
  'semantics/grid.json',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF+/, ''));
}

function fileDigest(root, relativePath) {
  return sha256(readFileSync(resolve(root, relativePath)));
}

export function stripBaselineAnsi(value) {
  return String(value ?? '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function parseVerifyObservations(rawOutput) {
  const output = stripBaselineAnsi(rawOutput);
  const testFiles = /Test Files\s+(\d+) passed/.exec(output);
  const tests = /\bTests\s+(\d+) passed/.exec(output);
  const packageArtifactWitness = /check-package-artifact: OK\b/.test(output);
  if (!testFiles || !tests || !packageArtifactWitness) {
    throw new Error('baseline-evidence: verify output lacks direct required witnesses');
  }
  return {
    testFilesPassed: Number(testFiles[1]),
    testsPassed: Number(tests[1]),
    packageArtifactWitness,
    outputSha256: sha256(Buffer.from(output)),
  };
}

export function loadBaselineSourceEvidence(sourceRoot) {
  const root = resolve(sourceRoot);
  const catalog = readJson(resolve(root, 'semantics/catalog.json'));
  const candidateVariants = readJson(resolve(root, 'semantics/candidate-variants.json'));
  const modelQuality = readJson(resolve(root, 'semantics/model-quality.json'));
  const axisQuality = readJson(resolve(root, 'semantics/axis-quality.json'));
  const sourceFiles = new Set();
  for (const family of Object.values(catalog.icons ?? {})) {
    for (const variant of ['outline', 'filled']) {
      const sourceFile = family?.source?.[variant]?.file;
      if (typeof sourceFile === 'string' && sourceFile.length > 0) sourceFiles.add(sourceFile);
    }
  }
  return {
    catalog,
    candidateVariants,
    modelQuality,
    axisQuality,
    inputDigests: Object.fromEntries(
      BASELINE_INPUT_PATHS.map((path) => [path, fileDigest(root, path)]),
    ),
    sourceFileDigests: Object.fromEntries(
      [...sourceFiles].map((path) => [path, fileDigest(root, path)]),
    ),
  };
}
