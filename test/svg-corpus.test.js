/**
 * test/svg-corpus.test.js — корпусные инварианты SVG-исходников (svg/Outline + svg/Filled).
 *
 * Характеризационные тесты: каждый инвариант ЭМПИРИЧЕСКИ проверен на всех 444
 * файлах до фиксации (0 нарушений) и заморожен против регрессий будущих волн
 * (enclosure/composite/arc-terminal перегенерируют декларации — руки svg/
 * обязаны оставаться в этих рамках; новые файлы — тоже).
 *
 * Инварианты:
 *   1. Нейминг: Outline — `<kebab>.svg`, Filled — `<kebab>_filled.svg`.
 *   2. Парность сетов: множества имён Outline и Filled совпадают 1:1.
 *   3. Корень: ровно один <svg>, viewBox="0 0 24 24", width/height 24, xmlns.
 *   4. Атрибуты <path> — только из белого списка {d, fill-rule, clip-rule}.
 *   5. fill-rule="evenodd" всегда в паре с clip-rule="evenodd".
 *   6. Никаких цветов/стилей в исходниках (fill/stroke≠none, style=, hex).
 *   7. Числа в d: без научной нотации, точность ≤ 3 знаков (конвенция f3).
 *   8. Нет дублей геометрии внутри сета (две иконки с идентичным набором d).
 *   9. Точный bbox каждого подпути ⊆ viewBox [0..24]² (парсер path-data.js).
 *
 * Зона владения: только чтение svg/ и scripts/lib/path-data.js — не пересекается
 * с anatomy-gen.js (ветка fix/stroke-cap-quantization) и semantics/anatomy.json
 * (волна enclosure).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pathBBox } from '../scripts/lib/path-data.js';

const SETS = [
  { dir: 'Outline', nameRe: /^[a-z0-9]+(-[a-z0-9]+)*\.svg$/, strip: (f) => f.replace(/\.svg$/, '') },
  { dir: 'Filled', nameRe: /^[a-z0-9]+(-[a-z0-9]+)*_filled\.svg$/, strip: (f) => f.replace(/_filled\.svg$/, '') },
];

const ROOT = join(import.meta.dirname, '..', 'svg');
const PATH_ATTR_WHITELIST = new Set(['d', 'fill-rule', 'clip-rule']);

/** Все svg-файлы сета: [{ file, full, src, ds }] */
function loadSet(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.svg'))
    .map((file) => {
      const full = join(ROOT, dir, file);
      const src = readFileSync(full, 'utf8');
      const ds = [...src.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      return { file, full, src, ds };
    });
}

const corpus = Object.fromEntries(SETS.map((s) => [s.dir, loadSet(s.dir)]));

describe('svg-corpus — структура сетов', () => {
  it('2: сеты непусты и парны 1:1 (Outline ↔ Filled)', () => {
    const out = new Set(corpus.Outline.map((f) => SETS[0].strip(f.file)));
    const fil = new Set(corpus.Filled.map((f) => SETS[1].strip(f.file)));
    expect(out.size).toBeGreaterThan(0);
    expect([...out].filter((n) => !fil.has(n))).toEqual([]);
    expect([...fil].filter((n) => !out.has(n))).toEqual([]);
  });

  for (const { dir, nameRe } of SETS) {
    it(`1: нейминг ${dir} соответствует конвенции`, () => {
      const bad = corpus[dir].filter((f) => !nameRe.test(f.file)).map((f) => f.file);
      expect(bad).toEqual([]);
    });

    it(`8: нет дублей геометрии внутри ${dir}`, () => {
      const seen = new Map();
      const dups = [];
      for (const f of corpus[dir]) {
        const key = f.ds.join('~');
        if (seen.has(key)) dups.push(`${f.file} == ${seen.get(key)}`);
        else seen.set(key, f.file);
      }
      expect(dups).toEqual([]);
    });
  }
});

describe('svg-corpus — пофайловые инварианты', () => {
  for (const { dir } of SETS) {
    it(`3–7: корень/атрибуты/пары/цвета/числа — ${dir}`, () => {
      const violations = [];
      for (const f of corpus[dir]) {
        const tag = `${dir}/${f.file}`;
        if ((f.src.match(/<svg/g) || []).length !== 1) violations.push(`${tag}: не ровно один <svg>`);
        if (!f.src.includes('viewBox="0 0 24 24"')) violations.push(`${tag}: viewBox ≠ 0 0 24 24`);
        if (!/width="24" height="24"/.test(f.src)) violations.push(`${tag}: width/height ≠ 24`);
        if (!f.src.includes('xmlns="http://www.w3.org/2000/svg"')) violations.push(`${tag}: нет xmlns`);

        for (const m of f.src.matchAll(/<path\b([^>]*)\/?>/g)) {
          for (const a of m[1].matchAll(/([a-zA-Z-]+)=/g)) {
            if (!PATH_ATTR_WHITELIST.has(a[1])) violations.push(`${tag}: атрибут <path ${a[1]}=…> вне белого списка`);
          }
          if (/fill-rule="evenodd"/.test(m[1]) && !/clip-rule="evenodd"/.test(m[1])) {
            violations.push(`${tag}: fill-rule="evenodd" без clip-rule`);
          }
        }

        if (/(fill|stroke)="(?!none)[^"]*"|style=|#[0-9a-fA-F]{3}/.test(f.src)) {
          violations.push(`${tag}: цвет/стиль в исходнике`);
        }

        for (const d of f.ds) {
          if (/[eE][+-]?\d/.test(d)) { violations.push(`${tag}: научная нотация в d`); break; }
          const deep = d.match(/\d*\.\d{4,}/);
          if (deep) { violations.push(`${tag}: точность > f3 (${deep[0]})`); break; }
        }
      }
      expect(violations).toEqual([]);
    });

    it(`9: точный bbox каждого подпути ⊆ viewBox — ${dir}`, () => {
      const violations = [];
      for (const f of corpus[dir]) {
        for (const d of f.ds) {
          const b = pathBBox(d);
          const over = Math.max(0 - b.minX, 0 - b.minY, b.maxX - 24, b.maxY - 24);
          if (over > 0) violations.push(`${dir}/${f.file}: выход за viewBox на ${over.toFixed(4)}`);
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
