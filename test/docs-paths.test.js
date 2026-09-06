import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, auditRepo, documentationFiles, documentationLinkErrors, writePackageReference } from '../scripts/check-docs-drift.js';

function fixture(run) {
  const parent = mkdtempSync(join(tmpdir(), 'icons-doc-boundary-'));
  const root = join(parent, 'repo');
  const outside = join(parent, 'outside');
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'release'));
    mkdirSync(outside);
    for (const file of ['package.json', 'release/contract.json', 'docs/package.md']) {
      cpSync(join(ROOT, file), join(root, file));
    }
    writeFileSync(join(root, 'README.md'), '# Пакет\n');
    writeFileSync(join(outside, 'package.md'), 'Не изменять\n');
    expect(auditRepo(root).errors).toEqual([]);
    run(root, outside);
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

describe('единая файловая граница чтения и записи документации', () => {
  for (const path of ['docs', 'docs/nested', 'docs/package.md', 'README.md']) {
    it(`отвергает ссылку ${path} до чтения и записи`, () => fixture((root, outside) => {
      rmSync(join(root, path), { recursive: true, force: true });
      // Junction доступен на Windows без права создания file-symlink.
      symlinkSync(outside, join(root, path), process.platform === 'win32' ? 'junction' : 'dir');
      for (const operation of [documentationFiles, auditRepo, writePackageReference]) {
        expect(() => operation(root)).toThrow(/symlink|каталог/);
        expect(readdirSync(outside)).toEqual(['package.md']);
        expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
      }
    }));
  }

  it('проверяет real path Markdown-ссылок и изображений, а не только лексический путь', () => fixture((root, outside) => {
    writeFileSync(join(outside, 'target.md'), '# Внешний файл\n');
    writeFileSync(join(outside, 'pixel.png'), 'not an image');
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

    const source = '[внешний документ](escape/target.md)\n\n![внешнее изображение](escape/pixel.png)';
    const errors = documentationLinkErrors(root, 'README.md', source);
    expect(errors).toHaveLength(2);
    expect(errors.every((error) => error.includes('через symlink') && error.includes('за пределами checkout'))).toBe(true);

    writeFileSync(join(root, 'README.md'), '# Пакет\n\n' + source);
    const auditErrors = auditRepo(root).errors;
    expect(auditErrors.some((error) => error.includes('escape/target.md'))).toBe(true);
    expect(auditErrors.some((error) => error.includes('escape/pixel.png'))).toBe(true);
  }));

  it('разрешает symlink-цель, если её real path остаётся внутри checkout', () => fixture((root) => {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'inside.md'), '# Внутри\n');
    symlinkSync(join(root, 'assets'), join(root, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(documentationLinkErrors(root, 'README.md', '[внутри](inside-link/inside.md)')).toEqual([]);
  }));

  it('не принимает обычный файл вместо каталога docs', () => fixture((root, outside) => {
    rmSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs'), 'не каталог');
    for (const operation of [documentationFiles, auditRepo, writePackageReference]) {
      expect(() => operation(root)).toThrow(/каталог/);
    }
    expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
  }));

  it('после отказа нормальный каталог снова допускает генерацию', () => fixture((root, outside) => {
    rmSync(join(root, 'docs'), { recursive: true });
    symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => writePackageReference(root)).toThrow(/symlink|каталог/);
    rmSync(join(root, 'docs'));
    mkdirSync(join(root, 'docs'));
    writePackageReference(root);
    expect(auditRepo(root).errors).toEqual([]);
    expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
  }));
});
