/**
 * test/check-dry-coverage.test.js — фундамент-гейт РАЗДЕЛЯЕМОСТИ примитивов (DRY).
 *
 * Классы Фаулера:
 *   Д (гейт доказан нарушителем, RED-first): флагман из one-off безье (ноль общих
 *      примитивов) ОБЯЗАН упасть; до гейта этот дефект был невидим.
 *   Д (не-дублирование): гейт ключён на МЕЖ-иконочную разделяемость примитива —
 *      измерение, которого нет ни у check-anatomy(-drift) (скелет/дрейф одной
 *      иконки), ни у check-path-quality (шум кривых), ни у check-fill-rule
 *      (evenodd/nonzero). Тот же вход (bad vs good) отличается ТОЛЬКО выбором
 *      общий-примитив-vs-one-off, значит именно это и меряется.
 *   А (синтетика): математика покрытия — shared при ≥2 потребителях, транскрипция
 *      исключена даже при ≥2, порог 1.0 как экстремум «ноль one-off».
 *   Б (регрессия): реальный master-корпус + flagships.json → гейт ЗЕЛЁНЫЙ (не
 *      зелёный-с-рождения: на bad-фикстуре он красный), verify не регрессирует.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildPrimitiveUsers,
  evaluateDry,
  flagshipNames,
  glyphCoverage,
  glyphUnits,
  isShared,
  FLAGSHIP_COVERAGE_THRESHOLD,
  TRANSCRIPTION_PRIMITIVES,
} from '../scripts/lib/dry-coverage.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const gate = join(root, 'scripts', 'check-dry-coverage.js');
const fx = (name) => join(root, 'test', 'fixtures', name);

/** exit-код CLI: 0 при успехе, ненулевой (status) при FAIL. */
function runGate(args) {
  try {
    execFileSync('node', [gate, ...args], { encoding: 'utf8' });
    return 0;
  } catch (e) {
    return e.status ?? 1;
  }
}

describe('А: математика покрытия примитивами', () => {
  const glyphs = {
    a: { archetype: 'composite', parts: [{ primitive: 'rect' }, { primitive: 'dot' }] },
    b: { archetype: 'composite', parts: [{ primitive: 'rect' }] },
    solo: { archetype: 'composite', parts: [{ primitive: 'unique-blob' }] },
    less: { archetype: 'stroke-v' }, // part-less → архетип = единица
  };
  const users = buildPrimitiveUsers(glyphs);

  it('glyphUnits: parts → имена примитивов; part-less → [archetype]', () => {
    expect(glyphUnits(glyphs.a)).toEqual(['rect', 'dot']);
    expect(glyphUnits(glyphs.less)).toEqual(['stroke-v']);
  });

  it('shared только при ≥2 разных потребителях', () => {
    expect(isShared('rect', users)).toBe(true); // a, b
    expect(isShared('dot', users)).toBe(false); // только a
    expect(isShared('unique-blob', users)).toBe(false); // только solo
  });

  it('FROZEN MUST: транскрипция НЕ shared даже при ≥2 потребителях', () => {
    const t = { x: { parts: [{ primitive: 'bezier' }] }, y: { parts: [{ primitive: 'bezier' }] } };
    const u = buildPrimitiveUsers(t);
    expect(u.get('bezier').size).toBe(2); // формально разделён
    expect(isShared('bezier', u)).toBe(false); // но по закону — нет
    expect(TRANSCRIPTION_PRIMITIVES.has('bezier')).toBe(true);
  });

  it('malformed (non-string) primitive → бакет "complex" НЕ shared даже при ≥2', () => {
    // КЛАСС: часть без валидного имени примитива-генератора = СЫРАЯ/неопознанная
    // геометрия, не переиспользуемый блок. Две такие части в разных глифах не
    // должны маскироваться под общий примитив (иначе флагман из мусора пройдёт DRY).
    const m = { p: { parts: [{ primitive: null }] }, q: { parts: [{ params: {} }] } };
    const u = buildPrimitiveUsers(m);
    expect(u.get('complex').size).toBe(2); // формально «разделён» — 2 потребителя
    expect(isShared('complex', u)).toBe(false); // но по закону — нет (сырьё)
    expect(TRANSCRIPTION_PRIMITIVES.has('complex')).toBe(true);
  });

  it('флагман целиком из malformed-частей → evaluateDry НЕ ok (гейт кусается)', () => {
    const anatomy = {
      glyphs: {
        junk: { tier: 'flagship', parts: [{ primitive: null }, { primitive: 7 }] },
        h1: { parts: [{ primitive: null }] }, // даёт «complex» второго потребителя
      },
    };
    const r = evaluateDry({ anatomy });
    expect(r.ok).toBe(false); // до фикса «complex» был бы shared → ложный PASS
    expect(r.zeroShared.map((f) => f.name)).toContain('junk');
  });

  it('coverage = доля общих блоков; порог = 1.0', () => {
    expect(glyphCoverage('a', glyphs, users).coverage).toBe(0.5); // rect общий, dot нет
    expect(glyphCoverage('solo', glyphs, users).coverage).toBe(0); // всё one-off
    expect(FLAGSHIP_COVERAGE_THRESHOLD).toBe(1);
  });
});

describe('Д: RED-proof — гейт кусается на one-off флагмане', () => {
  const badAnatomy = readJson(fx('dry-bad-anatomy.json'));
  const goodAnatomy = readJson(fx('dry-good-anatomy.json'));

  it('bad-фикстура (флагман целиком безье) → evaluateDry НЕ ok, zero-shared', () => {
    const r = evaluateDry({ anatomy: badAnatomy });
    expect(r.ok).toBe(false);
    expect(r.zeroShared.map((f) => f.name)).toContain('gadget');
  });

  it('bad-фикстура → CLI exit ≠ 0 (гейт валит цепочку)', () => {
    expect(runGate([fx('dry-bad-anatomy.json')])).not.toBe(0);
  });

  it('good-фикстура (флагман из общих примитивов) → evaluateDry ok', () => {
    const r = evaluateDry({ anatomy: goodAnatomy });
    expect(r.ok).toBe(true);
    expect(r.flagships.find((f) => f.name === 'gizmo').coverage).toBe(1);
  });

  it('good-фикстура → CLI exit 0', () => {
    expect(runGate([fx('dry-good-anatomy.json')])).toBe(0);
  });

  it('НЕ-ДУБЛИРОВАНИЕ: bad и good различаются ТОЛЬКО выбором примитива', () => {
    // Оба — валидные синтетические декларации; разница исключительно в
    // разделяемости примитива, которую не видит ни один другой гейт.
    expect(evaluateDry({ anatomy: badAnatomy }).ok).toBe(false);
    expect(evaluateDry({ anatomy: goodAnatomy }).ok).toBe(true);
  });
});

describe('Б: регрессия — реальный корпус master DRY-чист', () => {
  const anatomy = readJson(join(root, 'semantics', 'anatomy.json'));
  const manifest = readJson(join(root, 'semantics', 'flagships.json'));

  it('flagships.json ссылается только на существующие глифы', () => {
    const r = evaluateDry({ anatomy, manifest });
    expect(r.missing).toEqual([]);
  });

  it('все помеченные флагманы на 100% из общих примитивов', () => {
    const r = evaluateDry({ anatomy, manifest });
    expect(r.flagships.length).toBeGreaterThanOrEqual(12);
    const bad = r.flagships.filter((f) => f.coverage < 1).map((f) => f.name);
    expect(bad, `не-DRY флагманы: ${bad.join(', ')}`).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('flagshipNames = манифест ∪ inline tier', () => {
    const withInline = { glyphs: { ...anatomy.glyphs, plus: { ...anatomy.glyphs.plus, tier: 'flagship' } } };
    const names = flagshipNames(withInline, { flagships: ['close'] });
    expect(names).toContain('plus');
    expect(names).toContain('close');
  });

  it('корпусный прогон CLI (манифест + анатомия) → exit 0', () => {
    expect(runGate([])).toBe(0);
  });
});
