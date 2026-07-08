/**
 * test/stroke-path-socket.test.js — сокет-торец «встык» у stroke-path
 * (класс стыков палочка↔наконечник: arrow-семья; подход PR #36 / genClockHand).
 *
 * Закон: вместо капа, тангенциально касающегося клина сиблинга (белый
 * полумесяц-пинч + суб-пиксельная линза перекрытия), торец палочки ложится
 * ТОЧНО на грани вогнутого miter-клина сиблинга; общие координаты квантованы
 * к решётке f3 ДО вывода углов — касание без перекрытия и без щели.
 *
 * Классы: А (EO≡NZ пары точно, апекс на решётке, грани совпадают),
 * Б (потребители arrow-*-circle чисты), Д (вырождения + диверсия «без сокета»).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph, genStrokePath } from '../scripts/lib/anatomy-gen.js';
import { strictSeamReport } from '../scripts/check-eonz-strict.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;
const pen = grid.ratios.strokeWidth.containerGlyph * cw; // 2.0

// снято с arrow-back-circle (юниты): шеврон-наконечник и горизонтальная палочка
const HEAD = [[11.63, 7.88], [7.505, 12.005], [11.705, 16.205]];
const STICK = [[16, 12.02], [10.327, 12.02]];

describe('stroke-path socket — конструкция стыка (класс А)', () => {
  it('палочка с сокетом + шеврон: EO≡NZ точно, ноль пинчей (шов на всю ширину торца)', () => {
    const d =
      genStrokePath(HEAD, pen) +
      genStrokePath(STICK, pen, false, { socket: { end: { pts: HEAD, pen } } });
    const r = strictSeamReport(d, cw, grid);
    expect(r.coarse).toBe(0);
    expect(r.fine).toBe(0);
    expect(r.seams).toEqual([]);
  });

  it('апекс торца = miter-точка клина сиблинга, квантован к решётке f3', () => {
    const d = genStrokePath(STICK, pen, false, { socket: { end: { pts: HEAD, pen } } });
    // апекс печатается между двумя L торца; miter клина шеврона (90°):
    // апекс = вершина + √2·(перо/2) в вогнутую сторону, всё на решётке 1e-3
    const nums = [...d.matchAll(/L([\d.-]+) ([\d.-]+)/g)].map((m) => [+m[1], +m[2]]);
    const apex = nums.find((p) => Math.abs(p[0] - 8.919) < 5e-3 && Math.abs(p[1] - 12.005) < 5e-3);
    expect(apex, 'апекс клина в контуре торца').toBeTruthy();
    for (const v of apex) expect(v, 'координата на решётке f3').toBe(Number.parseFloat(v.toFixed(3)));
  });

  it('диверсия (класс Д): та же пара БЕЗ сокета → гейт видит пинч (тест кусается)', () => {
    const d = genStrokePath(HEAD, pen) + genStrokePath(STICK, pen);
    const r = strictSeamReport(d, cw, grid);
    expect(r.fine + r.seams.length, 'кап в клине = линза и/или пинч').toBeGreaterThan(0);
  });
});

describe('stroke-path socket — вырождения (класс Д)', () => {
  it('сиблинг без внутреннего излома (2 точки) → понятная ошибка', () => {
    expect(() =>
      genStrokePath(STICK, pen, false, { socket: { end: { pts: [[7, 12], [11, 12]], pen } } }),
    ).toThrow(/≥3 точек/);
  });

  it('апекс клина вне створа торца → понятная ошибка', () => {
    // палочка смещена поперёк на 1.4 (> перо/2 = 1): грани клина ещё по разные
    // стороны её оси, но апекс уже не попадает в створ торца
    expect(() =>
      genStrokePath([[16, 13.4], [10.3, 13.4]], pen, false, { socket: { end: { pts: HEAD, pen } } }),
    ).toThrow(/вне створа/);
  });

  it('торец шире грани клина → понятная ошибка', () => {
    // перо палочки много шире клина сиблинга — углы торца сходят с граней
    expect(() =>
      genStrokePath(STICK, 9, false, { socket: { end: { pts: HEAD, pen: 1 } } }),
    ).toThrow(/шире грани|съедает сегмент/);
  });

  it('излом сиблинга прямой (клина нет) → понятная ошибка', () => {
    expect(() =>
      genStrokePath(STICK, pen, false, {
        socket: { end: { pts: [[7, 8], [7, 12], [7, 16]], pen } },
      }),
    ).toThrow(/прямой|клина нет/);
  });
});

describe('stroke-path socket — потребители arrow-*-circle (класс Б)', () => {
  for (const name of ['arrow-back-circle', 'arrow-forward-circle', 'arrow-down-circle']) {
    it(`${name}: генерат сварен (EO≡NZ точно, стыки со швом)`, () => {
      const d = buildGlyph(anatomy.glyphs[name], grid, {}, anatomy.glyphs).outline;
      const r = strictSeamReport(d, cw, grid);
      expect(r.coarse).toBe(0);
      expect(r.fine).toBe(0);
      expect(r.seams).toEqual([]);
    });
  }
});
