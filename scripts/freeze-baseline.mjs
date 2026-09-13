#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  freezeBaseline,
  parseFreezeArgs,
} from './lib/baseline-freeze.js';

const { sourceRoot, output } = parseFreezeArgs(process.argv.slice(2));
const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = freezeBaseline({ sourceRoot, output, toolRoot });
process.stdout.write(`${JSON.stringify({
  output: result.output,
  requestedOutput: result.requestedOutput,
  sourceHeadSha: result.sourceFence.headSha,
  corpus: result.snapshot.corpus,
  modelStates: result.snapshot.modelStates,
  debt: result.snapshot.debt,
  receiptDigest: result.snapshot.receiptDigest,
})}\n`);
