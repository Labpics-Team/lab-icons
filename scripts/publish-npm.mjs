import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function readNpmArtifact(directory, version, sourceSha) {
  assert(/^\d+\.\d+\.\d+$/.test(version) && /^[a-f0-9]{40}$/.test(sourceSha), 'Expected release identity is required');
  const root = resolve(directory), tarball = join(root, 'package.tgz');
  assert(lstatSync(tarball).isFile() && lstatSync(join(root, 'source.json')).isFile(), 'Expected regular package artifacts');
  const bytes = readFileSync(tarball), source = JSON.parse(readFileSync(join(root, 'source.json')));
  assert.equal(source.sourceSha, sourceSha, 'CI artifact belongs to another commit');
  assert.equal(source.name, '@labpics/icons');
  assert.equal(source.version, version);
  assert.equal(source.sha256, createHash('sha256').update(bytes).digest('hex'), 'CI artifact SHA-256 differs');
  assert.equal(source.integrity, 'sha512-' + createHash('sha512').update(bytes).digest('base64'), 'CI artifact integrity differs');
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { windowsHide: true }));
  assert.equal(manifest.name, source.name, 'Packed package name differs');
  assert.equal(manifest.version, version, 'Packed package version differs');
  assert.equal(manifest.repository?.url, 'git+https://github.com/Labpics-Team/lab-icons.git', 'Packed repository differs');
  return { ...source, tarball };
}

export async function publishNpmArtifact(artifact, { readRegistry = async () => {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(artifact.name)}/${artifact.version}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  assert(response.ok, `npm registry returned ${response.status}`);
  return response.json();
}, publish = () => execFileSync('npm', ['publish', artifact.tarball, '--access', 'public', '--provenance', '--ignore-scripts'], {
  stdio: 'inherit', windowsHide: true,
}) } = {}) {
  const verify = published => {
    assert(published, 'Published npm version is absent');
    assert.equal(published.name, artifact.name);
    assert.equal(published.version, artifact.version);
    assert.equal(published.dist?.integrity, artifact.integrity, 'Immutable npm version differs from the tested artifact');
  };
  const previous = await readRegistry();
  if (previous) verify(previous);
  else publish();
  verify(await readRegistry());
  console.log(`npm ${artifact.name}@${artifact.version}: tested tarball integrity confirmed`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, version, sourceSha] = process.argv.slice(2);
  assert.equal(process.env.GITHUB_SHA, sourceSha, 'npm provenance must refer to the tested source commit');
  assert(process.env.ACTIONS_ID_TOKEN_REQUEST_URL, 'npm release requires GitHub Actions OIDC');
  await publishNpmArtifact(readNpmArtifact(directory, version, sourceSha));
}
