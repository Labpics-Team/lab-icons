/**
 * test/check-topology.test.js — видящий гейт СВЯЗНОСТИ контура.
 *
 * Классы Фаулера:
 *   Д (гейт доказан нарушителем): незакрытый суб-путь со щелью ОБЯЗАН флагнуться;
 *      RED-first — до существования гейта дефект был невидим.
 *   Д (НЕ-ДУБЛИРОВАНИЕ): на ТОЙ ЖЕ битой фикстуре check-fill-rule и
 *      check-path-quality молчат (0 находок) — уникальность куса доказана кодом.
 *   А (синтетика): закрытый (Z) и самозамкнутый (gap≈0) контуры — НЕ дефект.
 *   Б (регрессия): весь корпус Outline топологически связен (0 срезов) — гейт
 *      зелёный на чистой руке, значит не зелёный-с-рождения и не ломает verify.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { unclosedGaps, topologyDefects } from '../scripts/lib/topology.js';
import { findTopologyDefects } from '../scripts/check-topology.js';
import { findBlobBugs } from '../scripts/check-fill-rule.js';
import { validatePathQuality } from '../scripts/check-path-quality.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = (inner, attrs = '') =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path ${attrs}d="${inner}"/></svg>`;

const brokenD = 'M4 4L20 4L20 20L8 20'; // без Z, конец (8,20) далеко от старта (4,4)
const closedD = 'M4 4L20 4L20 20L4 20Z'; // явный Z
const selfClosedD = 'M4 4L20 4L20 20L4 20L4 4'; // сам пришёл в старт, Z нет — легально

describe('unclosedGaps — примитив разрыва контура', () => {
  it('Д: незакрытый суб-путь с большой щелью → дефект', () => {
    const g = unclosedGaps(brokenD);
    expect(g).toHaveLength(1);
    expect(g[0].gap).toBeGreaterThan(1);
  });

  it('А: контур с Z → НЕ дефект', () => {
    expect(unclosedGaps(closedD)).toHaveLength(0);
  });

  it('А: контур сам пришёл в старт (gap≈0) без Z → НЕ дефект', () => {
    expect(unclosedGaps(selfClosedD)).toHaveLength(0);
  });

  it('А: несколько суб-путей — считается каждый независимо', () => {
    // первый закрыт (Z), второй разорван
    const d = `${closedD}M2 2L10 2L10 10`;
    const g = unclosedGaps(d);
    expect(g).toHaveLength(1);
    expect(g[0].sub).toBe(1);
  });
});

describe('findTopologyDefects — расслоение Outline(hard)/Filled(warn)', () => {
  it('Д: разрыв в Outline/ → в outlineFails (валит CI)', () => {
    const { outlineFails, filledWarns } = findTopologyDefects([
      { name: 'Outline/x.svg', content: svg(brokenD) },
    ]);
    expect(outlineFails.map((e) => e.name)).toContain('Outline/x.svg');
    expect(filledWarns).toHaveLength(0);
  });

  it('А: тот же разрыв в Filled/ → только warn (CI не валит)', () => {
    const { outlineFails, filledWarns } = findTopologyDefects([
      { name: 'Filled/x.svg', content: svg(brokenD) },
    ]);
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns.map((e) => e.name)).toContain('Filled/x.svg');
  });

  it('А: чистый закрытый контур → ноль срезов', () => {
    const { outlineFails, filledWarns } = findTopologyDefects([
      { name: 'Outline/ok.svg', content: svg(closedD) },
    ]);
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns).toHaveLength(0);
  });
});

describe('НЕ-ДУБЛИРОВАНИЕ: на битой фикстуре молчат другие гейты', () => {
  const fx = {
    name: 'Outline/topology-unclosed-gap.svg',
    content: readFileSync(join(root, 'test', 'fixtures', 'topology-unclosed-gap.svg'), 'utf8'),
  };
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));

  it('check-topology ЛОВИТ фикстуру', () => {
    expect(topologyDefects(fx.content.match(/d="([^"]+)"/)[1]).count).toBeGreaterThan(0);
    expect(findTopologyDefects([fx]).outlineFails.length).toBeGreaterThan(0);
  });

  it('check-fill-rule МОЛЧИТ на той же фикстуре (0 находок)', () => {
    const { outlineFails, filledWarns } = findBlobBugs([fx]);
    expect(outlineFails).toHaveLength(0);
    expect(filledWarns).toHaveLength(0);
  });

  it('check-path-quality МОЛЧИТ на той же фикстуре (0 находок)', () => {
    expect(validatePathQuality({ grid, files: [fx] })).toHaveLength(0);
  });
});

describe('Б-регрессия: реальный корпус топологически связен', () => {
  const outlineFiles = readdirSync(join(root, 'svg', 'Outline'))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => ({ name: `Outline/${f}`, content: readFileSync(join(root, 'svg', 'Outline', f), 'utf8') }));

  it('весь Outline-корпус без разрывов контура (ноль срезов)', () => {
    const { outlineFails } = findTopologyDefects(outlineFiles);
    expect(outlineFails, `срезы: ${outlineFails.map((e) => e.name).join(', ')}`).toHaveLength(0);
  });
});
