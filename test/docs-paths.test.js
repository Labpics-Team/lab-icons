import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect } from 'vitest';
import { it } from './fixtures/documentation.js';
import { auditRepo, documentationFiles, documentationLinkErrors, writePackageReference } from '../scripts/check-docs-drift.js';

describe('Границы файлов документации', () => {
  for (const path of ['docs', 'docs/nested', 'docs/package.md', 'README.md']) {
    it(`отвергает ссылку ${path} до чтения и записи`, ({ root, outside }) => {
      rmSync(join(root, path), { recursive: true, force: true });
      // Junction доступен на Windows без права создания file-symlink.
      symlinkSync(outside, join(root, path), process.platform === 'win32' ? 'junction' : 'dir');
      for (const operation of [documentationFiles, auditRepo, writePackageReference]) {
        expect(() => operation(root)).toThrow(/symlink|каталог/);
        expect(readdirSync(outside)).toEqual(['package.md']);
        expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
      }
    });
  }

  it('отклоняет ссылки и изображения за пределами рабочей копии', ({ root, outside }) => {
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
  });

  it('разрешает символическую ссылку внутри рабочей копии', ({ root }) => {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'inside.md'), '# Внутри\n');
    symlinkSync(join(root, 'assets'), join(root, 'inside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(documentationLinkErrors(root, 'README.md', '[внутри](inside-link/inside.md)')).toEqual([]);
  });

  it('отклоняет обычный файл вместо каталога документации', ({ root, outside }) => {
    rmSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs'), 'не каталог');
    for (const operation of [documentationFiles, auditRepo, writePackageReference]) {
      expect(() => operation(root)).toThrow(/каталог/);
    }
    expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
  });

  it('возобновляет генерацию после восстановления каталога', ({ root, outside }) => {
    rmSync(join(root, 'docs'), { recursive: true });
    symlinkSync(outside, join(root, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => writePackageReference(root)).toThrow(/symlink|каталог/);
    rmSync(join(root, 'docs'));
    mkdirSync(join(root, 'docs'));
    writePackageReference(root);
    expect(auditRepo(root).errors).toEqual([]);
    expect(readFileSync(join(outside, 'package.md'), 'utf8')).toBe('Не изменять\n');
  });
});
