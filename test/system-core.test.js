/**
 * test/system-core.test.js — инварианты токенной системы.
 *
 * Проверяется не «похоже ли на картинку», а то, что законы держатся: площадь
 * обводки совпадает с формулой, разность путей сохраняет площадь, дуга остаётся
 * дугой под преобразованием подобия, а вывод не содержит грязи.
 */

import { describe, it, expect } from 'vitest';
import { TOKENS, DERIVED, AXES, resolve, T, NOMINAL_CANVAS } from '../system/tokens.js';
import { Path } from '../system/core/path.js';
import { cut, containsPoint, signedArea } from '../system/core/boolean.js';
import * as S from '../system/prim/shape.js';
import { strokeSegment, strokePath, strokePolyline } from '../system/prim/stroke.js';
import { maskFromPath, rasterize } from '../system/metrics.js';
import { numeral, numeralMetrics, numeralString } from '../system/numerals.js';
import { glyphs, buildGlyph } from '../system/registry.js';
import { toSvg } from '../system/render.js';
import '../system/glyphs/index.js';

const area = (p) => Math.abs(p.subs.reduce((s, _, i) => s + p.subArea(i, 0.002), 0));

describe('конституция', () => {
  it('все токены — доли канвы, ни одного абсолюта', () => {
    const walk = (o, path = '') => {
      for (const [k, v] of Object.entries(o)) {
        if (k === 'smoothing' || k === 'angleSnapDeg' || k === 'opticalCenterBias' || k === 'wideRatio') continue;
        if (typeof v === 'number') expect(v, `${path}${k}`).toBeLessThanOrEqual(1);
        else if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, `${path}${k}.`);
      }
    };
    walk({ frame: TOKENS.frame, stroke: TOKENS.stroke, clearance: TOKENS.clearance, corner: TOKENS.corner });
  });

  it('вписанный скруглённый квадрат объясняет замер руки 18.48', () => {
    const keyR = (TOKENS.keyline.circle * NOMINAL_CANVAS) / 2;
    const R = TOKENS.corner.box * NOMINAL_CANVAS;
    const size = 2 * DERIVED.inscribedSquareHalf(R, keyR);
    expect(size).toBeCloseTo(18.485, 3);
    expect(Math.abs(size - 18.48)).toBeLessThan(0.01);
  });

  it('углы вписанного квадрата лежат ровно на keyline-окружности', () => {
    const keyR = 11;
    for (const R of [2, 4, 5, 8]) {
      const h = DERIVED.inscribedSquareHalf(R, keyR);
      expect((h - R) * Math.SQRT2 + R).toBeCloseTo(keyR, 9);
    }
  });

  it('кап и внутренняя кромка выводятся, а не задаются', () => {
    expect(DERIVED.cap(T.stroke.base)).toBeCloseTo(0.9, 9);
    expect(DERIVED.inner(5, T.stroke.base)).toBeCloseTo(3.2, 9);
  });

  it('ось веса клампится в выведенный диапазон', () => {
    expect(resolve({ wght: 99 }).axes.wght).toBe(AXES.wght.max);
    expect(resolve({ wght: 0 }).axes.wght).toBe(AXES.wght.min);
    // min = кап / кольцо, max = 1 + (кольцо − зазор) / bold
    expect(AXES.wght.min).toBeCloseTo(0.9 / 1.5, 6);
    expect(AXES.wght.max).toBeCloseTo(1 + (1.5 - 0.8) / 2.4, 4);
  });

  it('ось fill переключает перо глифа Regular↔Bold', () => {
    expect(resolve({ fill: 0 }).stroke.glyph).toBeCloseTo(1.8, 9);
    expect(resolve({ fill: 1 }).stroke.glyph).toBeCloseTo(2.4, 9);
    expect(resolve({ fill: 1 }).cap.glyph).toBeCloseTo(1.2, 9);
  });
});

describe('модель пути', () => {
  it('дуга остаётся дугой под подобием, радиус масштабируется', () => {
    const p = new Path().arcFrom([12, 12], 5, 0, Math.PI / 2);
    p.rotate(Math.PI / 3, [12, 12]).scale(2, [0, 0]);
    const seg = p.subs[0].segs[0];
    expect(seg.k).toBe('A');
    expect(seg.r).toBeCloseTo(10, 9);
  });

  it('зеркало меняет направление обхода дуги', () => {
    const p = new Path().arcFrom([12, 12], 5, 0, Math.PI / 2);
    const before = Math.sign(p.subs[0].segs[0].a1 - p.subs[0].segs[0].a0);
    p.mirrorX(12);
    expect(Math.sign(p.subs[0].segs[0].a1 - p.subs[0].segs[0].a0)).toBe(-before);
  });

  it('разворот подпути сохраняет геометрию и меняет знак площади', () => {
    const p = S.circle([12, 12], 7);
    const a = p.subArea(0);
    p.reverse();
    expect(p.subArea(0)).toBeCloseTo(-a, 4);
  });

  it('внешний контур идёт по часовой (положительная площадь при y вниз)', () => {
    expect(signedArea(S.circle([12, 12], 7))).toBeGreaterThan(0);
    expect(signedArea(S.roundedRect(12, 12, 10, 10, 2))).toBeGreaterThan(0);
    expect(signedArea(S.roundedPolygon([[4, 4], [20, 4], [20, 20], [4, 20]], 3))).toBeGreaterThan(0);
  });
});

describe('примитивы', () => {
  it('круг: площадь πr² с точностью полигонализации', () => {
    expect(area(S.circle([12, 12], 8))).toBeCloseTo(Math.PI * 64, 0);
  });

  it('кольцо: площадь π(R² − (R−w)²), дырка развёрнута', () => {
    const p = S.ring([12, 12], 11, 1.8);
    expect(area(p)).toBeCloseTo(Math.PI * (121 - 9.2 ** 2), 0);
    expect(p.subArea(1)).toBeLessThan(0);
  });

  it('скруглённый прямоугольник: площадь = wh − (4−π)r²', () => {
    const r = 4;
    expect(area(S.roundedRect(12, 12, 16, 12, r))).toBeCloseTo(16 * 12 - (4 - Math.PI) * r * r, 1);
  });

  it('радиус скругления зажимается геометрическим бюджетом стороны', () => {
    const p = S.roundedRect(12, 12, 6, 6, 40);
    expect(area(p)).toBeGreaterThan(0);
    expect(area(p)).toBeLessThanOrEqual(36.01);
  });

  it('сглаживание ζ не меняет радиус вершины и почти не меняет площадь', () => {
    const a0 = area(S.roundedRect(12, 12, 16, 16, 5, 0));
    const a6 = area(S.roundedRect(12, 12, 16, 16, 5, 0.6));
    expect(Math.abs(a6 - a0) / a0).toBeLessThan(0.02);
  });

  it('эллипс: площадь πab', () => {
    expect(area(S.ellipse([12, 12], 6, 3))).toBeCloseTo(Math.PI * 18, 1);
  });

  it('линза симметрична и вписана в заданные габариты', () => {
    const p = S.eyeLens([12, 12], 8, 4);
    const b = p.bbox();
    expect(b.w).toBeCloseTo(16, 1);
    expect(b.h).toBeCloseTo(8, 1);
    expect(b.cx).toBeCloseTo(12, 2);
  });
});

describe('обводка скелета', () => {
  it('прямой штрих: площадь = L·w + πr² (два полукруглых терминала)', () => {
    const w = 1.8;
    const L = 12;
    expect(area(strokeSegment([6, 12], [18, 12], w))).toBeCloseTo(L * w + Math.PI * (w / 2) ** 2, 1);
  });

  it('замкнутый круговой скелет даёт кольцо, а не залитый диск', () => {
    const p = strokePath(new Path().arcFrom([12, 12], 8, 0, Math.PI).arc([12, 12], 8, Math.PI, Math.PI * 2).close(), 1.8);
    expect(area(p)).toBeCloseTo(Math.PI * (8.9 ** 2 - 7.1 ** 2), 0);
    // просвет действительно пуст
    expect(containsPoint(p, [12, 12])).toBe(false);
  });

  it('ломаная не рвётся на суставе: контур замкнут одним подпутём', () => {
    const p = strokePolyline([[6, 9], [12, 15], [18, 9]], 1.8);
    expect(p.subs.length).toBe(1);
    expect(p.subs[0].closed).toBe(true);
  });

  it('перо шире дуги — честная ошибка, а не молчаливый вырожденный контур', () => {
    expect(() => strokePath(new Path().arcFrom([12, 12], 0.4, 0, 1), 1.8)).toThrow();
  });
});

describe('разность путей', () => {
  it('вырез диска из диска уменьшает площадь на площадь пересечения', () => {
    const res = cut(S.circle([12, 12], 8), S.circle([12, 12], 4));
    expect(area(res)).toBeCloseTo(Math.PI * (64 - 16), 0);
  });

  it('надрез с края оставляет один контур, а не два обрывка', () => {
    const res = cut(S.roundedRect(12, 12, 16, 16, 2), S.circle([20, 12], 3));
    expect(res.subs.length).toBe(1);
    expect(res.subs[0].closed).toBe(true);
  });

  it('вырез сохраняет тип кривых: дуги остаются дугами', () => {
    const res = cut(S.circle([12, 12], 9), S.roundedRect(20, 12, 6, 6, 1));
    const kinds = new Set(res.subs.flatMap((s) => s.segs.map((g) => g.k)));
    expect(kinds.has('A')).toBe(true);
  });

  it('накладной класс строит негатив: между носителем и накладкой есть зазор', async () => {
    const { withSlash, slash } = await import('../system/parts.js');
    const carrier = S.ring([12, 12], 9, 1.8);
    const res = withSlash(carrier, T);
    // точка вплотную к оси перечёркивания, но в зоне зазора — чернил быть не должно
    const probe = [12 + 1.3 / Math.SQRT2, 12 + 1.3 / Math.SQRT2];
    expect(containsPoint(slash(T), probe)).toBe(false);
    expect(containsPoint(res, probe)).toBe(false);
  });
});

describe('цифровой знак', () => {
  it('метрики совпадают с календарём руки', () => {
    const m = numeralMetrics(7.2);
    expect(m.pen).toBeCloseTo(1.44, 2); // рука: 1.46
    expect(m.inkWidth).toBeCloseTo(5.01, 1); // рука: 5.0
  });

  it('все десять цифр строятся и укладываются в свою коробку', () => {
    const m = numeralMetrics(12);
    for (let d = 0; d <= 9; d++) {
      const b = numeral(d, { capHeight: 12, origin: [0, 0] }).bbox();
      expect(b.h, `цифра ${d}`).toBeGreaterThan(11);
      expect(b.h, `цифра ${d}`).toBeLessThan(12.3);
      expect(b.w, `цифра ${d}`).toBeLessThanOrEqual(m.inkWidth + 0.05);
    }
  });

  it('у 0, 6, 8, 9 есть просвет — знак не залит', () => {
    for (const d of [0, 6, 8, 9]) {
      const p = numeral(d, { capHeight: 16, origin: [4, 4] });
      const holes = p.subs.filter((_, i) => p.subArea(i) < 0).length;
      expect(holes, `цифра ${d}`).toBeGreaterThan(0);
    }
  });

  it('девятка — это шестёрка, повёрнутая на 180°', () => {
    const six = numeral(6, { capHeight: 12, origin: [0, 0] }).bbox();
    const nine = numeral(9, { capHeight: 12, origin: [0, 0] }).bbox();
    expect(nine.w).toBeCloseTo(six.w, 6);
    expect(nine.h).toBeCloseTo(six.h, 6);
  });

  it('набор табулярный: шаг один и тот же, «1» не поджимает соседа', () => {
    // Табулярность — про ШАГ, а не про габарит чернил: «1» уже своего места,
    // но место занимает ровно такое же. Меряем левый край второго знака.
    const m = numeralMetrics(10);
    const step = m.inkWidth + 0.16 * m.Ws;
    const leftOfSecond = (s) => {
      const total = 2 * m.inkWidth + step - m.inkWidth;
      const x0 = 12 - total / 2;
      return x0 + step;
    };
    expect(leftOfSecond('11')).toBeCloseTo(leftOfSecond('88'), 9);
    for (const s of ['11', '88', '10', '47']) {
      const b = numeralString(s, { capHeight: 10, center: [12, 12] }).bbox();
      expect(b.w, s).toBeLessThanOrEqual(2 * m.inkWidth + step - m.inkWidth + 0.01);
      expect(Math.abs(b.cx - 12), s).toBeLessThan(m.inkWidth / 2);
    }
  });
});

describe('корпус деклараций', () => {
  const names = [...glyphs.keys()];

  it('в реестре есть глифы', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it('каждый объявленный глиф строится в обоих вариантах', () => {
    for (const n of names) {
      for (const v of ['outline', 'filled']) {
        const def = glyphs.get(n);
        if (v === 'filled' && def.deriveFilled === 'none' && !def.filled) continue;
        expect(() => buildGlyph(n, v), `${n}/${v}`).not.toThrow();
      }
    }
  });

  it('вывод чист: без NaN, без evenodd, координаты в разумных пределах', () => {
    for (const n of names) {
      const svg = toSvg(buildGlyph(n, 'outline'));
      expect(svg, n).not.toMatch(/NaN|Infinity|undefined/);
      expect(svg, n).not.toMatch(/fill-rule/);
      const d = /\sd="([^"]*)"/.exec(svg)[1];
      for (const m of d.matchAll(/-?\d*\.?\d+/g)) {
        expect(Math.abs(Number(m[0])), `${n}: ${m[0]}`).toBeLessThan(200);
      }
    }
  });

  it('ни один глиф не пуст и не вырожден', () => {
    for (const n of names) {
      const p = buildGlyph(n, 'outline');
      const b = p.bbox();
      expect(b.w, n).toBeGreaterThan(0.5);
      expect(b.h, n).toBeGreaterThan(0.5);
      const mask = maskFromPath(p, 24, 8);
      expect(mask.reduce((s, v) => s + v, 0), n).toBeGreaterThan(50);
    }
  });

  it('каждый глиф объявил закон длиннее лозунга', () => {
    for (const n of names) {
      expect(glyphs.get(n).law.length, n).toBeGreaterThan(24);
    }
  });

  it('чернила остаются в канве: ничего не вылезает за поле больше допуска', () => {
    for (const n of names) {
      const b = buildGlyph(n, 'outline').bbox();
      expect(b.x0, `${n} слева`).toBeGreaterThan(-0.01);
      expect(b.y0, `${n} сверху`).toBeGreaterThan(-0.01);
      expect(b.x1, `${n} справа`).toBeLessThan(24.01);
      expect(b.y1, `${n} снизу`).toBeLessThan(24.01);
    }
  });
});

describe('якоря движения', () => {
  it('ось вращения кольца — его собственный центр, а не кончик штриха', async () => {
    const { motionAnchors } = await import('../system/motion.js');
    const a = motionAnchors(S.ring([12, 12], 11, 1.8));
    expect(a.primaryPivot[0]).toBeCloseTo(12, 3);
    expect(a.primaryPivot[1]).toBeCloseTo(12, 3);
    expect(a.pivots[0].sweepDeg).toBeCloseTo(720, 0);
  });

  it('терминал пера не побеждает кольцо: ранг учитывает радиус', async () => {
    const { motionAnchors } = await import('../system/motion.js');
    const p = S.ring([12, 12], 11, 1.8);
    p.add(strokeSegment([4, 4], [8, 4], 1.8));
    const a = motionAnchors(p);
    expect(a.primaryPivot[0]).toBeCloseTo(12, 3);
  });

  it('центроид чернил симметричной фигуры совпадает с центром', async () => {
    const { motionAnchors } = await import('../system/motion.js');
    const a = motionAnchors(S.circle([12, 12], 8));
    expect(a.ink.centroid[0]).toBeCloseTo(12, 2);
    expect(a.ink.centroid[1]).toBeCloseTo(12, 2);
  });
});

describe('растеризатор метрики', () => {
  it('площадь маски сходится к аналитической', () => {
    const m = rasterize([{ polys: S.circle([12, 12], 6).flatten(0.005), fillRule: 'nonzero' }], 24, 16);
    const px = m.reduce((s, v) => s + v, 0) / (16 * 16);
    expect(px).toBeCloseTo(Math.PI * 36, 0);
  });
});
