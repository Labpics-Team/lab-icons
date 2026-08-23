/**
 * INV-06: default `./ir` без регистрации корпуса не строит candidate-модели.
 *
 * Файл сознательно НЕ вызывает registerCandidates(): vitest изолирует
 * модульный граф per-file, поэтому реестр здесь пуст — в отличие от
 * ir-runtime.test.ts, где корпус зарегистрирован. Гейт проверяется по
 * состоянию модели (state !== 'accepted'), а не по наличию декларации:
 * mixed-иконки (candidate-вариант при декларации, попавшей в runtime через
 * accepted-соседа) обязаны падать так же, как pure-candidate.
 */
import { describe, expect, it } from 'vitest';

import { GlyphModelError, glyph, registerCandidateAnatomy } from '../src/ir/index.js';
import catalogJson from '../semantics/catalog.json';
import runtimeJson from '../semantics/anatomy.runtime.json';

const catalog = catalogJson as unknown as {
  icons: Record<
    string,
    {
      model?: {
        declaration: string;
        variants: Record<string, { state: string }>;
      };
    }
  >;
};

const runtimeDeclarations = new Set(
  Object.keys((runtimeJson as { glyphs: Record<string, unknown> }).glyphs),
);

type Pick = { icon: string; variant: 'outline' | 'filled' };
const pure: Pick[] = [];
const mixed: Pick[] = [];
for (const [icon, contract] of Object.entries(catalog.icons)) {
  const model = contract.model;
  if (!model) continue;
  for (const [variant, v] of Object.entries(model.variants)) {
    if (v.state === 'accepted') continue;
    const bucket = runtimeDeclarations.has(model.declaration) ? mixed : pure;
    bucket.push({ icon, variant: variant as Pick['variant'] });
  }
}

// Контракт ошибки гейта: машинный код (публичный контракт) + субпат в тексте
// (подсказка человеку; текст контрактом не является, но упоминание пути полезно).
function expectCandidatesRequired(fn: () => unknown): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(GlyphModelError);
  expect((thrown as GlyphModelError).code).toBe('CANDIDATES_REQUIRED');
  expect((thrown as GlyphModelError).message).toMatch(/ir\/candidates/);
}

describe('INV-06: candidate-гейт fail-closed без registerCandidates()', () => {
  it('корпус содержит оба класса candidate-моделей (иначе тест-театр)', () => {
    expect(pure.length).toBeGreaterThan(0);
    expect(mixed.length).toBeGreaterThan(0);
  });

  it('pure-candidate падает кодом CANDIDATES_REQUIRED с указанием субпата', () => {
    for (const { icon, variant } of pure.slice(0, 5)) {
      expectCandidatesRequired(() =>
        glyph({ icon: icon as never, variant, modelMode: 'allow-candidate' }),
      );
    }
  });

  it('mixed-candidate (декларация в runtime) падает так же, не строится молча', () => {
    for (const { icon, variant } of mixed) {
      expectCandidatesRequired(() =>
        glyph({ icon: icon as never, variant, modelMode: 'allow-candidate' }),
      );
    }
  });

  it('default-режим тех же имён отдаёт source fallback без ошибки', () => {
    const sample = [...pure.slice(0, 2), ...mixed.slice(0, 2)];
    for (const { icon, variant } of sample) {
      const ir = glyph({ icon: icon as never, variant });
      expect(ir.provenance.kind).toBe('source');
    }
  });

  it('пустая регистрация не открывает гейт (обход из финального ревью PR #85)', () => {
    registerCandidateAnatomy({});
    const { icon, variant } = mixed[0]!;
    expectCandidatesRequired(() =>
      glyph({ icon: icon as never, variant, modelMode: 'allow-candidate' }),
    );
  });
});
