import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertRemoteBenchmark } from './measurement.js';

/** Qualify the same installed artifact as the benchmark through both real players. */
export async function verifyLottieConsumer({ prepared, output }) {
  assertRemoteBenchmark();
  const report = { sourceSha: prepared.revision, tarballSha256: prepared.tarballSha256,
    scope: 'installed numeric IconSymbol; authored corpus, optical and semantic motion, lottie-web and dotLottie WASM', complete: false };
  try {
    for (const [name, script, args] of [
      ['corpus', 'verify-symbol-lottie.mjs', ['corpus']],
      ['motion', 'verify-symbol-lottie.mjs', []],
      ['dotlottie', 'verify-symbol-dotlottie.mjs', []],
    ]) {
      const evidence = join(output, `lottie-${name}`);
      mkdirSync(evidence, { recursive: true });
      const stdout = execFileSync(process.execPath, [join(prepared.source, 'scripts', script), ...args], {
        cwd: prepared.source, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, LAB_ICONS_CONSUMER_DIR: prepared.consumer, LAB_ICONS_EVIDENCE_DIR: evidence },
      });
      process.stdout.write(stdout);
      const rows = JSON.parse(readFileSync(join(evidence, name === 'corpus' ? 'corpus-receipt.json' : 'receipt.json'), 'utf8'));
      const summary = JSON.parse(readFileSync(join(evidence, 'summary.json'), 'utf8'));
      report[name] = { comparisons: rows.length, player: summary.player, browser: summary.browser, evidence: `lottie-${name}/` };
    }
    process.stdout.write(execFileSync(process.execPath, [join(prepared.source, 'scripts/verify-symbol-lottie-controls.mjs')], {
      cwd: prepared.source, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LAB_ICONS_CONSUMER_DIR: prepared.consumer, LAB_ICONS_EVIDENCE_DIR: join(output, 'lottie-controls') },
    }));
    report.negativeControls = ['crop', 'color', 'symbol', 'terminal', 'missing-effect', 'empty'];
    report.complete = true;
    return report;
  } catch (error) {
    report.error = [error.message, error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join('\n');
    throw error;
  } finally {
    writeFileSync(join(output, 'lottie-render.json'), JSON.stringify(report, null, 2) + '\n');
  }
}
