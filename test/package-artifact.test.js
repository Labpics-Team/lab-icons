import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCleanPackSource,
  localTarballSpecifier,
  mutateExportWithEscapedFillRule,
  mutateExportWithHalfCanvasClip,
  mutateExportWithNestedSvgViewport,
  mutateExportWithoutRootAttribute,
  mutateFirstPathCoordinate,
  pnpmInvocation,
  shouldCopyCleanPackPath,
  validateInstalledPackage,
} from '../scripts/check-package-artifact.js';

const roots = [];
const CONTRACT = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));

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
      version: '0.2.0',
      private: false,
      main: './dist/index.js',
      module: './dist/index.js',
      types: './dist/index.d.ts',
      publishConfig: { access: 'public' },
      sideEffects: false,
      files: CONTRACT.files,
      exports: CONTRACT.exports,
    })}\n`,
  );
  write(root, 'README.md', '# fixture\n');
  write(root, 'LICENSE', 'MIT\n');
  write(root, 'dist/index.js', 'export const accessibilityOutline = `<svg/>`;\n');
  write(root, 'dist/index.d.ts', 'export declare const accessibilityOutline: string;\n');
  write(root, 'dist/ir/index.js', 'export const iconIds = []; export const glyph = () => ({});\n');
  write(root, 'dist/ir/index.d.ts', 'export declare const iconIds: readonly string[]; export declare function glyph(): unknown;\n');
  write(root, 'dist/ir/recipes.js', 'export const buildDirectionalArrow = () => ({});\n');
  write(root, 'dist/ir/recipes.d.ts', 'export declare function buildDirectionalArrow(): unknown;\n');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('check-package-artifact', () => {
  it('строит pack из source-only копии и не переносит грязный dist', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'lab-icons-clean-pack-fixture-'));
    roots.push(fixture);
    const source = join(fixture, 'repo');
    const clean = join(fixture, 'clean');
    write(source, 'package.json', '{"name":"fixture"}\n');
    write(source, 'scripts/build.js', 'export {};\n');
    write(source, '.git/config', '[core]\n');
    write(source, 'dist/index.js', 'export const stale = true;\n');
    write(source, 'node_modules/.pnpm/tooling-sentinel', 'installed tooling\n');
    write(source, 'preview/debug.html', '<p>debug</p>\n');
    write(source, 'stale.tgz', 'not a package\n');

    createCleanPackSource(source, clean);

    expect(existsSync(join(clean, 'package.json'))).toBe(true);
    expect(existsSync(join(clean, 'scripts/build.js'))).toBe(true);
    expect(existsSync(join(clean, '.git'))).toBe(false);
    expect(existsSync(join(clean, 'dist'))).toBe(false);
    expect(existsSync(join(clean, 'preview'))).toBe(false);
    expect(existsSync(join(clean, 'stale.tgz'))).toBe(false);
    expect(lstatSync(join(clean, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(clean, 'node_modules/.pnpm/tooling-sentinel'), 'utf8')).toBe(
      'installed tooling\n',
    );
  });

  it('отсекает denylist для namespaced Windows paths и fail-closed при смешении namespaces', () => {
    const root = 'D:\\a\\lab-icons\\lab-icons';
    const copyRoot = win32.toNamespacedPath(root);
    const inside = (path) => win32.toNamespacedPath(win32.join(root, path));

    for (const excluded of [
      '.git/config',
      '.treeshake-tmp/probe.js',
      'coverage/index.html',
      'demo/index.html',
      'dist/index.js',
      'node_modules/.pnpm/tool',
      'preview/debug.html',
      'tmp/probe.txt',
    ]) {
      expect(shouldCopyCleanPackPath(copyRoot, inside(excluded), win32)).toBe(false);
    }
    expect(shouldCopyCleanPackPath(copyRoot, inside('scripts/build.js'), win32)).toBe(true);
    expect(() => shouldCopyCleanPackPath(root, inside('dist/index.js'), win32)).toThrow(
      'путь filter вне clean source root',
    );
  });

  it('принимает минимальный публичный артефакт', () => {
    const result = validateInstalledPackage(validPackage(), CONTRACT);
    expect(result.errors).toEqual([]);
    expect(result.files).toContain('dist/ir/index.js');
  });

  it('кусается на утечке исходников и производного корпуса', () => {
    const root = validPackage();
    write(root, 'src/private.ts', 'export {};\n');
    write(root, 'dist/svg/Outline/private.svg', '<svg/>\n');
    const errors = validateInstalledPackage(root, CONTRACT).errors;
    expect(errors).toContain('tarball содержит файл вне exact allowlist: src/private.ts');
    expect(errors).toContain('tarball содержит файл вне exact allowlist: dist/svg/Outline/private.svg');
  });

  it('кусается на рассинхроне exports с физическими файлами', () => {
    const root = validPackage();
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    pkg.exports['.'].import = './dist/missing.js';
    write(root, 'package.json', `${JSON.stringify(pkg)}\n`);
    expect(validateInstalledPackage(root, CONTRACT).errors).toContain(
      'package.json#exports дрейфует от release contract',
    );
  });

  it('кусается на любом stale-файле, даже внутри разрешённого dist-каталога', () => {
    const root = validPackage();
    write(root, 'dist/ir/index.js.map', '{}\n');
    expect(validateInstalledPackage(root, CONTRACT).errors).toContain(
      'tarball содержит файл вне exact allowlist: dist/ir/index.js.map',
    );
  });

  it('кусается на встроенной sourcemap metadata без отдельного .map-файла', () => {
    const root = validPackage();
    write(root, 'dist/ir/recipes.js', '//# sourceMappingURL=data:application/json;base64,e30=\n');
    expect(validateInstalledPackage(root, CONTRACT).errors).toContain(
      'dist/ir/recipes.js содержит sourcemap/sourcesContent metadata',
    );
  });

  it('hostile mutation меняет координату, но не command topology', () => {
    const source = 'export const accessibilityOutline = `<svg><path d="M19.85 6.22L2 3Z"/></svg>`;\n';
    const mutated = mutateFirstPathCoordinate(source);
    expect(mutated).toContain('d="M19.851 6.22L2 3Z"');
    expect(mutated.match(/[MLZ]/g)).toEqual(source.match(/[MLZ]/g));
  });

  it('hostile clip меняет отображение, не меняя ни одной d-строки корпуса', () => {
    const source = 'export const accessibilityOutline = `<svg viewBox="0 0 24 24"><path d="M0 0H24V24H0Z"/></svg>`;\n';
    const mutated = mutateExportWithHalfCanvasClip(source);
    expect(mutated).toContain('clip-path="url(#hostile-half)"');
    expect(mutated).toContain('<path d="M0 0H12V24H0Z"/>');
    expect(mutated.match(/M0 0H24V24H0Z/g)).toHaveLength(1);
  });

  it('hostile nested viewport масштабирует те же d-строки', () => {
    const source = 'export const accessibilityOutline = `<svg viewBox="0 0 24 24"><path d="M0 0H24V24H0Z"/></svg>`;\n';
    const mutated = mutateExportWithNestedSvgViewport(source);
    expect(mutated).toContain('<svg viewBox="0 0 48 48" width="24" height="24">');
    expect(mutated.match(/M0 0H24V24H0Z/g)).toHaveLength(1);
    expect(mutated.match(/<svg\b/g)).toHaveLength(2);
  });

  it('hostile CSS escape меняет fill-rule, сохраняя d байт-в-байт', () => {
    const source = 'export const accessibilityOutline = `<svg><path d="M0 0H24V24H0Z"/></svg>`;\n';
    const mutated = mutateExportWithEscapedFillRule(source);
    expect(mutated).toContain('fill-rule="\\\\65 venodd"');
    expect(mutated.match(/M0 0H24V24H0Z/g)).toHaveLength(1);
  });

  it.each([
    ['fill', 'fill="currentColor"'],
    ['width', 'width="24"'],
    ['height', 'height="24"'],
    ['viewBox', 'viewBox="0 0 24 24"'],
  ])('hostile root mutation удаляет только канонический %s', (attribute, literal) => {
    const source =
      'export const accessibilityOutline = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor"><path fill="currentColor" d="M0 0H24V24H0Z"/></svg>`;\n';
    const mutated = mutateExportWithoutRootAttribute(source, attribute);
    const rootOpening = mutated.match(/<svg[^>]*>/)?.[0];

    expect(rootOpening).toBeDefined();
    expect(rootOpening).not.toContain(literal);
    expect(mutated).toContain('<path fill="currentColor" d="M0 0H24V24H0Z"/>');
    expect(mutated.match(/M0 0H24V24H0Z/g)).toEqual(source.match(/M0 0H24V24H0Z/g));
  });

  it('не изображает hostile bite, если root literal уже неканоничен', () => {
    const source =
      'export const accessibilityOutline = `<svg viewBox="0 0 24 24" width="23" height="24" fill="currentColor"><path d="M0 0H24V24H0Z"/></svg>`;\n';

    expect(() => mutateExportWithoutRootAttribute(source, 'width')).toThrow(
      'root не содержит literal width="24"',
    );
  });

  it('строит относительный file specifier без URL-кодирования DOS 8.3 пути', () => {
    const specifier = localTarballSpecifier(
      'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\consumer',
      'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pack\\labpics-icons-0.2.0.tgz',
      () => '..\\pack\\labpics-icons-0.2.0.tgz',
    );

    expect(specifier).toBe('file:../pack/labpics-icons-0.2.0.tgz');
    expect(specifier).not.toContain('%7E');
  });

  it('на POSIX запускает pnpm напрямую без shell', () => {
    expect(
      pnpmInvocation(['pack', '--pack-destination', '/tmp/out'], {
        platform: 'linux',
        command: '/opt/pnpm',
      }),
    ).toEqual({
      file: '/opt/pnpm',
      args: ['pack', '--pack-destination', '/tmp/out'],
    });
  });

  it('на Windows запускает pnpm.cmd через ComSpec, не через shell:true', () => {
    expect(
      pnpmInvocation(['install', '--offline'], {
        platform: 'win32',
        command: 'pnpm.cmd',
        comspec: 'C:\\Windows\\System32\\cmd.exe',
      }),
    ).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd', 'install', '--offline'],
    });
  });
});
