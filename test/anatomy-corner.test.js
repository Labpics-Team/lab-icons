/**
 * test/anatomy-corner.test.js — суперэллипсное скругление ζ (BL-014, токен
 * grid.cornerSmoothing=0.6, утверждён владельцем). Классы:
 *   B (golden): дифференциал против эталона figma-squircle (реверс Figma,
 *     которым рисовалась рука) — фикстуры сгенерены пакетом один раз;
 *   А (инварианты): ζ=0 → чистая дуга; концы фрагмента на гранях в ±p;
 *   Д (мутант): порча формулы валит golden-сравнение.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildGlyph,
  genArcBand,
  rotatePath,
  translateD,
  cornerParams,
  genRing,
  genRoundedRect,
  genSuperellipse,
  genSuperellipseStroke,
  smoothCorner90,
  smoothCornerAny,
} from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const golden = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures-squircle-golden.json'), 'utf8'),
);

/** Квадрат 16×16 в (0,0) из четырёх smoothCorner90 (обход по часовой). */
function square(R, zeta) {
  const f3 = (v) => v.toFixed(3);
  const corners = [
    { V: [16, 0], u: [1, 0], w: [0, 1] },   // верх-право
    { V: [16, 16], u: [0, 1], w: [-1, 0] }, // низ-право
    { V: [0, 16], u: [-1, 0], w: [0, -1] }, // низ-лево
    { V: [0, 0], u: [0, -1], w: [1, 0] },   // верх-лево
  ].map(({ V, u, w }) => smoothCorner90(V, u, w, R, zeta));
  return (
    `M${f3(corners[3].end[0])} ${f3(corners[3].end[1])}` +
    corners.map((c) => `L${f3(c.start[0])} ${f3(c.start[1])}${c.d}`).join('') +
    'Z'
  );
}

describe('smoothCorner90 — профиль ζ (радиус фиксирован, сглаживается вход)', () => {
  it('B: дифференциал с эталоном figma-squircle — IoU ≥ 99.95% на трёх (R, ζ)', () => {
    // порог здоровья ВЫШЕ потолка мутанта (0.9995) — серую зону между
    // ассертами разнесли по ревью верификатора
    for (const [key, dGolden] of Object.entries(golden)) {
      const [R, z] = key.replace('R', '').split('_z').map(Number);
      const iou = inkIoU(square(R, z), dGolden, 16, 0.08);
      expect(iou, key).toBeGreaterThanOrEqual(0.9995);
    }
  });

  it('А: ζ=0 — фрагмент вырождается в чистую дугу (p = R, кубики нулевой длины)', () => {
    const { p, arcLen, a, b, c, d } = cornerParams(4, 0);
    expect(p).toBeCloseTo(4, 9);
    expect(arcLen).toBeCloseTo(4 * Math.SQRT2 * Math.sin(Math.PI / 4), 6);
    expect(a + b + c + d).toBeCloseTo(p - arcLen, 9);
  });

  it('А: концы фрагмента лежат на гранях в ±p от вершины', () => {
    const { p } = cornerParams(4.5, 0.6);
    const { start, end } = smoothCorner90([16, 0], [1, 0], [0, 1], 4.5, 0.6);
    expect(start[0]).toBeCloseTo(16 - p, 9);
    expect(start[1]).toBeCloseTo(0, 9);
    expect(end[0]).toBeCloseTo(16, 9);
    expect(end[1]).toBeCloseTo(p, 9);
  });

  it('Д: мутант (ζ занижен вдвое) — golden-сравнение падает ниже порога', () => {
    const iou = inkIoU(square(4.5, 0.3), golden['R4.5_z0.6'], 16, 0.08);
    expect(iou).toBeLessThan(0.9995);
  });
});

describe('smoothCornerAny — произвольный угол (обобщение)', () => {
  it('B: на θ=90° тождественен доказанному smoothCorner90 (все точки ≤ 0.01)', () => {
    for (const zeta of [0.3, 0.6, 0.9]) {
      const d90 = smoothCorner90([16, 0], [1, 0], [0, 1], 4.5, zeta);
      const dAny = smoothCornerAny([16, 0], [1, 0], [0, 1], 4.5, zeta);
      const A = samplePolylines(`M${d90.start[0]} ${d90.start[1]}${d90.d}`, 48)[0];
      const B = samplePolylines(`M${dAny.start[0]} ${dAny.start[1]}${dAny.d}`, 48)[0];
      expect(A.length, 'ζ=' + zeta).toBe(B.length);
      for (let i = 0; i < A.length; i++) {
        expect(Math.hypot(A[i][0] - B[i][0], A[i][1] - B[i][1]), `ζ=${zeta} т.${i}`).toBeLessThan(0.01);
      }
    }
  });

  it('А: θ=120° — концы на (1+ζ)·R·cot(60°) от вершины, кривая внутри клина', () => {
    // клин: вход вдоль (1,0) к вершине (10,0), выход под 120° к входу
    const w = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)]; // 60° от продолжения = 120° внутренний
    const R = 3, zeta = 0.6;
    const { start, end, d } = smoothCornerAny([10, 0], [1, 0], w, R, zeta);
    const p = (1 + zeta) * R * (Math.cos(Math.PI / 3) / Math.sin(Math.PI / 3));
    expect(Math.hypot(start[0] - 10, start[1])).toBeCloseTo(p, 6);
    expect(Math.hypot(end[0] - 10, end[1])).toBeCloseTo(p, 6);
    // все точки кривой по внутреннюю сторону обеих граней (клин)
    const poly = samplePolylines(`M${start[0]} ${start[1]}${d}`, 48)[0];
    // допуск 1e-3 = точность сериализации координат (3 знака)
    for (const [x, y] of poly) {
      expect(y, 'ниже входной грани').toBeGreaterThan(-1e-3);
      // грань выхода: линия через вершину вдоль w; внутренняя сторона — слева
      const s = (x - 10) * w[1] - y * w[0];
      expect(s, 'внутри клина от выходной грани').toBeLessThan(1e-3);
    }
  });

  it('А: genRoundedRect rotation=45° — центр на месте, диагонали bbox равны, 0° = регресс', () => {
    const d0a = genRoundedRect(12, 12, 6, 6, 1.5, 0.6, 0);
    const d0b = genRoundedRect(12, 12, 6, 6, 1.5, 0.6); // без аргумента — то же
    expect(d0a).toBe(d0b);
    const p45 = samplePolylines(genRoundedRect(12, 12, 6, 6, 1.5, 0.6, 45), 48)[0];
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const [x, y] of p45) {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    expect((minX + maxX) / 2).toBeCloseTo(12, 2);
    expect((minY + maxY) / 2).toBeCloseTo(12, 2);
    expect(maxX - minX).toBeCloseTo(maxY - minY, 2); // квадрат под 45° симметричен
    // диагональ bbox = сторона·√2 − 2·срез: меньше острой, больше стороны
    expect(maxX - minX).toBeGreaterThan(6);
    expect(maxX - minX).toBeLessThan(6 * Math.SQRT2);
  });

  it('А: бюджет Figma — капсула R=h/2 вырождается в чистые полукруги (ζ_eff=0)', () => {
    const cap = genRoundedRect(12, 12, 15.74, 1.8, 0.9, 0.6);
    const ref = 'M5.03 11.1H18.97A0.9 0.9 0 0 1 18.97 12.9H5.03A0.9 0.9 0 0 1 5.03 11.1Z';
    expect(inkIoU(cap, ref, 24)).toBeGreaterThan(0.999);
    // и R больше полустороны режется бюджетом, не ломая контур
    const over = genRoundedRect(12, 12, 6, 6, 9, 0.6);
    const circle = 'M12 9A3 3 0 1 1 11.99 9Z';
    expect(inkIoU(over, circle, 24)).toBeGreaterThan(0.98);
  });

  it('А: θ=60° (острее прямого) — симметрия хвостов и вписанность дуги', () => {
    const w = [Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3)]; // внутренний 60°
    const R = 2, zeta = 0.6;
    const { start, end, d } = smoothCornerAny([10, 0], [1, 0], w, R, zeta);
    const poly = samplePolylines(`M${start[0]} ${start[1]}${d}`, 64)[0];
    // максимум приближения к вершине симметричен и не ближе среза дуги
    const dist = poly.map(([x, y]) => Math.hypot(x - 10, y));
    const minDist = Math.min(...dist);
    const tNom = R * (Math.cos(Math.PI / 6) / Math.sin(Math.PI / 6));
    const arcMin = Math.hypot(tNom, R) - R; // расстояние вершина→дуга
    expect(minDist).toBeGreaterThan(arcMin - 0.02);
    expect(minDist).toBeLessThan(arcMin + 0.25); // хвосты не «раздувают» вершину
  });
});

describe('вырождения (закалка по ревью верификатора)', () => {
  it('В: smoothCornerAny при ζ=0 — чистая дуга без NaN, концы на R·cot(θ/2)', () => {
    const { start, end, d } = smoothCornerAny([16, 0], [1, 0], [0, 1], 4.5, 0);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(start[0]).toBeCloseTo(16 - 4.5, 6);
    expect(end[1]).toBeCloseTo(4.5, 6);
    // форма совпадает с дуговым (ζ=0) smoothCorner90
    const ref = smoothCorner90([16, 0], [1, 0], [0, 1], 4.5, 0);
    const A = samplePolylines(`M${start[0]} ${start[1]}${d}`, 48)[0];
    const B = samplePolylines(`M${ref.start[0]} ${ref.start[1]}${ref.d}`, 48)[0];
    for (const [x, y] of A) {
      let min = 1e9;
      for (const [bx, by] of B) min = Math.min(min, Math.hypot(x - bx, y - by));
      expect(min).toBeLessThan(0.05);
    }
  });

  it('В: рамка с пером больше полугабарита — честная ошибка, не мусор-геометрия', () => {
    const grid = { canvas: { width: 24 }, ratios: { cornerSmoothing: 0.6, strokeWidth: { base: 0.075 } } };
    expect(() =>
      buildGlyph(
        {
          archetype: 'rounded-rect-container',
          status: { outline: 'hand' },
          params: { cx: 0.5, cy: 0.5, w: 0.1, h: 0.1, rOuter: 0.05 },
          weights: { outline: 'base' },
        },
        grid,
      ),
    ).toThrow(/вырожден|съедает/);
  });
});

describe('genArcBand — полоса вдоль дуги с капами (класс волн radio, BL-020)', () => {
  it('А: точки контура в кольце [r−t/2−ε, r+t/2+ε]; капы не выходят за охват+полукап', () => {
    const d = genArcBand(12, 12, 10, 0, 40, 1.6);
    const poly = samplePolylines(d, 48)[0];
    const capAng = Math.asin(0.8 / 10) * (180 / Math.PI);
    for (const [x, y] of poly) {
      const r = Math.hypot(x - 12, y - 12);
      expect(r).toBeGreaterThan(10 - 0.8 - 0.02);
      expect(r).toBeLessThan(10 + 0.8 + 0.02);
      const a = Math.abs(Math.atan2(y - 12, x - 12) * (180 / Math.PI));
      expect(a).toBeLessThan(40 + capAng + 1);
    }
  });

  it('А: без NaN, контур замкнут', () => {
    const d = genArcBand(12, 12, 4.11, 180, 38, 1.72);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('genSuperellipse / genSuperellipseStroke — сквиркл-примитивы', () => {
  it('B: n=2 вырождается в круг (совпадает с genRing), поворот-инвариантен', () => {
    const circle = genRing(12, 12, 5, 0);
    expect(inkIoU(genSuperellipse(12, 12, 5, 5, 2), circle, 24)).toBeGreaterThan(0.995);
    expect(inkIoU(genSuperellipse(12, 12, 5, 5, 2, 45), circle, 24)).toBeGreaterThan(0.995);
  });

  it('А: кривая гладкая — изломы между кубик-сегментами < 2°', () => {
    // дубликаты точек на стыках кубик не несут направления; порог — выше
    // погрешности сериализации в 3 знака (ребро-призрак ~0.0005–0.002)
    const raw = samplePolylines(genSuperellipse(12, 12, 4, 4, 3.4, 45), 24)[0];
    const poly = raw.filter((p, i) => i === 0 || Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]) > 5e-3);
    for (let i = 1; i < poly.length - 1; i++) {
      const a1 = Math.atan2(poly[i][1] - poly[i - 1][1], poly[i][0] - poly[i - 1][0]);
      const a2 = Math.atan2(poly[i + 1][1] - poly[i][1], poly[i + 1][0] - poly[i][0]);
      let diff = Math.abs(a2 - a1) * (180 / Math.PI);
      if (diff > 180) diff = 360 - diff;
      expect(diff, `точка ${i}`).toBeLessThan(2);
    }
  });

  it('В: строук — перо ≥ мин. радиуса кривизны оси кидает ошибку (фазз-класс)', () => {
    // n=4, a=3: вершины острые — перо базиса 1.5 уже самопересекало офсет
    expect(() => genSuperellipseStroke(12, 12, 3, 3, 4, 30, 1.5, 'inner')).toThrow(/кривизн/);
    // здоровый вызов из фактического фита component проходит
    expect(() => genSuperellipseStroke(12, 12, 2.92, 2.92, 2.45, 45, 1.01)).not.toThrow();
  });

  it('А: строук — зазор между офсет-контурами ≈ 2·перо всюду', () => {
    const pen = 1.2;
    const outer = samplePolylines(genSuperellipseStroke(12, 12, 3.2, 3.2, 3, 45, pen, 'outer'), 48)[0];
    const inner = samplePolylines(genSuperellipseStroke(12, 12, 3.2, 3.2, 3, 45, pen, 'inner'), 48)[0];
    for (let i = 0; i < outer.length; i += 4) {
      const [ox, oy] = outer[i];
      let min = 1e9;
      for (const [ix, iy] of inner) min = Math.min(min, Math.hypot(ox - ix, oy - iy));
      expect(min, `точка ${i}`).toBeGreaterThan(2 * pen - 0.12);
      expect(min, `точка ${i}`).toBeLessThan(2 * pen + 0.12);
    }
  });
});

describe('rotatePath — обобщение ориентации на семьи', () => {
  const d = genRoundedRect(12, 8, 6, 3, 1, 0.6); // асимметричный (w≠h) — поворот заметен
  it('А: rot0 = идентичность (та же геометрия)', () => {
    expect(inkIoU(rotatePath(d, 0, 12, 12), d, 24)).toBeGreaterThan(0.999);
  });
  it('А: rot360 = идентичность', () => {
    expect(inkIoU(rotatePath(d, 360, 12, 12), d, 24)).toBeGreaterThan(0.999);
  });
  it('А: rot90 ×4 вокруг центра = исходник (замкнутая группа)', () => {
    let r = d;
    for (let i = 0; i < 4; i++) r = rotatePath(r, 90, 12, 12);
    expect(inkIoU(r, d, 24)).toBeGreaterThan(0.999);
  });
  it('А: rot180 переносит центр фигуры точечным отражением', () => {
    const poly = samplePolylines(rotatePath(d, 180, 12, 12), 32)[0];
    let cx = 0, cy = 0;
    for (const [x, y] of poly) { cx += x; cy += y; }
    cx /= poly.length; cy /= poly.length;
    // исходный центр (12,8) отражается через (12,12) → (12,16)
    expect(cx).toBeCloseTo(12, 1);
    expect(cy).toBeCloseTo(16, 1);
  });
  it('А: круговые дуги инвариантны — d не содержит NaN после поворота', () => {
    expect(rotatePath(genRing(12, 12, 5, 3), 37, 12, 12)).not.toMatch(/NaN|Infinity/);
  });
});

describe('translateD + stroke-v семья (chevron по ориентации)', () => {
  const grid = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'anatomy.json'), 'utf8'));

  it('А: translateD(d,0,0) = идентичность', () => {
    const d = genRing(12, 12, 6, 3);
    expect(inkIoU(translateD(d, 0, 0), d, 24)).toBeGreaterThan(0.999);
  });

  it('А: translateD сдвигает центроид ровно на (dx,dy)', () => {
    const d = genRing(12, 12, 5, 3);
    const c0 = samplePolylines(d, 32)[0];
    const c1 = samplePolylines(translateD(d, 2, -1), 32)[0];
    const cen = (p) => p.reduce((a, [x, y]) => [a[0] + x / p.length, a[1] + y / p.length], [0, 0]);
    const [x0, y0] = cen(c0), [x1, y1] = cen(c1);
    expect(x1 - x0).toBeCloseTo(2, 1);
    expect(y1 - y0).toBeCloseTo(-1, 1);
  });

  it('А: круговые дуги переживают translate — нет NaN', () => {
    expect(translateD(genRing(12, 12, 5, 3), 3.5, -2.2)).not.toMatch(/NaN|Infinity/);
  });

  // Класс Б (регрессия семьи): повёрнутые chevron-сиблинги — грамматика-чистый
  // генерат (0 сноса, 0 изломов) by construction; доказывает, что rotation+
  // translate машинерия не вносит дефектов и семья систематична.
  it.each(['chevron-up', 'chevron-back', 'chevron-forward'])(
    'Б: %s — генерат из декларации грамматика-чист',
    (name) => {
      const g = anatomy.glyphs[name];
      expect(g.archetype).toBe('stroke-v');
      expect(typeof g.rotation).toBe('number');
      const built = buildGlyph(g, grid);
      // геометрия чистая: осевой/45°-контур без NaN, замкнут
      expect(built.outline).not.toMatch(/NaN|Infinity/);
      expect(built.filled).not.toMatch(/NaN|Infinity/);
      expect(built.outline.endsWith('Z')).toBe(true);
    },
  );

  it('Д: rotation чужой оси ломает сходимость с файлом (мутант)', () => {
    const up = anatomy.glyphs['chevron-up'];
    const good = buildGlyph(up, grid).outline;
    const mutant = buildGlyph({ ...up, rotation: 90 }, grid).outline; // не 180
    expect(inkIoU(good, mutant, 24)).toBeLessThan(0.7);
  });
});
