import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { publishReleaseAssets } from './publish-release-assets.mjs';

function fixture(t, { draft = true, absent = false, missing = [], failUpload = false,
  incompleteList = false, duplicate = false, lostPublish = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'icons-release-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dist = join(root, 'dist'), notes = join(root, 'notes.md');
  mkdirSync(dist); writeFileSync(notes, 'Release notes');
  const names = ['SHA256SUMS.txt', 'lab-icons-catalog-0.4.0.zip', 'lab-icons-compose-maven-0.4.0.zip'];
  names.forEach(name => writeFileSync(join(dist, name), name));
  const makeAsset = (name, id) => {
    const bytes = readFileSync(join(dist, name));
    return { name, id, state: 'uploaded', size: bytes.length,
      digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') };
  };
  let release = absent ? null : { id: 8, tag_name: 'v0.4.0', draft, prerelease: false,
    assets: names.filter(name => !missing.includes(name)).map((name, i) => makeAsset(name, i + 1)) };
  let next = 20;
  const mutations = [];
  const base = 'repos/Labpics-Team/lab-icons/releases';
  const data = v => Buffer.from(JSON.stringify(v));
  const gh = args => {
    if (args[0] === 'api' && args[1] === base + '?per_page=100') {
      assert.deepEqual(args.slice(2), ['--paginate', '--slurp']);
      if (incompleteList) throw new Error('incomplete API read');
      return data([[], release ? [release, ...(duplicate ? [{ ...release, id: 9 }] : [])] : []]);
    }
    if (args[0] === 'api' && args[1] === base + '/8') return data(release);
    if (args[0] === 'release' && args[1] === 'create') {
      assert.equal(release, null); assert(args.includes('--draft')); assert(args.includes('--verify-tag'));
      mutations.push('create draft'); release = { id: 8, tag_name: 'v0.4.0', draft: true, prerelease: false, assets: [] };
    } else if (args.includes('DELETE')) {
      assert(release.draft); mutations.push('delete starter');
      release.assets = release.assets.filter(a => !args.at(-1).endsWith('/' + a.id));
    } else if (args[0] === 'release' && args[1] === 'upload') {
      assert(release.draft); assert(!args.includes('--clobber')); mutations.push('upload ' + basename(args[3]));
      if (failUpload) throw new Error('upload interrupted');
      release.assets.push(makeAsset(basename(args[3]), next++));
    } else if (args.includes('PATCH')) {
      assert.deepEqual(args, ['api', '--method', 'PATCH', base + '/8', '-F', 'draft=false']);
      assert(release.draft); assert.equal(release.assets.length, names.length);
      mutations.push('publish'); if (!lostPublish) release.draft = false;
    } else throw new Error('unexpected command ' + JSON.stringify(args));
    return Buffer.from('');
  };
  return { get release() { return release; }, mutations, names,
    run: () => publishReleaseAssets('v0.4.0', dist, notes, 'Labpics-Team/lab-icons', gh) };
}

test('published complete release is verified without mutation', t => {
  const f = fixture(t, { draft: false }); f.run(); assert.deepEqual(f.mutations, []);
});
test('new release is invisible until the complete asset set is verified', t => {
  const f = fixture(t, { absent: true }); f.run();
  assert.deepEqual(f.mutations, ['create draft', ...f.names.map(name => 'upload ' + name), 'publish']);
  assert.equal(f.release.draft, false);
  f.run(); assert.equal(f.mutations.length, 5);
});
test('matching uploaded assets are never reuploaded', t => {
  const f = fixture(t); f.run(); assert.deepEqual(f.mutations, ['publish']);
});
test('a failed empty starter upload is removed and resumed only in draft', t => {
  const f = fixture(t); f.release.assets[1].state = 'starter'; f.release.assets[1].size = 0;
  f.run(); assert.deepEqual(f.mutations, ['delete starter', 'upload ' + f.names[1], 'publish']);
});
test('conflicting bytes reject every mutation even with recoverable starter', t => {
  const f = fixture(t); f.release.assets[0].state = 'starter'; f.release.assets[0].size = 0;
  f.release.assets[2].digest = 'sha256:different';
  assert.throws(f.run, /Immutable release asset differs/); assert.deepEqual(f.mutations, []);
});
test('published incomplete releases are not repaired or reopened', t => {
  const f = fixture(t, { draft: false, missing: ['SHA256SUMS.txt'] });
  assert.throws(f.run, /Published release is incomplete/); assert.deepEqual(f.mutations, []);
});
test('unknown, duplicate or nonempty starter assets cannot become publishable', t => {
  for (const mutate of [
    r => r.assets.push({ ...r.assets[0], id: 7, name: 'other.zip' }),
    r => r.assets.push({ ...r.assets[0], id: 7 }),
    r => { r.assets[0].state = 'starter'; },
  ]) {
    const f = fixture(t); mutate(f.release);
    assert.throws(f.run); assert.deepEqual(f.mutations, []);
  }
});
test('failed or ambiguous inventory does not become an absent release', t => {
  for (const options of [{ absent: true, incompleteList: true }, { duplicate: true }]) {
    const f = fixture(t, options); assert.throws(f.run); assert.deepEqual(f.mutations, []);
  }
});
test('interrupted upload retains draft and cannot publish partial release', t => {
  const f = fixture(t, { absent: true, failUpload: true });
  assert.throws(f.run, /upload interrupted/); assert.equal(f.release.draft, true);
  assert.deepEqual(f.mutations, ['create draft', 'upload ' + f.names[0]]);
});
test('publication must be confirmed by reading the same complete release', t => {
  const f = fixture(t, { lostPublish: true });
  assert.throws(f.run, /publication was not confirmed/); assert.equal(f.release.draft, true);
});
