import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = /^[0-9a-f]{40}$/;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const roles = ['compose', 'npm', 'catalog'];

function inventory(pages, key) {
  assert(Array.isArray(pages) && pages.length > 0, 'Missing ' + key + ' inventory');
  const total = pages[0]?.total_count;
  assert(Number.isSafeInteger(total) && total >= 0
    && pages.every(p => p?.total_count === total && Array.isArray(p[key])),
    'Incomplete ' + key + ' inventory');
  const entries = pages.flatMap(p => p[key]);
  assert(entries.length === total && entries.every(x => positive(x.id))
    && new Set(entries.map(x => x.id)).size === entries.length,
    'Incomplete or ambiguous ' + key + ' inventory');
  return entries;
}

export function resolveReleaseSource({ repository, repositoryId, ref, sha }, {
  api = (path, paginate = false) => JSON.parse(execFileSync('gh', [
    'api', path, ...(paginate ? ['--paginate', '--slurp'] : []),
  ], { encoding: 'utf8' })),
  git = args => execFileSync('git', args, { encoding: 'utf8' }).trim(),
} = {}) {
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') && positive(repositoryId)
    && ref === 'refs/heads/main' && hash.test(sha ?? ''), 'Release requires an exact main dispatch');
  assert.equal(git(['rev-parse', 'HEAD']), sha, 'Checkout differs from release source');
  git(['merge-base', '--is-ancestor', sha, 'origin/main']);
  const { version } = JSON.parse(git(['show', sha + ':package.json']));
  assert(typeof version === 'string' && versionPattern.test(version), 'Invalid package version');

  const base = 'repos/' + repository + '/actions';
  const matches = run => run.repository?.id === repositoryId
    && run.repository?.full_name === repository && run.head_repository?.id === repositoryId
    && run.head_repository?.full_name === repository && run.head_sha === sha
    && run.head_branch === 'main' && run.event === 'push'
    && run.path === '.github/workflows/ci.yml'
    && positive(run.id) && positive(run.run_number) && positive(run.run_attempt)
    && positive(run.workflow_id);
  const runs = inventory(api(base + '/workflows/ci.yml/runs?branch=main&event=push&head_sha='
    + sha + '&per_page=100', true), 'workflow_runs');
  assert(runs.length && runs.every(matches)
    && new Set(runs.map(run => run.run_number)).size === runs.length,
    'No unambiguous exact main CI run');
  // Do not filter by success: a new failed or in-progress run must not be hidden
  // by an older successful run for the same commit.
  const selected = runs.reduce((latest, run) => run.run_number > latest.run_number ? run : latest);
  const confirm = () => {
    const current = api(base + '/runs/' + selected.id);
    assert(matches(current) && current.id === selected.id && current.workflow_id === selected.workflow_id
      && current.run_number === selected.run_number && current.run_attempt === selected.run_attempt
      && current.status === 'completed' && current.conclusion === 'success',
      'Latest exact main CI must be successful and unchanged');
  };
  assert(selected.status === 'completed' && selected.conclusion === 'success',
    'Latest exact main CI must be successful');
  confirm();

  const artifacts = inventory(api(base + '/runs/' + selected.id + '/artifacts?per_page=100', true), 'artifacts');
  const outputs = { sha, version, ci_run_id: String(selected.id) };
  for (const role of roles) {
    const name = 'lab-icons-' + role + '-' + sha;
    const matches = artifacts.filter(artifact => artifact.name === name);
    assert.equal(matches.length, 1, 'Missing or ambiguous CI artifact: ' + role);
    const artifact = matches[0], origin = artifact.workflow_run;
    assert(artifact.expired === false && positive(artifact.size_in_bytes)
      && /^sha256:[0-9a-f]{64}$/.test(artifact.digest ?? '')
      && origin?.id === selected.id && origin.repository_id === repositoryId
      && origin.head_repository_id === repositoryId && origin.head_branch === 'main'
      && origin.head_sha === sha, 'Unavailable or foreign CI artifact: ' + role);
    outputs[role + '_artifact'] = String(artifact.id);
  }
  confirm();
  return outputs;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outputs = resolveReleaseSource({
    repository: process.env.GITHUB_REPOSITORY,
    repositoryId: Number(process.env.GITHUB_REPOSITORY_ID),
    ref: process.env.GITHUB_REF,
    sha: process.env.GITHUB_SHA,
  });
  appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(outputs).map(([key, value]) => key + '=' + value + '\n').join(''));
}
