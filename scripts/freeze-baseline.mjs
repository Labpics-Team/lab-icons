#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assertOutputOutsideSource,
  buildBaselineSnapshot,
  buildToolIdentity,
  captureVerifyReceipt,
  inspectExactSourceFence,
} from './lib/baseline-snapshot.js';

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error('usage: pnpm baseline:freeze --source-root <clean-origin-main> --output <snapshot.json>');
    }
    if (!['--source-root', '--output'].includes(flag) || values.has(flag)) {
      throw new Error(`baseline-freeze: unsupported or duplicate argument ${flag}`);
    }
    values.set(flag, value);
  }
  for (const flag of ['--source-root', '--output']) {
    if (!values.has(flag)) throw new Error(`baseline-freeze: missing ${flag}`);
  }
  return { sourceRoot: resolve(values.get('--source-root')), output: resolve(values.get('--output')) };
}

const { sourceRoot, output } = parseArgs(process.argv.slice(2));
const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assertOutputOutsideSource({ output, sourceRoot });
const sourceFence = inspectExactSourceFence(sourceRoot);
const toolIdentity = buildToolIdentity(toolRoot);
const verifyReceipt = captureVerifyReceipt({ sourceRoot, sourceFence });
const snapshot = buildBaselineSnapshot({ sourceRoot, sourceFence, toolIdentity, verifyReceipt });

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  output,
  sourceHeadSha: sourceFence.headSha,
  corpus: snapshot.corpus,
  modelStates: snapshot.modelStates,
  debt: snapshot.debt,
  receiptDigest: snapshot.receiptDigest,
})}\n`);
