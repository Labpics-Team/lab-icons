import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const validId = id => Number.isSafeInteger(id) && id > 0;
const json = bytes => JSON.parse(bytes.toString('utf8'));

// A published release is a terminal state, not another upload target.
// Only a draft may acquire assets; only a complete verified draft is published.
export function publishReleaseAssets(tag, directory, notesFile, repository, gh = args => execFileSync('gh', args, {
  windowsHide: true, maxBuffer: 256 * 1024 * 1024,
})) {
  assert(/^v\d+\.\d+\.\d+$/.test(tag ?? '') && directory && notesFile,
    'Usage: publish-release-assets.mjs vX.Y.Z directory notes-file');
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''), 'GITHUB_REPOSITORY is required');
  assert(lstatSync(notesFile).isFile(), 'Release notes must be a regular file');
  const root = resolve(directory), version = tag.slice(1);
  const files = readdirSync(root).sort();
  assert.deepEqual(files, ['SHA256SUMS.txt', 'lab-icons-catalog-' + version + '.zip', 'lab-icons-compose-maven-' + version + '.zip'], 'Unexpected release file set');
  const entries = new Map(files.map(name => {
    const file = join(root, name);
    const stat = lstatSync(file);
    assert(stat.isFile(), 'Unexpected release entry: ' + name);
    return [name, { file, size: stat.size, digest: hash(readFileSync(file)) }];
  }));
  const base = 'repos/' + repository + '/releases';
  const inspect = id => {
    const release = json(gh(['api', base + '/' + id]));
    assert(validId(id) && release.id === id && release.tag_name === tag
      && typeof release.draft === 'boolean' && release.prerelease === false,
      'Release identity or state differs');
    return release;
  };
  // The tag endpoint only promises published releases. Paginated listing also
  // finds drafts and distinguishes no release from a failed read.
  const find = () => {
    const pages = json(gh(['api', base + '?per_page=100', '--paginate', '--slurp']));
    assert(Array.isArray(pages) && pages.every(Array.isArray), 'Incomplete release inventory');
    const matches = pages.flat().filter(release => release.tag_name === tag);
    assert(matches.length <= 1, 'Ambiguous release identity');
    if (!matches.length) return null;
    assert(validId(matches[0].id), 'Invalid release ID');
    return inspect(matches[0].id);
  };
  const publishedHash = asset => asset.digest?.startsWith('sha256:')
    ? asset.digest.slice(7)
    : hash(gh(['api', base + '/assets/' + asset.id, '-H', 'Accept: application/octet-stream']));
  function verify(release) {
    assert(Array.isArray(release.assets), 'Missing release asset inventory');
    const existing = new Map(), ids = new Set();
    for (const asset of release.assets) {
      const expected = entries.get(asset.name);
      assert(expected && validId(asset.id) && !ids.has(asset.id) && !existing.has(asset.name),
        'Unexpected or duplicate release asset: ' + asset.name);
      ids.add(asset.id);
      if (asset.state === 'starter') {
        assert(release.draft && asset.size === 0, 'Starter recovery requires an empty draft asset');
      } else {
        assert.equal(asset.state, 'uploaded', 'Unexpected release asset state: ' + asset.name);
        assert.equal(asset.size, expected.size, 'Release asset size differs: ' + asset.name);
        assert.equal(publishedHash(asset), expected.digest, 'Immutable release asset differs: ' + asset.name);
      }
      existing.set(asset.name, asset);
    }
    const complete = files.every(name => existing.get(name)?.state === 'uploaded');
    if (!release.draft) assert(complete, 'Published release is incomplete; use a new version');
    return { existing, complete };
  }

  let release = find();
  if (release === null) {
    gh(['release', 'create', tag, '--draft', '--verify-tag', '--title', 'Lab Icons ' + version,
      '--notes-file', resolve(notesFile), '--repo', repository]);
    release = find();
    assert(release?.draft, 'New release must be an identifiable draft');
  }
  const id = release.id;
  verify(release);
  if (!release.draft) return;
  for (const [name, entry] of entries) {
    release = inspect(id);
    assert(release.draft, 'Release changed before draft upload');
    const { existing } = verify(release);
    const asset = existing.get(name);
    if (asset?.state === 'uploaded') continue;
    if (asset?.state === 'starter') {
      gh(['api', '--method', 'DELETE', base + '/assets/' + asset.id]);
      release = inspect(id);
      assert(release.draft && !verify(release).existing.has(name), 'Draft asset recovery did not complete');
    }
    gh(['release', 'upload', tag, entry.file, '--repo', repository]);
    const readback = inspect(id);
    assert(readback.draft && verify(readback).existing.get(name)?.state === 'uploaded',
      'Draft upload was not confirmed: ' + name);
  }
  release = inspect(id);
  assert(release.draft && verify(release).complete, 'Release draft is not complete');
  gh(['api', '--method', 'PATCH', base + '/' + id, '-F', 'draft=false']);
  release = inspect(id);
  assert(!release.draft && verify(release).complete, 'Release publication was not confirmed');
  console.log('Published complete release: ' + tag);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishReleaseAssets(...process.argv.slice(2), process.env.GITHUB_REPOSITORY);
}
