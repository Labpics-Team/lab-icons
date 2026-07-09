import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildFullPreview } from './build-preview.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPO = join(ROOT, '..');
const QUALITY_DIR = join(REPO, 'quality');

const args = new Set(process.argv.slice(2));
const strict = args.has('--strict');
const withReport = args.has('--report');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = {
  at: new Date().toISOString(),
  strict,
  checks: [],
  preview: null,
  status: 'ok',
};

const run = (script, extraArgs = []) => {
  const command = process.execPath;
  const child = spawnSync(command, [join(ROOT, script), ...extraArgs], {
    cwd: REPO,
    encoding: 'utf8',
    windowsHide: true,
  });
  const ok = child.status === 0;
  output.checks.push({
    name: script,
    code: child.status ?? 1,
    stdout: child.stdout || '',
    stderr: child.stderr || '',
    strict: strict ? !!extraArgs.includes('--strict') : false,
  });
  if (!ok) {
    output.status = 'failed';
  }
  return ok;
};

const checks = [
  run('check-eonz-strict.js', strict ? ['--strict'] : []),
  run('check-ink-topology.js', strict ? ['--strict'] : []),
];

let preview;
try {
  preview = buildFullPreview({ outputPath: join(REPO, 'preview', 'icon-preview-full.html') });
} catch (error) {
  output.status = 'failed';
  preview = {
    outputPath: join(REPO, 'preview', 'icon-preview-full.html'),
    rows: 0,
    criticalRows: 0,
    maxDeviation: 0,
    skippedSource: 0,
    missingGenerated: 0,
    buildErrors: 1,
    taggedCount: 0,
    reasonsCount: 0,
    hardCount: 0,
    reportCount: 0,
    buildErrorsReason: error?.message || String(error),
    failed: true,
  };
}
output.preview = preview;

mkdirSync(QUALITY_DIR, { recursive: true });
const jsonPath = join(QUALITY_DIR, `quality-report-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');

if (withReport) {
  const mdPath = join(QUALITY_DIR, `quality-report-${stamp}.md`);
  const failCount = output.checks.filter((item) => item.code !== 0).length;
  const lines = [
    `# lab-icons visual gates report`,
    '',
    `- generated: ${output.at}`,
    `- strict: ${strict ? 'true' : 'false'}`,
    `- checks failed: ${failCount}/${output.checks.length}`,
    '',
    '## Checks',
    ...output.checks.map((c) => `- ${c.name}: exit ${c.code}`),
    '',
    '## Preview',
    `- rows: ${preview.rows}`,
    `- critical: ${preview.criticalRows}`,
    `- max deviation: ${preview.maxDeviation.toFixed(2)}%`,
    `- hard/report: ${preview.hardCount}/${preview.reportCount}`,
    `- status: ${output.status}`,
    '',
    `Output saved: ${jsonPath}`,
  ];
  writeFileSync(mdPath, lines.join('\n'), 'utf8');
}

if (output.status === 'ok') {
  console.log(`quality gates: OK`);
  console.log(`  strict: ${strict ? 'ON' : 'OFF'}`);
  console.log(`  preview: ${preview.rows} rows in ${preview.outputPath}`);
  console.log(`  hard/report: ${preview.hardCount}/${preview.reportCount}`);
  console.log(`  max deviation: ${preview.maxDeviation.toFixed(2)}%`);
  console.log(`  report: ${join('quality', `quality-report-${stamp}.json`)}`);
  process.exit(0);
}

console.log('quality gates: FAIL');
for (const c of output.checks) {
  if (c.code === 0) continue;
  console.error(`- ${c.name}: exit ${c.code}`);
  if (c.stdout) console.error(c.stdout.trim().split('\n').slice(-2).join('\n'));
  if (c.stderr) console.error(c.stderr.trim().split('\n').slice(-2).join('\n'));
}
console.log(`  report: ${join('quality', `quality-report-${stamp}.json`)}`);
process.exit(1);
