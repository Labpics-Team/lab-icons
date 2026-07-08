/**
 * test/check-eonz-strict.test.js — строгий шов-гейт (check-eonz-strict).
 *
 * КЛАСС: «не-сварной стык суб-путей» в отгрузке — две физики одного дефекта:
 * evenodd-ЛИНЗА (перекрытие одноимённо намотанных суб-путей, бывает
 * суб-пиксельной — глубина 0.015 у arrow-back-circle) и ПИНЧ (тангенциальное
 * касание без шва: EO≡NZ ТОЧНО, но глаз видит белые клинья — ромбик close,
 * пойманный владельцем; blob-порог check-fill-rule 5% слеп к обоим).
 *
 * Классы тестов: А (unit ядра на синтетике), Б (regression — RED-бетон:
 * ДО-фиксовые конструкции close/plus/arrow-back-circle обязаны падать),
 * Д (диверсия: гейт кусается на реальном классе, не на хардкоде).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strictSeamReport } from '../scripts/check-eonz-strict.js';
import { buildGlyph, genStrokePath, genRing } from '../scripts/lib/anatomy-gen.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

describe('check-eonz-strict — ядро (класс А, синтетика)', () => {
  it('перекрытие одноимённо намотанных капсул → evenodd-линза (fine > 0)', () => {
    // две горизонтальные капсулы пером 1.8 с перекрытием 0.4 юнита
    const a = genStrokePath([[6, 12], [12.2, 12]], 1.8);
    const b = genStrokePath([[11.8, 12], [18, 12]], 1.8);
    const r = strictSeamReport(a + b, cw, grid);
    expect(r.fine, 'линза перекрытия в полосе стыка').toBeGreaterThan(0);
  });

  it('тангенциальное касание капа к грани (EO≡NZ точно) → пинч-шов (seams > 0)', () => {
    // кап капсулы касается грани вертикальной капсулы ровно в точке:
    // конец оси на расстоянии перо от оси сиблинга
    const a = genStrokePath([[12, 6], [12, 18]], 1.8); // вертикаль, грань x=11.1
    const b = genStrokePath([[4, 12], [10.2, 12]], 1.8); // кап доходит ровно до 11.1
    const r = strictSeamReport(a + b, cw, grid);
    expect(r.coarse, 'касание не даёт линзы на полной сетке').toBe(0);
    expect(r.seams.length, 'точечное касание = пинч, шва нет').toBeGreaterThan(0);
    expect(r.seams[0].contactLen).toBeLessThan(r.grid.minSeam);
  });

  it('настоящий шов-встык (примыкание граней на всю ширину торца) → чисто', () => {
    // два прямоугольника встык по общей грани x=12 длиной 4 (> minSeam 1.5)
    const rect = (x0, y0, x1, y1) => `M${x0} ${y0}L${x1} ${y0}L${x1} ${y1}L${x0} ${y1}Z`;
    const r = strictSeamReport(rect(8, 10, 12, 14) + rect(12, 10, 16, 14), cw, grid);
    expect(r.coarse).toBe(0);
    expect(r.fine).toBe(0);
    expect(r.seams).toEqual([]);
  });

  it('кольцо с противонамоткой (genRing) → чисто (легальная дырка, не линза)', () => {
    const r = strictSeamReport(genRing(12, 12, 11, 9.5), cw, grid);
    expect(r.coarse).toBe(0);
    expect(r.fine).toBe(0);
    expect(r.seams).toEqual([]);
  });

  it('раздельные части с легальным клиренсом (≥ clearanceMin) → вне юрисдикции', () => {
    const a = genStrokePath([[6, 8], [18, 8]], 1.8);
    const b = genStrokePath([[6, 12], [18, 12]], 1.8); // зазор осей 4 − перо = 2.2
    const r = strictSeamReport(a + b, cw, grid);
    expect(r.seams).toEqual([]);
  });
});

describe('check-eonz-strict — RED-бетон до-фиксовых конструкций (классы Б/Д)', () => {
  it('Д: close ДО фикса (капсула + 2 стаба с тангенциальными капами) → пинчи ×2', () => {
    // до-фиксовая декларация close (3 stroke-path, замер RED: контакт 0.40 < 1.5)
    const pen = grid.ratios.strokeWidth.base * cw;
    const L = (q) => q.map(([x, y]) => [x * cw, y * cw]);
    const d =
      genStrokePath(L([[0.323125, 0.323125], [0.68, 0.680208]]), pen) +
      genStrokePath(L([[0.553226, 0.447264], [0.677083, 0.323333]]), pen) +
      genStrokePath(L([[0.447192, 0.553362], [0.320208, 0.680417]]), pen);
    const r = strictSeamReport(d, cw, grid);
    expect(r.seams.length, 'оба стаба касаются без шва (ромбик владельца)').toBe(2);
    expect(r.coarse, 'EO≡NZ у пинча ТОЧНОЕ — линзы нет, ловит только шов-инвариант').toBe(0);
  });

  it('Д: arrow-back-circle ДО фикса (палочка капом в клин шеврона) → линза + пинч', () => {
    const entry = structuredClone(anatomy.glyphs['arrow-back-circle']);
    delete entry.parts.find((p) => p.name === 'stick').socket; // вернуть до-фиксовый кап
    const d = buildGlyph(entry, grid, {}, anatomy.glyphs).outline;
    const r = strictSeamReport(d, cw, grid);
    expect(r.fine, 'суб-пиксельная линза перекрытия капа с гранью клина').toBeGreaterThan(0);
    expect(r.seams.length, 'касание капа без шва').toBeGreaterThan(0);
  });

  it('Б: отгрузка пофикшенных — 0 точек, 0 пинчей (инвариант гейта)', () => {
    for (const name of ['close', 'plus', 'arrow-back-circle', 'arrow-forward-circle', 'arrow-down-circle', 'component']) {
      const file = readFileSync(join(root, 'svg', 'Outline', `${name}.svg`), 'utf8');
      const d = [...file.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]).join('');
      const r = strictSeamReport(d, cw, grid);
      expect(r.coarse, `${name}: EO≠NZ полная сетка`).toBe(0);
      expect(r.fine, `${name}: EO≠NZ полоса стыка`).toBe(0);
      expect(r.seams, `${name}: пинчи`).toEqual([]);
    }
  });
});
