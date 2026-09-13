import { freezeBaseline, parseFreezeArgs } from './baseline-freeze.js';

export function summarizeFrozenBaseline(result) {
  return {
    output: result.output,
    requestedOutput: result.requestedOutput,
    sourceHeadSha: result.sourceFence.headSha,
    corpus: result.snapshot.corpus,
    modelStates: result.snapshot.modelStates,
    debt: result.snapshot.debt,
    receiptDigest: result.snapshot.receiptDigest,
  };
}

export function runFreezeBaselineCli({
  argv,
  toolRoot,
  stdout = process.stdout,
  freeze = freezeBaseline,
}) {
  const { sourceRoot, output } = parseFreezeArgs(argv);
  const result = freeze({ sourceRoot, output, toolRoot });
  const summary = summarizeFrozenBaseline(result);
  stdout.write(`${JSON.stringify(summary)}\n`);
  return summary;
}
