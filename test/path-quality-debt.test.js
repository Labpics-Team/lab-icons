/**
 * test/path-quality-debt.test.js — per-source debt ledger.
 *
 * Класс дефекта (invert_filled, 2026-08-15): находки уровня слоя
 * («file.svg слой 0: …») группировались по первому «:», ключ не совпадал
 * со snapshot-ключом «file.svg», и рост долга слоёв молча выпадал из
 * сравнения. Тесты фиксируют канонизацию ключа и closed world.
 */

import { describe, expect, it } from 'vitest';
import {
  buildPerSourceSnapshot,
  comparePerSourceDebt,
  findingsByFile,
} from '../scripts/lib/path-quality-debt.js';

describe('findingsByFile — канонический ключ source-файла', () => {
  it('файловые и слойные находки агрегируются под одним ключом', () => {
    const map = findingsByFile([
      'Filled/invert_filled.svg: встык-шов между path 0↔1',
      'Filled/invert_filled.svg слой 0: микросегмент 0.030',
      'Filled/invert_filled.svg слой 1: лишний узел',
    ]);
    expect(map).toEqual({ 'Filled/invert_filled.svg': 3 });
  });

  it('находка без file-ключа — ошибка, а не молчаливый пропуск', () => {
    expect(() => findingsByFile(['мусор без файла'])).toThrow(/file-ключа/);
  });
});

describe('comparePerSourceDebt — регрессия и closed world', () => {
  it('рост долга слойных находок против snapshot — регрессия (класс invert_filled)', () => {
    const errors = comparePerSourceDebt(
      ['Filled/invert_filled.svg слой 0: микросегмент', 'Filled/invert_filled.svg: встык-шов'],
      { 'Filled/invert_filled.svg': 0 },
    );
    expect(errors).toEqual([
      'Filled/invert_filled.svg: 2 находок (было 0) — регрессия +2',
    ]);
  });

  it('долг в пределах baseline — проходит', () => {
    expect(
      comparePerSourceDebt(
        ['Outline/a.svg слой 0: излом'],
        { 'Outline/a.svg': 3 },
      ),
    ).toEqual([]);
  });

  it('файл с находками вне snapshot — нарушение closed world, не PASS', () => {
    const errors = comparePerSourceDebt(
      ['Outline/new.svg слой 0: излом'],
      {},
    );
    expect(errors).toEqual([
      'Outline/new.svg: 1 находок, файла нет в snapshot — closed world нарушен',
    ]);
  });
});

describe('comparePerSourceDebt — двусторонний closed world (покрытие корпуса)', () => {
  it('файл корпуса без ключа в snapshot — нарушение, даже при 0 находках', () => {
    // Класс дефекта: удаление ключа «чистого» файла из snapshot молча
    // выводило файл из-под гейта — будущий долг стал бы невидим.
    const errors = comparePerSourceDebt(
      [],
      { 'Outline/a.svg': 0 },
      ['Outline/a.svg', 'Outline/b.svg'],
    );
    expect(errors).toEqual([
      'Outline/b.svg: файла нет в snapshot — closed world обязан покрывать весь корпус',
    ]);
  });

  it('полное покрытие корпуса — ошибок нет', () => {
    expect(
      comparePerSourceDebt([], { 'Outline/a.svg': 0, 'Outline/b.svg': 2 }, [
        'Outline/a.svg',
        'Outline/b.svg',
      ]),
    ).toEqual([]);
  });
});

describe('buildPerSourceSnapshot — воспроизводимое переснятие', () => {
  it('фиксирует нулём файлы без находок (closed world)', () => {
    const snap = buildPerSourceSnapshot(
      ['Outline/a.svg слой 0: излом', 'Outline/a.svg: шов'],
      ['Outline/a.svg', 'Outline/b.svg'],
      'тест',
    );
    expect(snap.byFile).toEqual({ 'Outline/a.svg': 2, 'Outline/b.svg': 0 });
  });

  it('находка для файла вне корпуса — ошибка', () => {
    expect(() =>
      buildPerSourceSnapshot(['Outline/ghost.svg: шов'], ['Outline/a.svg'], 'тест'),
    ).toThrow(/вне корпуса/);
  });
});
