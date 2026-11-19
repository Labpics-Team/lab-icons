import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function uploadReleaseAssets(tag, directory, repository, gh = args => execFileSync('gh', args, {
  windowsHide: true, maxBuffer: 256 * 1024 * 1024,
})) {
  assert(/^v\d+\.\d+\.\d+$/.test(tag ?? '') && directory, 'Usage: upload-release-assets.mjs vX.Y.Z directory');
  assert(/^[\w.-]+\/[\w.-]+$/.test(repository ?? ''), 'GITHUB_REPOSITORY is required');
  const root = resolve(directory), version = tag.slice(1);
  const files = readdirSync(root).sort();
  assert.deepEqual(files, ['SHA256SUMS.txt', `lab-icons-catalog-${version}.zip`, `lab-icons-compose-maven-${version}.zip`], 'Unexpected release file set');
  const publishedHash = asset => asset.digest?.startsWith('sha256:') ? asset.digest.slice(7)
    : hash(gh(['api', `repos/${repository}/releases/assets/${asset.id}`, '-H', 'Accept: application/octet-stream']));
  const release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]).toString('utf8'));
  // Validate every immutable entry before changing the release.
  const entries = files.map(name => {
    const file = join(root, name);
    assert(lstatSync(file).isFile(), `Unexpected release entry: ${name}`);
    const digest = hash(readFileSync(file)), existing = release.assets.find(asset => asset.name === name);
    if (existing && existing.state !== 'starter') {
      assert.equal(existing.state, 'uploaded', `Unexpected release asset state: ${name}`);
      assert.equal(publishedHash(existing), digest, `Immutable release asset differs: ${name}`);
    }
    return { name, file, digest, existing };
  });
  for (const { name, file, existing } of entries) {
    if (existing?.state === 'uploaded') continue;
    // GitHub documents starter as the empty remnant of a failed upload (e.g. 502).
    if (existing?.state === 'starter') gh(['api', '--method', 'DELETE', `repos/${repository}/releases/assets/${existing.id}`]);
    gh(['release', 'upload', tag, file, '--repo', repository]);
    console.log(`Published: ${name}`);
  }
  const published = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]).toString('utf8'));
  for (const { name, digest } of entries) {
    const asset = published.assets.find(asset => asset.name === name);
    assert.equal(asset?.state, 'uploaded', `Release asset is not uploaded: ${name}`);
    assert.equal(publishedHash(asset), digest, `Published release asset differs: ${name}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  uploadReleaseAssets(...process.argv.slice(2), process.env.GITHUB_REPOSITORY);
}
