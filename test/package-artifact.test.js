import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateInstalledPackage } from '../scripts/check-package-artifact.js';

const roots = [];

function write(root, path, content = '') {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function validPackage() {
  const root = mkdtempSync(join(tmpdir(), 'lab-icons-artifact-fixture-'));
  roots.push(root);
  write(
    root,
    'package.json',
    `${JSON.stringify({
      name: '@labpics/icons',
      sideEffects: false,
      exports: {
        '.': { import: './dist/index.js', types: './dist/index.d.ts' },
        './animate': {
          import: './dist/animate/index.js',
          require: './dist/animate/index.cjs',
          types: './dist/animate/index.d.ts',
        },
      },
    })}\n`,
  );
  write(root, 'README.md', '# fixture\n');
  write(root, 'LICENSE', 'MIT\n');
  write(root, 'dist/index.js', 'export const accessibilityOutline = `<svg/>`;\n');
  write(root, 'dist/index.d.ts', 'export declare const accessibilityOutline: string;\n');
  write(root, 'dist/animate/index.js', 'export const iconClass = () => `spin`;\n');
  write(root, 'dist/animate/index.cjs', 'exports.iconClass = () => `spin`;\n');
  write(root, 'dist/animate/index.d.ts', 'export declare function iconClass(name: string): string;\n');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-package-artifact', () => {
  it('принимает минимальный публичный артефакт', () => {
    const result = validateInstalledPackage(validPackage());
    expect(result.errors).toEqual([]);
    expect(result.files).toContain('dist/animate/index.cjs');
  });

  it('кусается, если CJS-подпуть обещан, но отсутствует', () => {
    const root = validPackage();
    unlinkSync(join(root, 'dist/animate/index.cjs'));
    expect(validateInstalledPackage(root).errors).toContain(
      'в tarball отсутствует dist/animate/index.cjs',
    );
  });

  it('кусается на утечке исходников и производного корпуса', () => {
    const root = validPackage();
    write(root, 'src/private.ts', 'export {};\n');
    write(root, 'dist/svg/Outline/private.svg', '<svg/>\n');
    const errors = validateInstalledPackage(root).errors;
    expect(errors).toContain('tarball содержит внутренний путь src');
    expect(errors).toContain('tarball содержит внутренний путь dist/svg');
  });

  it('кусается на рассинхроне exports с физическими файлами', () => {
    const root = validPackage();
    const pkg = {
      name: '@labpics/icons',
      sideEffects: false,
      exports: {
        '.': { import: './dist/missing.js', types: './dist/index.d.ts' },
        './animate': {
          import: './dist/animate/index.js',
          require: './dist/animate/index.cjs',
          types: './dist/animate/index.d.ts',
        },
      },
    };
    write(root, 'package.json', `${JSON.stringify(pkg)}\n`);
    expect(validateInstalledPackage(root).errors).toContain(
      'root ESM export не указывает на ./dist/index.js',
    );
  });
});
