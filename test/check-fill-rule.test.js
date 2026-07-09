/**
 * test/check-fill-rule.test.js — видящий гейт против «чёрного блоба».
 * Классы: А (синтетика: кольцо той/иной намотки), Д (гейт доказан нарушителем —
 * одинаково-намотанное кольцо без evenodd ОБЯЗАН флагнуть), Б (регрессия: 4
 * починенные иконки + весь Outline-корпус остаются fill-rule-независимы). RED-first:
 * до фикса намотки эти 4 давали блоб — тест кусался.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eoNzDisagree, fillRuleBlobBug } from '../scripts/lib/seeing-gates.js';
import { findBlobBugs } from '../scripts/check-fill-rule.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = (inner, attrs = '') => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path ${attrs}d="${inner}"/></svg>`;

// Кольцо: внешний круг r=11 + внутренний r=9.5. Намотка внутреннего решает всё.
const ringSame = 'M1 12a11 11 0 1 0 22 0a11 11 0 1 0 -22 0ZM2.5 12a9.5 9.5 0 1 0 19 0a9.5 9.5 0 1 0 -19 0Z'; // одинаковая → блоб под nonzero
const ringOpp = 'M1 12a11 11 0 1 0 22 0a11 11 0 1 0 -22 0ZM2.5 12a9.5 9.5 0 1 1 19 0a9.5 9.5 0 1 1 -19 0Z'; // противо → чистое кольцо

describe('fillRuleBlobBug — дискриминатор блоба', () => {
  it('Д: одинаково-намотанное кольцо БЕЗ fill-rule → блоб (nonzero заливает дыру)', () => {
    const r = fillRuleBlobBug(svg(ringSame));
    expect(r.isBlobBug).toBe(true);
    expect(r.disagreePct).toBeGreaterThan(50);
  });

  it('А: то же кольцо, но с fill-rule=evenodd → НЕ блоб (автор объявил намерение)', () => {
    expect(fillRuleBlobBug(svg(ringSame, 'fill-rule="evenodd" ')).isBlobBug).toBe(false);
  });

  it('А: противо-намотанное кольцо → НЕ блоб и fill-rule-независимо (0%)', () => {
    const r = fillRuleBlobBug(svg(ringOpp));
    expect(r.isBlobBug).toBe(false);
    expect(eoNzDisagree(ringOpp).disagreePct).toBeLessThan(1);
  });

  it('А: клип-рамка Figma (M0 0h24v24H0z) в контуре не считается геометрией', () => {
    // одинокая рамка + чистое кольцо: рамку выкидываем, остаётся 0%
    const r = fillRuleBlobBug(svg('M0 0h24v24H0z') .replace('/>', `/><path d="${ringOpp}"/>`));
    expect(r.isBlobBug).toBe(false);
  });

  it('Д: compound-path (frame-subpath + same-winding ring в одном d) → блоб (un-anchored regex прятал)', () => {
    // Экспорт склеил клип-рамку и геометрию в ОДИН <path>: `d` НАЧИНАЕТСЯ с рамки.
    // Не-заякоренный /M0 0h24v24H0z/ матчил весь `d` → path выпадал целиком вместе с
    // кольцом → кандидата нет → isBlobBug:false прятал реальный блоб. Фикс вырезает
    // рамку как отдельный СУБ-путь, оставляя кольцо на анализ → блоб виден.
    const r = fillRuleBlobBug(svg(`M0 0h24v24H0z ${ringSame}`));
    expect(r.isBlobBug).toBe(true);
    expect(r.disagreePct).toBeGreaterThan(50);
  });

  it('Д: mixed-файл — evenodd-path + одинаково-намотанное кольцо БЕЗ evenodd → блоб (общефайловый чек это прятал)', () => {
    // fill-rule применяется ПО-ПУТЁВО: наличие evenodd на ПЕРВОМ path не спасает второй.
    const mixed = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path fill-rule="evenodd" d="M2 2h4v4h-4z"/>' + // безобидный квадрат с evenodd
      `<path d="${ringSame}"/></svg>`; // кольцо БЕЗ evenodd → блоб
    expect(fillRuleBlobBug(mixed).isBlobBug).toBe(true);
  });

  it('А: раздельные нахлёстывающиеся filled-path без evenodd (случай headphone) → НЕ блоб', () => {
    // Нахлёст МЕЖДУ path — чернила под обоими правилами (fill-rule по-путёво, не склейка).
    const overlap = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M4 4h10v10h-10z"/><path d="M9 9h10v10h-10z"/></svg>';
    expect(fillRuleBlobBug(overlap).isBlobBug).toBe(false);
  });
});

describe('findBlobBugs — расслоение Outline(hard)/Filled(warn)', () => {
  it('Д: блоб в Outline/ → в outlineFails (валит CI)', () => {
    const { outlineFails, filledWarns } = findBlobBugs([{ name: 'Outline/x.svg', content: svg(ringSame) }]);
    expect(outlineFails.map((e) => e.name)).toContain('Outline/x.svg');
    expect(filledWarns).toHaveLength(0);
  });

  it('А: тот же блоб в Filled/ → только warn (CI не валит)', () => {
    const { outlineFails, filledWarns } = findBlobBugs([{ name: 'Filled/x.svg', content: svg(ringSame) }]);
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns.map((e) => e.name)).toContain('Filled/x.svg');
  });
});

describe('Б-регрессия: реальный корпус', () => {
  const outlineFiles = readdirSync(join(root, 'svg', 'Outline')).map((f) => ({
    name: `Outline/${f}`,
    content: readFileSync(join(root, 'svg', 'Outline', f), 'utf8'),
  }));

  it('починенные 4 иконки больше не блобы', () => {
    for (const nm of ['chevron-forward-circle', 'chevron-back-circle', 'chevron-up-circle', 'aloof']) {
      const raw = readFileSync(join(root, 'svg', 'Outline', `${nm}.svg`), 'utf8');
      expect(fillRuleBlobBug(raw).isBlobBug, `${nm} всё ещё блоб`).toBe(false);
    }
  });

  it('весь Outline-корпус fill-rule-независим (ноль блобов)', () => {
    const { outlineFails } = findBlobBugs(outlineFiles);
    expect(outlineFails, `блобы: ${outlineFails.map((e) => e.name).join(', ')}`).toHaveLength(0);
  });
});
