import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  recoverOwnedDirectory,
  replaceOwnedDirectory,
} from '../scripts/lib/owned-directory.js';

const roots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-owned-directory-'));
  roots.push(root);
  const output = join(root, 'ir');
  const staging = join(root, '.ir-build');
  const backup = join(root, '.ir-previous');
  mkdirSync(output);
  mkdirSync(staging);
  writeFileSync(join(output, 'value'), 'old');
  writeFileSync(join(staging, 'value'), 'new');
  return { root, output, staging, backup };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('owned directory transaction', () => {
  it('устанавливает доказанный staging и удаляет backup', () => {
    const paths = fixture();
    replaceOwnedDirectory(paths);
    expect(readFileSync(join(paths.output, 'value'), 'utf8')).toBe('new');
    expect(existsSync(paths.staging)).toBe(false);
    expect(existsSync(paths.backup)).toBe(false);
  });

  it('после crash между rename возвращает старый output', () => {
    const paths = fixture();
    rmSync(paths.staging, { recursive: true });
    renameSync(paths.output, paths.backup);

    expect(recoverOwnedDirectory(paths)).toBe('rolled-back');
    expect(readFileSync(join(paths.output, 'value'), 'utf8')).toBe('old');
    expect(existsSync(paths.backup)).toBe(false);
  });

  it('при ошибке установки немедленно откатывает прежний output', () => {
    const paths = fixture();
    let calls = 0;
    const fs = {
      existsSync,
      rmSync,
      renameSync(from, to) {
        calls += 1;
        if (calls === 2) throw new Error('hostile rename failure');
        renameSync(from, to);
      },
    };

    expect(() => replaceOwnedDirectory({ ...paths, fs })).toThrow('hostile rename failure');
    expect(readFileSync(join(paths.output, 'value'), 'utf8')).toBe('old');
    expect(readFileSync(join(paths.staging, 'value'), 'utf8')).toBe('new');
    expect(existsSync(paths.backup)).toBe(false);
  });
});
