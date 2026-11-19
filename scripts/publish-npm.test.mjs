import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNpmArtifact, publishNpmArtifact } from './publish-npm.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'icons-npm-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'package'));
  const manifest = { name: '@labpics/icons', version: '0.4.0', repository: { url: 'git+https://github.com/Labpics-Team/lab-icons.git' } };
  writeFileSync(join(root, 'package/package.json'), JSON.stringify(manifest));
  execFileSync('tar', ['-czf', join(root, 'package.tgz'), '-C', root, 'package'], { windowsHide: true });
  const bytes = readFileSync(join(root, 'package.tgz'));
  const source = { name: manifest.name, version: manifest.version, sourceSha: 'a'.repeat(40),
    sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
  writeFileSync(join(root, 'source.json'), JSON.stringify(source));
  return { root, source, read: () => readNpmArtifact(root, '0.4.0', source.sourceSha) };
}
test('release accepts the exact tested tarball and source commit', t => {
  const f = fixture(t); assert.equal(f.read().integrity, f.source.integrity);
  assert.throws(() => readNpmArtifact(f.root, '0.4.0', 'b'.repeat(40)), /another commit/);
});
test('a changed tarball is rejected before publication', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'package.tgz'), 'different');
  assert.throws(f.read, /SHA-256 differs/);
});
test('a lost successful npm response can be resumed without republishing', async t => {
  const artifact = fixture(t).read();
  await publishNpmArtifact(artifact, { readRegistry: async () => ({ name: artifact.name, version: artifact.version, dist: { integrity: artifact.integrity } }),
    publish: () => assert.fail('An existing matching version must not be published again') });
});
test('an existing different npm version cannot be overwritten', async t => {
  const artifact = fixture(t).read();
  await assert.rejects(publishNpmArtifact(artifact, { readRegistry: async () => ({ name: artifact.name, version: artifact.version, dist: { integrity: 'sha512:other' } }),
    publish: () => assert.fail('An existing different version must not be published again') }), /Immutable npm version differs/);
});
test('publication checks the resulting registry bytes', async t => {
  const artifact = fixture(t).read(); let published = false;
  await publishNpmArtifact(artifact, { readRegistry: async () => published ? { name: artifact.name, version: artifact.version, dist: { integrity: artifact.integrity } } : null,
    publish: () => { published = true; } });
  assert(published);
});
