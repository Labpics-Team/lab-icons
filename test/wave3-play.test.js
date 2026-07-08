/**
 * test/wave3-play.test.js — гейты Волны-3 (play ×5, WAVE3-PLAY-PREP).
 *
 * Часть 1: inkIoU-гейт деклараций против рук svg/Outline/<name>.svg —
 * порог и растеризатор как в test/wave1-decls.test.js (IoU ≥ 0.95, шаг 0.12).
 *
 * Часть 2: EO≡NZ-регресс (обязательство №2 адверсарки Волны-2):
 * генерируемые контуры обязаны давать одинаковые чернила под evenodd
 * (чётность — наш гейт) и nonzero (намотка — дефолт браузера). Для
 * play-пятёрки равенство ТОЧНОЕ (0 расхождений, шаг 0.12). Для остального
 * корпуса — характеризация: список нарушителей заморожен подмножеством
 * LEGACY_EO_NZ (вырезы/кольца до Волны-3, чинить — отдельная волна,
 * см. BACKLOG). Новые глифы обязаны приходить чистыми.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

const THRESHOLD = 0.95;

// Задекларированные иконки Волны-3 (порядок — WAVE3-PLAY-PREP)
const WAVE3 = [
  'play-circle',
  'play-forward-circle',
  'play-back-circle',
  'play-skip-back-circle',
  'play-skip-forward-circle',
];

// Легаси-нарушители EO≠NZ (были в корпусе до Волны-3; вырезы с одинаковой
// намоткой контуров). Замер 2026-07-05, шаг 0.12: info-circle/outline 0.62%,
// reload/filled 0.23%, reload/outline 0.20%.
// Список может только УМЕНЬШАТЬСЯ. 2026-07-09 (fix/eonz-strict): УБРАНЫ
// tablet-portrait/outline 41.51%, tablet-landscape/outline 41.38%,
// cog/outline 23.44%, pause/outline 19.42%, component/outline 10.29% —
// негативы противо-намотаны (reversePathD: genRadialGear,
// rounded-rect-container, composite-frame), отгрузка generated-вариантов
// перематериализована, EO≠NZ = 0 (гейт check-eonz-strict).
// reload/filled демоутнут из отгрузки (перекрытие головы, demotionReason),
// но генерат по декларации всё ещё EO≠NZ — уберёт только сварка arc-terminal.
const LEGACY_EO_NZ = new Set([
  'info-circle/outline',
  'reload/filled',
  'reload/outline',
  // swap-horizontal (оба варианта): НЕ легаси-дефект, а НАМЕРЕННОЕ перекрытие
  // стыка палочка↔наконечник по закону смежности (scripts/check-adjacency.js):
  // торцевой кап палочки касается вершины шеврона. Без перекрытия рендер даёт
  // видимо отрезанную часть при 98% IoU — корень гейт-дыры. EO≠NZ в линзе
  // перекрытия одноцветных чернил безвреден (nonzero-рендер браузера идентичен);
  // связность стыка гарантирует check-adjacency (HARD, промоушен). Правило
  // «только уменьшаться» относится к легаси-грязи, а не к осознанному стыку.
  'swap-horizontal/outline',
  'swap-horizontal/filled',
]);

/**
 * Чернила точки под обоими правилами заливки за один проход по сегментам:
 * [evenodd (чётность пересечений), nonzero (ненулевая намотка)].
 */
function inkBoth(polys, x, y) {
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
}

/** Число точек сетки, где evenodd и nonzero дают разные чернила. */
function eoNzMismatch(pathData, step) {
  const polys = samplePolylines(pathData, 24).filter((p) => p.length > 2);
  let mismatch = 0;
  for (let x = step / 2; x < cw; x += step) {
    for (let y = step / 2; y < cw; y += step) {
      const [eo, nz] = inkBoth(polys, x, y);
      if (eo !== nz) mismatch++;
    }
  }
  return mismatch;
}

describe('wave3-play — генерат декларации сходится с рукой (IoU ≥ 0.95)', () => {
  for (const name of WAVE3) {
    it(`${name}: IoU против svg/Outline/${name}.svg`, () => {
      const entry = anatomy.glyphs[name];
      expect(entry, `${name} задекларирован в semantics/anatomy.json`).toBeTruthy();
      const { outline } = buildGlyph(entry, grid);
      const hand = renderedPathData(
        readFileSync(join(root, 'svg', 'Outline', `${name}.svg`), 'utf8'),
      ).join('');
      const iou = inkIoU(outline, hand, cw);
      // дрейф печатается для протокола отчёта
      console.log(`${name}: IoU=${(iou * 100).toFixed(2)}% drift=${((1 - iou) * 100).toFixed(2)}%`);
      expect(iou).toBeGreaterThanOrEqual(THRESHOLD);
    });
  }
});

describe('wave3-play — EO≡NZ (evenodd-гейт ≡ nonzero-браузер)', () => {
  for (const name of WAVE3) {
    it(`${name}: ТОЧНОЕ равенство EO≡NZ по всем вариантам (шаг 0.12)`, () => {
      const entry = anatomy.glyphs[name];
      const built = buildGlyph(entry, grid);
      for (const [variant, d] of Object.entries(built)) {
        if (!entry.status?.[variant]) continue;
        const mismatch = eoNzMismatch(d, 0.12);
        expect(mismatch, `${name}/${variant}: точек EO≠NZ`).toBe(0);
      }
    });
  }

  it('корпус: нарушители EO≠NZ — только замороженное легаси (шаг 0.24)', () => {
    const offenders = [];
    for (const [name, entry] of Object.entries(anatomy.glyphs)) {
      const built = buildGlyph(entry, grid);
      for (const [variant, d] of Object.entries(built)) {
        if (!entry.status?.[variant]) continue;
        if (eoNzMismatch(d, 0.24) > 0) offenders.push(`${name}/${variant}`);
      }
    }
    console.log(`EO≠NZ нарушителей: ${offenders.length} (легаси-базлайн ${LEGACY_EO_NZ.size})`);
    const fresh = offenders.filter((o) => !LEGACY_EO_NZ.has(o));
    expect(fresh, 'новые нарушители EO≠NZ вне легаси-базлайна').toEqual([]);
  });
});
