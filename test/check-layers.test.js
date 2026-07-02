/**
 * test/check-layers.test.js — гейт per-icon разметки (semantics/layers.json).
 *
 * Контракт validateLayers: разметка бьётся с реальными SVG (индексы слоёв,
 * якоря в границах viewBox) и с генератом (анти-дрифт: layers.json ↔
 * icon-choreographies.generated.json). Классы: А (юнит валидации),
 * Д-паттерн (каждая проверка доказана мутацией фикстуры → ошибка).
 */

import { describe, expect, it } from 'vitest';
import { validateLayers } from '../scripts/check-layers.js';

// Минимальная валидная фикстура: 1 иконка, 2 слоя, per-icon разметка + генерат.
const SVG_TWO_PATHS =
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
  '<path d="M4 4h6v6H4z"/><path d="M14 14h6v6h-6z"/></svg>';

function fixture() {
  const layers = {
    version: 1,
    icons: {
      demo: {
        outline: {
          parts: [
            { paths: [1], part: 'глиф', anchor: [12, 13], motion: 'spin-cycle' },
          ],
          clip: { motion: 'reveal-check' },
        },
      },
    },
  };
  const generated = {
    provenance: { motionSha: 'abc123def456' },
    icons: {
      demo: {
        outline: {
          parts: [
            {
              paths: [1],
              anchor: [12, 13],
              keyframes: [
                { offset: 0, transform: 'rotate(0deg)' },
                { offset: 1, transform: 'rotate(360deg)' },
              ],
              timing: {
                duration: 900,
                delay: 0,
                iterations: 1,
                direction: 'normal',
                fill: 'both',
                easing: 'linear',
              },
            },
          ],
          clip: {
            keyframes: [
              { offset: 0, clipPath: 'inset(0 100.00% 0 0)' },
              { offset: 1, clipPath: 'inset(0 -2.00% 0 0)' },
            ],
            timing: {
              duration: 450,
              delay: 0,
              iterations: 1,
              direction: 'normal',
              fill: 'both',
              easing: 'linear',
            },
          },
        },
      },
    },
  };
  const assignments = { demo: { class: 'spin' } };
  const readSvg = () => SVG_TWO_PATHS;
  return { layers, generated, assignments, readSvg };
}

describe('validateLayers — гейт per-icon разметки', () => {
  it('А: валидная фикстура → ноль ошибок', () => {
    expect(validateLayers(fixture())).toEqual([]);
  });

  it('А: имя не из семантики → ошибка', () => {
    const f = fixture();
    f.layers.icons['no-such'] = f.layers.icons.demo;
    f.generated.icons['no-such'] = f.generated.icons.demo;
    expect(validateLayers(f).some((e) => e.includes('no-such'))).toBe(true);
  });

  it('А: path-индекс за пределами реального SVG → ошибка', () => {
    const f = fixture();
    f.layers.icons.demo.outline.parts[0].paths = [2];
    f.generated.icons.demo.outline.parts[0].paths = [2];
    expect(validateLayers(f).some((e) => e.includes('индекс'))).toBe(true);
  });

  it('А: якорь вне границ viewBox → ошибка', () => {
    const f = fixture();
    f.layers.icons.demo.outline.parts[0].anchor = [25, 13];
    f.generated.icons.demo.outline.parts[0].anchor = [25, 13];
    expect(validateLayers(f).some((e) => e.includes('якорь'))).toBe(true);
  });

  it('А: дрифт — иконка есть в layers, нет в генерате → ошибка', () => {
    const f = fixture();
    delete f.generated.icons.demo;
    expect(validateLayers(f).some((e) => e.includes('генерат'))).toBe(true);
  });

  it('А: дрифт — генерат содержит лишнюю иконку → ошибка', () => {
    const f = fixture();
    f.generated.icons.extra = f.generated.icons.demo;
    f.assignments.extra = { class: 'spin' };
    expect(validateLayers(f).some((e) => e.includes('extra'))).toBe(true);
  });

  it('А: дрифт — якорь в генерате отличается от layers → ошибка', () => {
    const f = fixture();
    f.generated.icons.demo.outline.parts[0].anchor = [12, 14];
    expect(validateLayers(f).some((e) => e.includes('якор'))).toBe(true);
  });

  it('А: неконечное число в кейфреймах генерата → ошибка', () => {
    const f = fixture();
    f.generated.icons.demo.outline.parts[0].keyframes[1].offset = NaN;
    expect(validateLayers(f).some((e) => e.includes('конеч'))).toBe(true);
  });

  it('А: clip заявлен в layers, отсутствует в генерате → ошибка', () => {
    const f = fixture();
    delete f.generated.icons.demo.outline.clip;
    expect(validateLayers(f).some((e) => e.includes('clip'))).toBe(true);
  });

  it('А: provenance без motionSha → ошибка', () => {
    const f = fixture();
    f.generated.provenance = {};
    expect(validateLayers(f).some((e) => e.includes('provenance'))).toBe(true);
  });

  it('А: дубль path-индекса между частями одной записи → ошибка', () => {
    const f = fixture();
    f.layers.icons.demo.outline.parts.push({
      paths: [1],
      part: 'дубль',
      anchor: [12, 12],
      motion: 'spin-cycle',
    });
    f.generated.icons.demo.outline.parts.push({
      ...f.generated.icons.demo.outline.parts[0],
    });
    expect(validateLayers(f).some((e) => e.includes('дубл'))).toBe(true);
  });
});

describe('validateLayers — морфы (BL-007)', () => {
  function morphFixture() {
    const f = fixture();
    f.layers.icons.demo.outline.morphs = [{ path: 1, part: 'песок', motion: 'sand-pour' }];
    f.generated.icons.demo.outline.morphs = [
      {
        path: 1,
        values: ['M14 14h6v6h-6z', 'M14 20h6v-6h-6z', 'M14 14h6v6h-6z'],
        keyTimes: [0, 0.5, 1],
        durationMs: 1500,
      },
    ];
    return f;
  }

  it('А: валидный морф → ноль ошибок', () => {
    expect(validateLayers(morphFixture())).toEqual([]);
  });

  it('А: морф без identity-краёв (первая форма ≠ d слоя) → ошибка', () => {
    const f = morphFixture();
    f.generated.icons.demo.outline.morphs[0].values[0] = 'M14 15h6v6h-6z';
    expect(validateLayers(f).some((e) => e.includes('морф'))).toBe(true);
  });

  it('А: структура команд форм разошлась → ошибка', () => {
    const f = morphFixture();
    f.generated.icons.demo.outline.morphs[0].values[1] = 'M14 20L20 14L14 14z';
    expect(validateLayers(f).some((e) => e.includes('структур'))).toBe(true);
  });

  it('А: keyTimes не покрывают [0,1] → ошибка', () => {
    const f = morphFixture();
    f.generated.icons.demo.outline.morphs[0].keyTimes = [0, 0.5, 0.9];
    expect(validateLayers(f).some((e) => e.includes('keyTimes'))).toBe(true);
  });

  it('А: морф есть в layers, нет в генерате → ошибка', () => {
    const f = morphFixture();
    delete f.generated.icons.demo.outline.morphs;
    expect(validateLayers(f).some((e) => e.includes('морф') || e.includes('morph'))).toBe(true);
  });

  it('А: форма морфа вылезает за viewBox → ошибка', () => {
    const f = morphFixture();
    f.generated.icons.demo.outline.morphs[0].values[1] = 'M14 22h6v6h-6z';
    expect(validateLayers(f).some((e) => e.includes('viewBox') || e.includes('канв'))).toBe(true);
  });
});
