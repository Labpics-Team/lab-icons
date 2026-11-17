import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const advisoryId = 'GHSA-fc5q-39xc-vjpf';
const devPath = /^\.>(?:vite|vitest)>(?:(?:@vitest\/mocker|vite|tinyglobby|fdir)>)*picomatch$/;

function hasPublishedFix(versions, range) {
  const match = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '');
  if (!match) return true; // A changed remediation contract needs a fresh review.
  const minimum = match.slice(1).map(Number);
  return Object.keys(versions).some(version => {
    if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
    const parts = version.split('.').map(Number);
    for (let index = 0; index < 3; index++) {
      if (parts[index] !== minimum[index]) return parts[index] > minimum[index];
    }
    return true;
  });
}

/** A documented unreachable dev-tool advisory is not a clean security scan. */
export function assessAudit(audit, policy, registry, now = new Date()) {
  if (!audit?.advisories || !audit?.metadata?.vulnerabilities) throw Error('Invalid npm audit response');
  const accepted = [], rejected = [];
  for (const advisory of Object.values(audit.advisories)) {
    const record = policy?.vulnerabilities?.find(value => value.id === 'CVE-2026-112366');
    const findings = advisory.findings;
    const matches = advisory.github_advisory_id === advisoryId && advisory.module_name === 'picomatch' &&
      record?.statement?.includes(`https://github.com/advisories/${advisoryId}`) &&
      new Date(`${record.expired_at}T00:00:00Z`) > now &&
      Array.isArray(findings) && findings.length > 0 && findings.every(finding =>
        finding.dev === true && !finding.bundled &&
        record.purls?.includes(`pkg:npm/picomatch@${finding.version}`) &&
        Array.isArray(finding.paths) && finding.paths.length > 0 && finding.paths.every(path => devPath.test(path))) &&
      registry?.name === 'picomatch' && registry.versions &&
      !hasPublishedFix(registry.versions, advisory.patched_versions);
    (matches ? accepted : rejected).push(advisory.github_advisory_id ?? advisory.id);
  }
  const reported = Object.values(audit.metadata.vulnerabilities).reduce((sum, count) => sum + count, 0);
  if (reported && !accepted.length && !rejected.length) throw Error('Audit counts contain no advisory details');
  return { accepted, rejected };
}

async function checkSecurity() {
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
    : spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['audit', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw Error(result.error?.message ?? result.stderr ?? 'npm audit failed');
  const audit = JSON.parse(result.stdout);
  const policy = parse(readFileSync(resolve(root, '.trivyignore.yaml'), 'utf8'));
  let registry;
  if (Object.values(audit.advisories ?? {}).some(item => item.github_advisory_id === advisoryId)) {
    const response = await fetch('https://registry.npmjs.org/picomatch', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error(`Cannot check published fix: HTTP ${response.status}`);
    registry = await response.json();
  }
  const verdict = assessAudit(audit, policy, registry);
  if (verdict.rejected.length) throw Error(`Unaccepted dependency advisories: ${verdict.rejected.join(', ')}`);
  console.log(verdict.accepted.length
    ? `Dependency audit: documented dev-only exception ${verdict.accepted.join(', ')}; no published fix; all other advisories remain blocking`
    : 'Dependency audit: no advisories');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkSecurity().catch(error => { console.error(error.message); process.exitCode = 1; });
}
