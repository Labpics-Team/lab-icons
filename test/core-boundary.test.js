/**
 * CORE-01: граница пакета. Runtime (src/**) не имеет права зависеть от
 * build/authoring-слоя (scripts/**) — иначе public bundle тянет инструменты.
 * Инвариант направления: scripts → src/core, никогда наоборот.
 * Ловим все формы ввоза: static import/from, dynamic import(), require(),
 * side-effect import, export ... from.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** Все модульные спецификаторы файла, любой формой ввоза. */
function specifiers(text) {
  const out = [];
  for (const re of [
    /\bfrom\s+['"]([^'"]+)['"]/g,          // import/export ... from 'x'
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,   // dynamic import('x')
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,  // require('x')
    /^\s*import\s+['"]([^'"]+)['"]/gm,     // side-effect import 'x'
  ]) {
    for (const m of text.matchAll(re)) out.push(m[1]);
  }
  return out;
}

describe('CORE-01 — граница src ↛ scripts', () => {
  it('ни один модуль src/** не ввозит scripts/** (любой формой)', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'src'))) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (spec.includes('scripts/')) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders, 'src не должен зависеть от scripts').toEqual([]);
  });

  it('src/core самодостаточен: только внутренние ./x.js (без node:*, ../, bare)', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'src', 'core'))) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        if (!/^\.\/[\w.-]+\.(js|mjs)$/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders, 'core должен быть чистым островом').toEqual([]);
  });
});
