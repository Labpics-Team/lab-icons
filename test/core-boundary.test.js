/**
 * CORE-01: граница пакета. Runtime (src/**) не имеет права зависеть от
 * build/authoring-слоя (scripts/**) — иначе public bundle тянет инструменты.
 * Инвариант направления: scripts → src/core, никогда наоборот.
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

describe('CORE-01 — граница src ↛ scripts', () => {
  it('ни один модуль src/** не импортирует scripts/**', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (m[1].includes('scripts/')) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders, 'src не должен зависеть от scripts').toEqual([]);
  });

  it('src/core не импортирует ничего вне себя (zero-IO ядро)', () => {
    const offenders = [];
    for (const file of walk(join(ROOT, 'src', 'core'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (m[1].startsWith('node:') || m[1].includes('../')) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders, 'core должен быть самодостаточным и чистым').toEqual([]);
  });
});
