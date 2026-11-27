import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReleaseSource } from './resolve-release-source.mjs';

const sha = 'a'.repeat(40);
const repository = 'fixture/icons', repositoryId = 12;
const identity = { repository, repositoryId, ref: 'refs/heads/main', sha };
const project = { id: repositoryId, full_name: repository };
const run = (id, number, extra = {}) => ({
  id, run_number: number, run_attempt: 1, workflow_id: 7, event: 'push',
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success',
  repository: project, head_repository: project, head_branch: 'main', head_sha: sha, ...extra,
});
function fixture() {
  const older = run(21, 1), latest = run(22, 2);
  const artifacts = ['compose', 'npm', 'catalog'].map((role, i) => ({
    name: 'lab-icons-' + role + '-' + sha, id: 100 + i, expired: false,
    size_in_bytes: 10, digest: 'sha256:' + 'b'.repeat(64),
    workflow_run: { id: latest.id, repository_id: repositoryId, head_repository_id: repositoryId,
      head_branch: 'main', head_sha: sha },
  }));
  const pages = [{ total_count: 2, workflow_runs: [older] }, { total_count: 2, workflow_runs: [latest] }];
  const current = structuredClone(latest);
  let rereads = 0;
  const api = (path, paginate) => {
    if (path.includes('/workflows/ci.yml/runs?')) {
      assert(paginate && path.includes('head_sha=' + sha) && !path.includes('status=success'));
      return pages;
    }
    if (path.endsWith('/runs/22')) {
      rereads++;
      return current;
    }
    if (path.endsWith('/runs/22/artifacts?per_page=100')) {
      assert(paginate);
      return [{ total_count: artifacts.length, artifacts }];
    }
    throw Error('unexpected API read: ' + path);
  };
  const git = args => {
    if (args[0] === 'rev-parse') return sha;
    if (args[0] === 'merge-base') { assert.deepEqual(args, ['merge-base', '--is-ancestor', sha, 'origin/main']); return ''; }
    if (args[0] === 'show') return JSON.stringify({ version: '0.4.0' });
    throw Error('unexpected git read');
  };
  return { latest, older, artifacts, pages, current, api, git, get rereads() { return rereads; },
    resolve: () => resolveReleaseSource(identity, { api, git }) };
}

test('one exact main run supplies the version and all immutable artifact identities', () => {
  const f = fixture();
  assert.deepEqual(f.resolve(), { sha, version: '0.4.0', ci_run_id: '22',
    compose_artifact: '100', npm_artifact: '101', catalog_artifact: '102' });
  assert.equal(f.rereads, 2);
});
test('a later failed or incomplete CI never falls back to older success', () => {
  for (const state of [{ conclusion: 'failure' }, { status: 'in_progress', conclusion: null }]) {
    const f = fixture(); Object.assign(f.latest, state);
    assert.throws(f.resolve, /Latest exact main CI/);
  }
});
test('foreign run, partial pagination and repeated run identities cannot authorize publication', () => {
  for (const change of [
    f => { f.latest.head_sha = 'c'.repeat(40); },
    f => { f.latest.event = 'pull_request'; },
    f => { f.latest.head_repository = { ...project, id: 99 }; },
    f => { f.pages.pop(); },
    f => { f.latest.id = f.older.id; },
    f => { f.latest.run_number = f.older.run_number; },
  ]) {
    const f = fixture(); change(f);
    assert.throws(f.resolve);
  }
});
test('all required artifacts must exist and belong to the same exact CI run', () => {
  for (const change of [
    f => { f.artifacts.pop(); },
    f => { f.artifacts[1].expired = true; },
    f => { f.artifacts[1].workflow_run.id = 21; },
    f => { f.artifacts[1].workflow_run.head_sha = 'c'.repeat(40); },
    f => { f.artifacts[1].digest = null; },
    f => { f.artifacts.push({ ...f.artifacts[0], id: 104 }); },
  ]) {
    const f = fixture(); change(f);
    assert.throws(f.resolve);
  }
});
test('a changed attempt or checkout cannot authorize publication', () => {
  const f = fixture(); f.current.run_attempt++;
  assert.throws(f.resolve, /unchanged/);
  const g = fixture();
  assert.throws(() => resolveReleaseSource(identity, { api: g.api, git: () => 'c'.repeat(40) }), /Checkout differs/);
  assert.throws(() => resolveReleaseSource({ ...identity, ref: 'refs/heads/other' }, { api: g.api, git: g.git }), /main dispatch/);
});
