import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import catalog from '../semantics/catalog.json' with { type: 'json' };
import axisQuality from '../semantics/axis-quality.json' with { type: 'json' };
import {
  BASELINE_FREEZE_VERSION,
  REQUIRED_DISCRETE_MISSION_FAMILIES,
  REQUIRED_MOVABLE_MISSION_FAMILIES,
  canonicalDigest,
  validateStaticConsumerBaseline,
} from '../scripts/lib/baseline-freeze.js';
import {
  assertPrivateEvidencePath,
  buildBaselineFreezeBundle,
  captureStaticConsumerBaseline,
  inspectExactSourceFence,
  writeBaselineFreezeBundle,
} from '../scripts/lib/baseline-workflow.js';
import { loadContract } from '../scripts/freeze-baseline.mjs';

const root = new URL('../', import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const partitionSeed = '33'.repeat(32);

function motionFixture() {
  const evidence = [];
  const rows = Object.keys(catalog.icons).sort().map((familyId) => {
    const witness = {
      familyId,
      kind: 'static-by-design',
      witnessCode: 'semantic-static-review',
      rationale: `No intrinsic target-neutral continuous kinematics are asserted for ${familyId}; motion requires product-state context or would be decorative.`,
    };
    evidence.push(witness);
    return {
      familyId,
      kind: witness.kind,
      witnessCode: witness.witnessCode,
      witnessDigest: canonicalDigest(witness),
    };
  });
  for (const familyId of REQUIRED_MOVABLE_MISSION_FAMILIES) {
    const index = rows.findIndex((row) => row.familyId === familyId);
    rows[index] = {
      familyId,
      kind: 'movable',
      parts: [{ partId: 'primary', affordance: 'semantic-motion', domain: 'target-neutral-parameter' }],
    };
    evidence.splice(evidence.findIndex((row) => row.familyId === familyId), 1);
  }
  for (const familyId of REQUIRED_DISCRETE_MISSION_FAMILIES) {
    const witness = {
      familyId,
      kind: 'unsupported-discrete',
      witnessCode: 'semantic-discrete-state',
      rationale: `${familyId} changes semantic content between discrete states; baseline must preserve state identity without inventing a continuous interpolation.`,
    };
    const index = rows.findIndex((row) => row.familyId === familyId);
    rows[index] = {
      familyId,
      kind: witness.kind,
      witnessCode: witness.witnessCode,
      witnessDigest: canonicalDigest(witness),
    };
    evidence[evidence.findIndex((row) => row.familyId === familyId)] = witness;
  }
  return { rows, evidence };
}

function syntheticFence() {
  return {
    headSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    package: {
      name: '@labpics/icons',
      version: '0.3.0',
      contractSha256: 'c'.repeat(64),
    },
  };
}

function staticConsumerBaseline(sourceFence) {
  return {
    schema: 'labpics.icons-static-consumer-baseline/1',
    sourceFenceDigest: canonicalDigest(sourceFence),
    command: 'CI=true pnpm verify',
    exitCode: 0,
    toolchain: { node: 'v24.15.0', pnpm: '11.13.1' },
    checks: {
      testFilesPassed: 78,
      testsPassed: 901,
      cleanSourcePackFreshInstall: true,
      candidateOptInFailClosed: true,
      unsupportedAxisRefusal: true,
      staticSvgAndAcceptedIr: true,
      motionAdaptersNotExported: true,
      sourceCleanAfter: true,
    },
    digests: {
      packageJsonSha256: sourceFence.package.contractSha256,
      pnpmLockSha256: 'd'.repeat(64),
      releaseContractSha256: 'e'.repeat(64),
    },
  };
}

describe('BASELINE-08 executable freeze workflow', () => {
  it('loads optional authoring contracts only from inside the exact source root', () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), 'lab-icons-outside-contract-'));
    const outsideContract = join(outsideRoot, 'contract.json');
    writeFileSync(outsideContract, '{"outside":true}\n');

    expect(() => loadContract(root, outsideContract)).toThrow(/stay relative to source root/);
  });

  it('source fence accepts only a clean checkout at exact origin/main', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lab-icons-source-fence-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'baseline@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Baseline Test'], { cwd: repo });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@labpics/icons', version: '0.3.0' }));
    execFileSync('git', ['add', 'package.json'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', repo], { cwd: repo });
    execFileSync('git', ['fetch', 'origin', 'main:refs/remotes/origin/main'], { cwd: repo });

    const fence = inspectExactSourceFence(repo);
    expect(fence.headSha).toMatch(/^[a-f0-9]{40}$/);
    expect(fence.treeSha).toMatch(/^[a-f0-9]{40}$/);
    expect(fence.package.contractSha256).toMatch(/^[a-f0-9]{64}$/);

    writeFileSync(join(repo, 'dirty.txt'), 'drift');
    expect(() => inspectExactSourceFence(repo)).toThrow(/clean exact origin\/main/);
  });

  it('captures static consumer evidence by executing canonical CI verify instead of trusting input booleans', () => {
    const repo = mkdtempSync(join(tmpdir(), 'lab-icons-consumer-capture-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'baseline@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Baseline Test'], { cwd: repo });
    mkdirSync(join(repo, 'release'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({
      name: '@labpics/icons',
      version: '0.3.0',
      scripts: {
        verify: 'node scripts/check-package-artifact.js && vitest run',
      },
    }));
    writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    writeFileSync(join(repo, 'release', 'contract.json'), '{}\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo });
    execFileSync('git', ['remote', 'add', 'origin', repo], { cwd: repo });
    execFileSync('git', ['fetch', 'origin', 'main:refs/remotes/origin/main'], { cwd: repo });
    const sourceFence = inspectExactSourceFence(repo);
    const calls = [];
    const runner = ({ args }) => {
      calls.push(args);
      if (args[0] === '--version') return { status: 0, stdout: '11.13.1\n', stderr: '' };
      if (args[0] === 'verify') {
        return {
          status: 0,
          stdout: 'check-package-artifact: OK — installed tarball clean\n Test Files 78 passed\n Tests 901 passed\n',
          stderr: '',
        };
      }
      return { status: 0, stdout: '', stderr: '' };
    };

    const baseline = captureStaticConsumerBaseline({ sourceRoot: repo, sourceFence, runner });
    expect(calls).toEqual([
      ['install', '--frozen-lockfile'],
      ['verify'],
      ['--version'],
    ]);
    expect(baseline.command).toBe('CI=true pnpm verify');
    expect(baseline.checks).toMatchObject({
      testFilesPassed: 78,
      testsPassed: 901,
      cleanSourcePackFreshInstall: true,
      sourceCleanAfter: true,
    });
    expect(validateStaticConsumerBaseline({ sourceFence, baseline }).digest)
      .toMatch(/^[a-f0-9]{64}$/);

    const missingArtifactWitness = ({ args }) => {
      if (args[0] === 'verify') return { status: 0, stdout: 'Test Files 1 passed\nTests 1 passed\n', stderr: '' };
      if (args[0] === '--version') return { status: 0, stdout: '11.13.1\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    expect(() => captureStaticConsumerBaseline({ sourceRoot: repo, sourceFence, runner: missingArtifactWitness }))
      .toThrow(/clean package artifact witness/);
  });

  it('builds one receipt-bound private bundle without publishing holdout membership', () => {
    const motion = motionFixture();
    const sourceFence = syntheticFence();
    const bundle = buildBaselineFreezeBundle({
      sourceRoot: root,
      sourceFence,
      partitionSeed,
      catalog,
      axisQuality,
      motionRows: motion.rows,
      motionEvidence: motion.evidence,
      staticConsumerBaseline: staticConsumerBaseline(sourceFence),
      contracts: [],
    });

    expect(bundle.version).toBe(BASELINE_FREEZE_VERSION);
    expect(bundle.sealed.partition.holdout).toHaveLength(32);
    expect(bundle.authoring.registry.families).toHaveLength(206);
    expect(bundle.receipt.sourceFenceDigest).toBe(bundle.sealed.manifest.sourceFenceDigest);
    expect(bundle.receipt.partitionSeedCommitment).toBe(bundle.sealed.partition.seedCommitment);
    expect(bundle.receipt.motionCensusDigest).toBe(bundle.sealed.motion.digest);
    expect(bundle.receipt.motionEvidenceDigest).toBe(bundle.sealed.motionEvidence.digest);
    expect(bundle.receipt.staticConsumerBaselineDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle).not.toHaveProperty('policy');
    expect(bundle).not.toHaveProperty('protocols');
    expect(bundle.receipt).not.toHaveProperty('novelPolicyDigest');
    expect(bundle.receipt).not.toHaveProperty('generationEnvelopeDigest');
    expect(bundle.receipt).not.toHaveProperty('runLedgerDigest');

    const summary = JSON.stringify(bundle.publicSummary);
    expect(summary).not.toContain(partitionSeed);
    expect(summary).not.toMatch(/nist|material-design|ghcr|providerEndpoint|runLedger/i);
    expect(bundle.publicSummary.partitionSeedCommitment).toBe(bundle.sealed.partition.seedCommitment);
    for (const familyId of bundle.sealed.partition.holdout) {
      expect(summary).not.toContain(familyId);
    }
    expect(bundle.publicSummary.corpus).toEqual({ families: 238, variants: 476, trainFamilies: 206, sealedHoldoutFamilies: 32 });
  });

  it('refuses to materialize private freeze outputs inside the public source checkout', () => {
    const motion = motionFixture();
    const sourceFence = syntheticFence();
    const bundle = buildBaselineFreezeBundle({
      sourceRoot: root,
      sourceFence,
      partitionSeed,
      catalog,
      axisQuality,
      motionRows: motion.rows,
      motionEvidence: motion.evidence,
      staticConsumerBaseline: staticConsumerBaseline(sourceFence),
      contracts: [],
    });
    const forbidden = join(root, '.baseline-private');
    expect(() => writeBaselineFreezeBundle({ bundle, outputRoot: forbidden, sourceRoot: root }))
      .toThrow(/outside public source checkout/);

    const publicRepo = mkdtempSync(join(tmpdir(), 'lab-icons-public-worktrees-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: publicRepo });
    execFileSync('git', ['config', 'user.email', 'baseline@example.invalid'], { cwd: publicRepo });
    execFileSync('git', ['config', 'user.name', 'Baseline Test'], { cwd: publicRepo });
    writeFileSync(join(publicRepo, 'tracked.txt'), 'public\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: publicRepo });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: publicRepo });
    const siblingWorktree = `${publicRepo}-sibling`;
    execFileSync('git', ['worktree', 'add', '-b', 'secondary', siblingWorktree], { cwd: publicRepo });
    expect(() => assertPrivateEvidencePath({
      inputPath: join(siblingWorktree, 'partition-seed.hex'),
      sourceRoot: publicRepo,
      label: 'partition seed',
    })).toThrow(/outside every public Git worktree/);
    expect(() => writeBaselineFreezeBundle({
      bundle,
      outputRoot: join(siblingWorktree, '.baseline-private'),
      sourceRoot: publicRepo,
    })).toThrow(/public Git worktree/);

    const outputRoot = mkdtempSync(join(tmpdir(), 'lab-icons-baseline-output-'));
    writeBaselineFreezeBundle({ bundle, outputRoot, sourceRoot: root });
    expect(JSON.parse(readFileSync(join(outputRoot, 'receipt.json'), 'utf8')).bundleDigest)
      .toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(readFileSync(join(outputRoot, 'sealed', 'partition.json'), 'utf8')).holdout)
      .toHaveLength(32);
    expect(JSON.parse(readFileSync(join(outputRoot, 'sealed', 'motion-evidence.json'), 'utf8')).familyCount)
      .toBe(238 - REQUIRED_MOVABLE_MISSION_FAMILIES.length);
    expect(JSON.parse(readFileSync(join(outputRoot, 'authoring', 'projection.json'), 'utf8')).registry.families)
      .toHaveLength(206);
  });
});
