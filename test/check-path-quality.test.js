/**
 * test/check-path-quality.test.js — гейт чистоты кривых (BL-013):
 * «отклонение от формы — шум». Классы: А (юниты на синтетике),
 * Д-паттерн (каждое правило доказано фикстурой-нарушителем). RED-first.
 */

import { describe, expect, it } from 'vitest';
import { validatePathQuality } from '../scripts/check-path-quality.js';

const wrap = (paths) =>
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
  paths.map((d) => `<path d="${d}"/>`).join('') +
  '</svg>';

const RATIOS = {
  microSegment: 0.05 / 24,
  nodeRedundancy: 0.02 / 24,
  seamGap: 0.15 / 24,
  almostSmoothMinDeg: 2,
  almostSmoothMaxDeg: 30,
  minSegmentForKink: 0.3 / 24,
};

function run(svg) {
  return validatePathQuality({
    grid: { canvas: { width: 24, height: 24 }, ratios: { pathQuality: RATIOS } },
    files: [{ name: 'demo.svg', content: svg }],
  });
}

describe('validatePathQuality — шум кривых', () => {
  it('А: чистый прямоугольник со скруглением → ноль находок', () => {
    expect(run(wrap(['M4 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4z']))).toEqual([]);
  });

  it('А: микросегмент (0.02) → находка «микросегмент»', () => {
    const errors = run(wrap(['M4 4h10l.02.01L14 16H4z']));
    expect(errors.some((e) => e.includes('микросегмент'))).toBe(true);
  });

  it('А: почти-гладкий излом (~10°) на длинных сегментах → находка «излом»', () => {
    // ломаная: горизонталь, затем сегмент под 10° — глаз читает как грязь
    const errors = run(wrap(['M2 12h8l7.88 1.39L18 20H2z']));
    expect(errors.some((e) => e.includes('излом'))).toBe(true);
  });

  it('А: осознанный угол (90°) → НЕ флагается', () => {
    expect(run(wrap(['M4 4h12v12H4z']))).toEqual([]);
  });

  it('А: лишний узел на прямой (коллинеарные L-L) → находка «лишний узел»', () => {
    const errors = run(wrap(['M4 4h6h6v12H4z']));
    expect(errors.some((e) => e.includes('лишний узел'))).toBe(true);
  });

  it('А: слои встык (нулевой шов) → находка «шов»', () => {
    // два прямоугольника, соприкасающиеся ровно по линии y=12
    const errors = run(wrap(['M6 4h12v8H6z', 'M6 12h12v8H6z']));
    expect(errors.some((e) => e.includes('шов'))).toBe(true);
  });

  it('А: слои с честным нахлёстом → шов НЕ флагается', () => {
    expect(run(wrap(['M6 4h12v9H6z', 'M6 11h12v9H6z']))).toEqual([]);
  });

  it('А: слои с честным зазором → не флагается', () => {
    expect(run(wrap(['M6 4h12v6H6z', 'M6 12h12v8H6z']))).toEqual([]);
  });
});

describe('validatePathQuality — фрагментация внутри evenodd-path (класс дырок cog)', () => {
  const wrapEO = (d) =>
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    `<path fill-rule="evenodd" d="${d}"/></svg>`;

  it('Д: пересекающиеся суб-пути одного evenodd-path → находка «дырка» (вычитание)', () => {
    // два квадрата с нахлёстом: у evenodd зона нахлёста БЕЛАЯ — волосяная
    // дырка класса cog (Figma-фрагментация)
    const errors = run(wrapEO('M4 4h8v8H4zM10 10h8v8h-8z'));
    expect(errors.some((e) => e.includes('evenodd') && e.includes('дырк'))).toBe(true);
  });

  it('А: вложенные суб-пути (честная дырка диск+глиф) → НЕ флагается', () => {
    const errors = run(wrapEO('M4 4h16v16H4zM10 10h4v4h-4z'));
    expect(errors.filter((e) => e.includes('evenodd'))).toEqual([]);
  });

  it('Д: суб-пути встык с волосяной щелью → находка «щель»', () => {
    // фрагменты одного вещества встык (зазор 0.03) — рендер даёт волосок
    const errors = run(wrapEO('M4 4h8v8H4zM12.03 4h8v8h-8z'));
    expect(errors.some((e) => e.includes('щель'))).toBe(true);
  });

  it('А: nonzero-path с нахлёстом суб-путей → НЕ флагается (нахлёст = чернила)', () => {
    const errors = run(wrap(['M4 4h8v8H4zM10 10h8v8h-8z']));
    expect(errors.filter((e) => e.includes('evenodd') || e.includes('щель'))).toEqual([]);
  });

  it('Д: волосяной вложенный фрагмент (толщина 0.02) → находка «фрагмент» (реальная механика дырок cog)', () => {
    // серп-заплатка внутри чернил: evenodd вычитает её в белый волосок
    const errors = run(wrapEO('M4 4h16v16H4zM8 8h6v.02H8z'));
    expect(errors.some((e) => e.includes('волосяной') && e.includes('фрагмент'))).toBe(true);
  });

  it('А: честная вложенная контрформа (толщина 4) → НЕ флагается', () => {
    const errors = run(wrapEO('M4 4h16v16H4zM9 9h6v6H9z'));
    expect(errors.filter((e) => e.includes('фрагмент'))).toEqual([]);
  });
});
