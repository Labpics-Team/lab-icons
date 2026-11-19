import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { uploadReleaseAssets } from './upload-release-assets.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'icons-release-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = ['SHA256SUMS.txt', 'lab-icons-catalog-0.4.0.zip', 'lab-icons-compose-maven-0.4.0.zip'];
  const digest = name => 'sha256:' + createHash('sha256').update(readFileSync(join(root, name))).digest('hex');
  names.forEach(name => writeFileSync(join(root, name), name));
  let assets = names.map((name, id) => ({ name, id, state: 'uploaded', digest: digest(name) }));
  const mutations = [];
  const gh = args => {
    if (args.includes('DELETE')) { mutations.push(args); assets = assets.filter(a => !args.at(-1).endsWith('/' + a.id)); }
    else if (args[0] === 'release') {
      mutations.push(args);
      const name = basename(args[3]);
      assets.push({ name, id: 50, state: 'uploaded', digest: digest(name) });
    } else return Buffer.from(JSON.stringify({ assets }));
    return Buffer.from('');
  };
  return { assets, mutations, run: () => uploadReleaseAssets('v0.4.0', root, 'Labpics-Team/lab-icons', gh) };
}
test('matching uploaded assets require no mutation', t => {
  const f = fixture(t); f.run(); assert.deepEqual(f.mutations, []);
});
test('a failed starter upload is removed and resumed', t => {
  const f = fixture(t); f.assets[1].state = 'starter'; f.assets[1].digest = 'sha256:empty';
  f.run();
  assert.equal(f.mutations.length, 2);
  assert.equal(f.mutations[0][2], 'DELETE');
  assert.equal(f.mutations[1][1], 'upload');
});
test('an immutable conflict rejects all mutations, including starter cleanup', t => {
  const f = fixture(t); f.assets[0].state = 'starter'; f.assets[2].digest = 'sha256:different';
  assert.throws(f.run, /Immutable release asset differs/);
  assert.deepEqual(f.mutations, []);
});
