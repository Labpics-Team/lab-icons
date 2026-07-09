/**
 * test/stroke-path.test.js — composite-примитив stroke-path (BL-014/017):
 * обводка ломаной оси ПОСТОЯННЫМ пером, круглые капы и круглые стыки.
 * Закрывает класс штриховых глифов (галка, «!», стержень «i», стрелки).
 *
 * TDD RED-first. Классы: А (интеграция с реальным svg/Outline/checkmark.svg),
 * Б (свойство постоянного пера by construction), Д (вырождения).
 *
 * Ось галки СНЯТА ИЗМЕРЕНИЕМ из svg/Outline/checkmark.svg:
 *   центры капов = середины хорд дуг R=.9 (перо 1.79≈1.8=base);
 *   локоть = пересечение осевых прямых плеч (направление плеча —
 *   среднее его парных рёбер: [-5,8.06]/[4.93,-7.94] и [2.4,3.12]/[2.31,3.01]).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const cw = grid.canvas.width;

// доли канвы (0..1), как у всех примитивов
const A = [0.31833, 0.52708]; // низ-лево, центр капа
const B = [0.44757, 0.69529]; // локоть (нижняя вершина)
const C = [0.68333, 0.31542]; // верх-право, центр капа

const checkmark = {
  archetype: 'composite',
  status: { outline: 'hand' },
  parts: [
    {
      primitive: 'stroke-path',
      mode: { outline: 'solid' },
      weight: 'base',
      params: { outline: { points: [A, B, C], closed: false } },
    },
  ],
};

const mutate = (fn) => {
  const m = JSON.parse(JSON.stringify(checkmark));
  fn(m);
  return m;
};

const distToSeg = (p, a, b) => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)),
  );
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
};

describe('stroke-path — обводка ломаной постоянным пером', () => {
  it('А: генерат checkmark сходится с рукой (IoU ≥ 0.95)', () => {
    const { outline } = buildGlyph(checkmark, grid);
    const hand = renderedPathData(
      readFileSync(join(root, 'svg', 'Outline', 'checkmark.svg'), 'utf8'),
    ).join('');
    const iou = inkIoU(outline, hand, cw);
    // дрейф печатается для протокола (checkmarkDriftPct)
    console.log(`checkmark: IoU=${(iou * 100).toFixed(2)}% drift=${((1 - iou) * 100).toFixed(2)}%`);
    expect(iou).toBeGreaterThanOrEqual(0.95);
  });

  it('Б: перо константно — каждая точка контура на w/2 от оси (капы/стыки круглые)', () => {
    const { outline } = buildGlyph(checkmark, grid);
    const h = (grid.ratios.strokeWidth.base * cw) / 2;
    const axis = [A, B, C].map((q) => [q[0] * cw, q[1] * cw]);
    const polys = samplePolylines(outline, 32).filter((p) => p.length > 2);
    expect(polys.length).toBe(1); // один замкнутый контур
    let checkedPts = 0;
    for (const poly of polys) {
      for (const p of poly) {
        const d = Math.min(distToSeg(p, axis[0], axis[1]), distToSeg(p, axis[1], axis[2]));
        expect(Math.abs(d - h)).toBeLessThan(0.02);
        checkedPts++;
      }
    }
    expect(checkedPts).toBeGreaterThan(50);
  });

  it('Б: сериализация без полигонализации — капы дугами/кривыми', () => {
    const { outline } = buildGlyph(checkmark, grid);
    expect((outline.match(/M/g) ?? []).length).toBe(1);
    expect(/[AC]/.test(outline.slice(1))).toBe(true); // есть дуги/кубики, не только L
  });

  it('Б: weight-токен резолвится — bold шире base (габарит чернил растёт)', () => {
    const base = buildGlyph(checkmark, grid).outline;
    const bold = buildGlyph(
      mutate((m) => {
        m.parts[0].weight = 'bold';
      }),
      grid,
    ).outline;
    const span = (d) => {
      const pts = samplePolylines(d, 16).flat();
      const ys = pts.map((q) => q[1]);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(span(bold)).toBeGreaterThan(span(base) + 0.3);
  });

  it('Б: per-variant weight {outline, filled} резолвится по варианту (Волна-5, двухвариантные стрелки)', () => {
    // объект-вес: outline=base, filled=bold — идентичен паре скалярных сборок
    const scalarBase = buildGlyph(checkmark, grid).outline;
    const scalarBold = buildGlyph(
      mutate((m) => {
        m.parts[0].weight = 'bold';
      }),
      grid,
    ).outline;
    const both = buildGlyph(
      mutate((m) => {
        m.status = { outline: 'hand', filled: 'hand' };
        m.parts[0].mode = { outline: 'solid', filled: 'solid' };
        m.parts[0].weight = { outline: 'base', filled: 'bold' };
        m.parts[0].params.filled = m.parts[0].params.outline;
      }),
      grid,
    );
    expect(both.outline).toBe(scalarBase); // скалярное поведение не изменилось
    expect(both.filled).toBe(scalarBold); // bold взят из объекта по варианту
  });

  it('Д: <2 точек оси → понятная ошибка', () => {
    const broken = mutate((m) => {
      m.parts[0].params.outline.points = [A];
    });
    expect(() => buildGlyph(broken, grid)).toThrow(/2 точек оси/);
  });

  it('Д: перо съедает сегмент (вырождение офсета на изломе) → ошибка', () => {
    const fat = mutate((m) => {
      m.parts[0].weight = 0.8; // число-доля канвы: перо 19.2 юнита
    });
    expect(() => buildGlyph(fat, grid)).toThrow(/съедает/);
  });
});

/**
 * Сокет-торец «встык» (класс стрелок: палочка ↔ шеврон-наконечник; прецедент —
 * вогнутый сокет genClockHand у time). Перекрытие двух суб-путей под evenodd
 * вырезается белой линзой (полумесяц, скриншот владельца) — торец палочки
 * обязан лечь ТОЧНО на грани вогнутого miter-клина сиблинга: касание без
 * перекрытия и без щели, общие координаты на решётке f3 → EO≡NZ точно.
 */
describe('stroke-path — сокет-торец «встык» (socket, класс стрелок)', () => {
  // класс-фикстура (не swap-специфична): шеврон 45° + палочка до его вершины
  const HEAD = [[0.3, 0.1], [0.1, 0.3], [0.3, 0.5]]; // "<", вершина (2.4, 7.2)
  const SHAFT = [[0.9, 0.3], [0.1, 0.3]]; // ось до вершины шеврона
  const arrow = (shaftExtra = {}, headPoints = HEAD, shaftPoints = SHAFT) => ({
    archetype: 'composite',
    status: { outline: 'hand' },
    parts: [
      {
        primitive: 'stroke-path',
        name: 'head',
        mode: { outline: 'solid' },
        weight: 'base',
        params: { outline: { points: headPoints, closed: false } },
      },
      {
        primitive: 'stroke-path',
        name: 'shaft',
        mode: { outline: 'solid' },
        weight: 'base',
        socket: { end: 'head' },
        params: { outline: { points: shaftPoints, closed: false } },
        ...shaftExtra,
      },
    ],
  });

  /** Чернила под evenodd и nonzero за один проход (паттерн wave3-play). */
  const inkBoth = (polys, x, y) => {
    let hits = 0;
    let wind = 0;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) {
          hits++;
          wind += y2 > y1 ? 1 : -1;
        }
      }
    }
    return [hits % 2 === 1, wind !== 0];
  };
  const eoNzMismatch = (pathData, step = 0.12) => {
    const polys = samplePolylines(pathData, 24).filter((p) => p.length > 2);
    let mismatch = 0;
    for (let x = step / 2; x < cw; x += step) {
      for (let y = step / 2; y < cw; y += step) {
        const [eo, nz] = inkBoth(polys, x, y);
        if (eo !== nz) mismatch++;
      }
    }
    return mismatch;
  };

  it('Б (класс): сокет-встык — EO≡NZ ТОЧНО (0 точек, шаг 0.12)', () => {
    const { outline } = buildGlyph(arrow(), grid);
    expect(eoNzMismatch(outline)).toBe(0);
  });

  it('Д (дифференциал, кусается ли тест): БЕЗ сокета перекрытие даёт линзу EO≠NZ > 0', () => {
    // старый «закон смежности»: конец оси = вершина + полуширина штриха,
    // торцевой кап перекрывает клин шеврона → белая линза под evenodd
    const overlapped = arrow({ socket: undefined }, HEAD, [
      [0.9, 0.3],
      [0.1 + 0.0375, 0.3],
    ]);
    delete overlapped.parts[1].socket;
    const { outline } = buildGlyph(overlapped, grid);
    expect(eoNzMismatch(outline)).toBeGreaterThan(0);
  });

  it('Б: апекс сокета = печатная miter-вершина сиблинга (общая точка двух суб-путей, решётка f3)', () => {
    const entry = arrow();
    // изоляция частей — как materializeParts гейта смежности (partsScope
    // отдаёт сокету полный список частей для конструкции)
    const dOf = (part) =>
      buildGlyph({ ...entry, parts: [part], partsScope: entry.parts }, grid).outline;
    const [headD, shaftD] = [dOf(entry.parts[0]), dOf(entry.parts[1])];
    // вогнутый miter шеврона: V + √2·h вдоль биссектрисы = (2.4+0.9√2, 7.2)
    const apex = `${(2.4 + 0.9 * Math.SQRT2).toFixed(3)} 7.2`;
    expect(headD).toContain(apex);
    expect(shaftD).toContain(apex);
  });

  it('Б: перо палочки константно вне торца (сокет не искажает офсеты сторон)', () => {
    const entry = arrow();
    const shaftD = buildGlyph({ ...entry, parts: [entry.parts[1]], partsScope: entry.parts }, grid).outline;
    const h = (grid.ratios.strokeWidth.base * cw) / 2;
    const axis = SHAFT.map((q) => [q[0] * cw, q[1] * cw]);
    const polys = samplePolylines(shaftD, 32).filter((p) => p.length > 2);
    expect(polys.length).toBe(1); // один замкнутый контур
    for (const p of polys[0]) {
      // торец-клин живёт у конца оси — там дистанция к оси ЛЕГАЛЬНО < h
      if (p[0] < 6) continue;
      expect(Math.abs(distToSeg(p, axis[0], axis[1]) - h)).toBeLessThan(0.02);
    }
  });

  it('Д: сиблинг без внутреннего излома (2 точки оси) → понятная ошибка', () => {
    const broken = arrow({}, [[0.3, 0.1], [0.1, 0.3]]);
    expect(() => buildGlyph(broken, grid)).toThrow(/≥3 точек/);
  });

  it('Д: апекс клина вне створа торца (оси разъехались поперёк) → понятная ошибка', () => {
    const broken = arrow({}, HEAD, [[0.9, 0.45], [0.1, 0.45]]); // ось палочки ниже клина
    expect(() => buildGlyph(broken, grid)).toThrow(/вне створа/);
  });

  it('Д: сиблинг по имени не найден → понятная ошибка', () => {
    const broken = arrow({ socket: { end: 'nope' } });
    expect(() => buildGlyph(broken, grid)).toThrow(/не найден/);
  });
});
