// Гейт export-surface: снапшот ловит runtime-дрейф, невидимый для d.ts.
// Фикстурный RED: модуль с утечкой (лишний runtime-экспорт) против снапшота
// без неё обязан валить чекер; совпадение — зелёное.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeExportSurface } from '../scripts/lib/export-surface.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function makeFixtureRoot({ moduleSource, snapshot }) {
  const root = mkdtempSync(join(tmpdir(), 'export-surface-'));
  roots.push(root);
  mkdirSync(join(root, 'release'));
  mkdirSync(join(root, 'dist'));
  writeFileSync(
    join(root, 'release', 'contract.json'),
    JSON.stringify({ exports: { '.': { import: './dist/index.js' } } }),
  );
  writeFileSync(join(root, 'dist', 'index.js'), moduleSource);
  if (snapshot !== undefined) {
    writeFileSync(join(root, 'release', 'export-surface.json'), serializeExportSurface(snapshot));
  }
  // Скрипты резолвят root от собственного пути — подкладываем их копии в фикстуру.
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  for (const rel of [
    'scripts/check-export-surface.js',
    'scripts/generate-export-surface.js',
    'scripts/lib/export-surface.js',
  ]) {
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  return root;
}

function run(root, script) {
  try {
    execFileSync(process.execPath, [join(root, 'scripts', script)], { encoding: 'utf8' });
    return { code: 0, output: '' };
  } catch (error) {
    return { code: error.status, output: `${error.stdout}${error.stderr}` };
  }
}

describe('check-export-surface', () => {
  it('зелёный, когда runtime-поверхность совпадает со снапшотом', () => {
    const root = makeFixtureRoot({
      moduleSource: 'export const a = 1;\nexport const b = 2;\n',
      snapshot: { '.': ['a', 'b'] },
    });
    expect(run(root, 'check-export-surface.js').code).toBe(0);
  });

  it('красный на runtime-утечке, невидимой для d.ts (лишний экспорт)', () => {
    const root = makeFixtureRoot({
      moduleSource: 'export const a = 1;\nexport const hiddenLeak = 2;\n',
      snapshot: { '.': ['a'] },
    });
    const { code, output } = run(root, 'check-export-surface.js');
    expect(code).toBe(1);
    expect(output).toContain('hiddenLeak');
  });

  it('красный на исчезнувшем экспорте', () => {
    const root = makeFixtureRoot({
      moduleSource: 'export const a = 1;\n',
      snapshot: { '.': ['a', 'gone'] },
    });
    const { code, output } = run(root, 'check-export-surface.js');
    expect(code).toBe(1);
    expect(output).toContain('gone');
  });

  it('красный без снапшота — generate обязателен явно, не молча', () => {
    const root = makeFixtureRoot({ moduleSource: 'export const a = 1;\n', snapshot: undefined });
    expect(run(root, 'check-export-surface.js').code).toBe(1);
  });

  it('generate пишет детерминированный отсортированный снапшот', () => {
    const root = makeFixtureRoot({
      moduleSource: 'export const b = 2;\nexport const a = 1;\n',
      snapshot: undefined,
    });
    expect(run(root, 'generate-export-surface.js').code).toBe(0);
    expect(run(root, 'check-export-surface.js').code).toBe(0);
  });
});
