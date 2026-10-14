import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ROOT, auditRepo } from '../../scripts/check-docs-drift.js';

export const it = test.extend({
  workspace: async ({}, use) => {
    const workspace = mkdtempSync(join(tmpdir(), 'icons-docs-'));
    try {
      await use(workspace);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  },
  root: async ({ workspace }, use) => {
    const root = join(workspace, 'repo');
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'release'));
    for (const path of ['package.json', 'release/contract.json', 'docs/package.md']) {
      cpSync(join(ROOT, path), join(root, path));
    }
    writeFileSync(join(root, 'README.md'), '# Пакет\n');
    expect(auditRepo(root).errors).toEqual([]);
    await use(root);
  },
  outside: async ({ workspace }, use) => {
    const outside = join(workspace, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'package.md'), 'Не изменять\n');
    await use(outside);
  },
});
