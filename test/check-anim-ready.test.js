/**
 * test/check-anim-ready.test.js — гейт готовности конструкции к анимации.
 *
 * Классы Фаулера:
 *   Д (RED-proof живёт в CI): сварная декларация time ИЗ MASTER (фикстура
 *      anim-welded-time-master.json, verbatim из git show master) ОБЯЗАНА
 *      уронить гейт (exit 1); текущая декларация ветки — пройти (exit 0).
 *   Д (мутанты декларации): anchor снят/вне канвы/не пара → hard.
 *   Д (счёт суб-путей кусается): деталь, дающая ≠1 суб-путь, флагается.
 *   Б (регрессия): корпус ветки чист — гейт не зелёный-с-рождения
 *      (красный доказан фикстурой) и не ломает verify.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAnimReadiness } from '../scripts/check-anim-ready.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const weldedFixture = JSON.parse(
  readFileSync(join(root, 'test', 'fixtures', 'anim-welded-time-master.json'), 'utf8'),
);

const runCli = (...args) =>
  spawnSync(process.execPath, [join(root, 'scripts', 'check-anim-ready.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });

describe('checkAnimReadiness — контракт подвижной части', () => {
  it('Д (RED-proof): сварная декларация time из master → hard о сварном примитиве', () => {
    const { hard } = checkAnimReadiness({ grid, anatomy: weldedFixture });
    expect(hard.some((e) => e.includes('time') && e.includes('clock-hands'))).toBe(true);
  });

  it('Б: корпус ветки чист — все подвижные части с anchor и раздельны', () => {
    const { hard, checkedParts } = checkAnimReadiness({ grid, anatomy });
    expect(hard).toEqual([]);
    // time: 2 стрелки × 2 варианта = минимум 4 проверенных детали
    expect(checkedParts).toBeGreaterThanOrEqual(4);
  });

  it('Д: мутант — anchor снят с подвижной части → hard об оси вращения', () => {
    const mutant = JSON.parse(JSON.stringify(anatomy));
    delete mutant.glyphs.time.parts[1].anchor;
    const { hard } = checkAnimReadiness({ grid, anatomy: mutant });
    expect(hard.some((e) => e.includes('time') && e.includes('anchor'))).toBe(true);
  });

  it('Д: мутант — anchor вне канвы (1.5 > 1) → hard', () => {
    const mutant = JSON.parse(JSON.stringify(anatomy));
    mutant.glyphs.time.parts[1].anchor = [1.5, 0.5];
    const { hard } = checkAnimReadiness({ grid, anatomy: mutant });
    expect(hard.some((e) => e.includes('time') && e.includes('anchor'))).toBe(true);
  });

  it('Д: мутант — anchor не пара ([0.5]) → hard', () => {
    const mutant = JSON.parse(JSON.stringify(anatomy));
    mutant.glyphs.time.parts[1].anchor = [0.5];
    const { hard } = checkAnimReadiness({ grid, anatomy: mutant });
    expect(hard.some((e) => e.includes('time') && e.includes('anchor'))).toBe(true);
  });

  it('Д: деталь с ≠1 суб-путём генерата → hard о раздельности (словарь инжектится)', () => {
    // circle-dot в режиме frame даёт 2 суб-пути (кольцо) — объявив его
    // «подвижным» через DI-словарь, доказываем, что счёт суб-путей кусается
    const mutant = JSON.parse(JSON.stringify(anatomy));
    mutant.glyphs.time.parts[0].anchor = [0.5, 0.5];
    const { hard } = checkAnimReadiness({
      grid,
      anatomy: mutant,
      movable: new Set(['clock-hand', 'circle-dot']),
    });
    expect(hard.some((e) => e.includes('time/outline') && e.includes('вместо 1'))).toBe(true);
  });
});

describe('CLI — RED-proof по exit-кодам (как запускает verify/CI)', () => {
  it('Д: фикстура из master → exit 1', () => {
    const r = runCli(join('test', 'fixtures', 'anim-welded-time-master.json'));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('clock-hands');
  });

  it('Б: декларация ветки → exit 0', () => {
    const r = runCli();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
  });
});
