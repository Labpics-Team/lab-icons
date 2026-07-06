/**
 * test/check-corners.test.js — видящий дифференциальный гейт СКРУГЛЕНИЯ вершин.
 *
 * Классы Фаулера:
 *   Д (гейт доказан нарушителем): острый угол руки, скруглённый генератом, ОБЯЗАН
 *      флагнуться; RED-first — до гейта это было невидимо (площадная IoU не видит).
 *   Д (НЕ-ДУБЛИРОВАНИЕ): на ТОЙ ЖЕ фикстуре check-fill-rule и check-path-quality
 *      молчат (0 находок) — уникальность класса доказана кодом.
 *   А (синтетика): совпадающие корнеры (острый↔острый) — НЕ дефект (зелёный).
 *   А (примитив): квадрат-острый → r≈0; квадрат-скруглённый r=3 → r≈3.
 *   Б (регрессия): реальный корпус Outline читается cornerRadii без throw —
 *      корпусный WARN-каталог не роняет verify.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cornerRadii } from '../scripts/lib/corners.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';
import { cornerDefectsBetween, findCornerDefects } from '../scripts/check-corners.js';
import { findBlobBugs } from '../scripts/check-fill-rule.js';
import { validatePathQuality } from '../scripts/check-path-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = (paths) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;

const sharpSquare = 'M4 4L20 4L20 20L4 20Z';
const roundedSquare = 'M7 4L17 4A3 3 0 0 1 20 7L20 17A3 3 0 0 1 17 20L7 20A3 3 0 0 1 4 17L4 7A3 3 0 0 1 7 4Z';

describe('cornerRadii — примитив пер-вершинного радиуса', () => {
  it('А: острый квадрат → 4 угла с r≈0', () => {
    const cs = cornerRadii(sharpSquare);
    expect(cs).toHaveLength(4);
    for (const c of cs) expect(c.radius).toBeLessThan(0.6);
  });

  it('А: скруглённый квадрат r=3 → 4 угла с r≈3', () => {
    const cs = cornerRadii(roundedSquare);
    expect(cs).toHaveLength(4);
    for (const c of cs) expect(c.radius).toBeGreaterThan(2.5);
  });
});

describe('cornerDefectsBetween — дифференциал рука↔генерат', () => {
  it('Д: острые углы руки, скруглённые генератом → 4 дефекта', () => {
    const defects = cornerDefectsBetween(sharpSquare, roundedSquare);
    expect(defects).toHaveLength(4);
    for (const d of defects) {
      expect(d.rHand).toBeLessThan(0.6);
      expect(d.rGen).toBeGreaterThan(1.0);
    }
  });

  it('А: совпадающие острые углы (рука==генерат) → 0 дефектов', () => {
    expect(cornerDefectsBetween(sharpSquare, sharpSquare)).toHaveLength(0);
  });

  it('А: рука УЖЕ скруглена (r=3), генерат тоже скруглён → 0 дефектов', () => {
    // не наша забота: острота была не у руки
    expect(cornerDefectsBetween(roundedSquare, roundedSquare)).toHaveLength(0);
  });
});

describe('findCornerDefects — расслоение Outline(hard)/Filled(warn)', () => {
  it('Д: зализанный угол в Outline/ → в outlineFails', () => {
    const { outlineFails, filledWarns } = findCornerDefects(
      [{ name: 'Outline/x.svg', content: svg([roundedSquare]) }],
      [{ name: 'Outline/x.svg', content: svg([sharpSquare]) }],
    );
    expect(outlineFails.map((e) => e.name)).toContain('Outline/x.svg');
    expect(filledWarns).toHaveLength(0);
  });

  it('А: тот же дефект в Filled/ → только warn', () => {
    const { outlineFails, filledWarns } = findCornerDefects(
      [{ name: 'Filled/x.svg', content: svg([roundedSquare]) }],
      [{ name: 'Filled/x.svg', content: svg([sharpSquare]) }],
    );
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns.map((e) => e.name)).toContain('Filled/x.svg');
  });

  it('А: совпадающие корнеры → ноль дефектов', () => {
    const { outlineFails, filledWarns } = findCornerDefects(
      [{ name: 'Outline/ok.svg', content: svg([sharpSquare]) }],
      [{ name: 'Outline/ok.svg', content: svg([sharpSquare]) }],
    );
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns).toHaveLength(0);
  });
});

describe('НЕ-ДУБЛИРОВАНИЕ: на битой фикстуре молчат другие гейты', () => {
  const raw = readFileSync(join(root, 'test', 'fixtures', 'corners-sharp-rounded.svg'), 'utf8');
  const ds = [...raw.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
  const genOnly = { name: 'Outline/corners-sharp-rounded.svg', content: `<svg viewBox="0 0 24 24"><path d="${ds[1]}"/></svg>` };
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));

  it('check-corners ЛОВИТ фикстуру (path[0]=рука vs path[1]=генерат)', () => {
    expect(cornerDefectsBetween(ds[0], ds[1]).length).toBeGreaterThan(0);
  });

  it('check-fill-rule МОЛЧИТ на скруглённом генерате фикстуры', () => {
    const { outlineFails, filledWarns } = findBlobBugs([genOnly]);
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns).toHaveLength(0);
  });

  it('check-path-quality МОЛЧИТ на скруглённом генерате фикстуры', () => {
    expect(validatePathQuality({ grid, files: [genOnly] })).toHaveLength(0);
  });
});

describe('Б-регрессия: реальный корпус Outline читается без throw', () => {
  const outlineFiles = readdirSync(join(root, 'svg', 'Outline')).filter((f) => f.endsWith('.svg'));

  it('cornerRadii отрабатывает по всему Outline-корпусу (WARN-каталог не роняет verify)', () => {
    for (const f of outlineFiles) {
      const content = readFileSync(join(root, 'svg', 'Outline', f), 'utf8');
      for (const d of renderedPathData(content)) {
        expect(() => cornerRadii(d)).not.toThrow();
      }
    }
  });
});
