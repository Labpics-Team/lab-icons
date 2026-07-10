/**
 * check-adjacency.js — видящий гейт смыкания именованных частей генерата.
 *
 * Закон «эти части должны смыкаться» выводится из неизменяемой ручной версии:
 * части, принадлежащие одной связной компоненте руки, обязаны оставаться
 * смежными в генерате. Текущий SVG generated-варианта baseline быть не может —
 * он уже перезаписан генератором и создавал циклическую самопроверку.
 *
 * Проверяются Outline и Filled. Полная геометрия руки складывается из ВСЕХ
 * `<path>`, а не только первого: потеря второго path скрывала разрывы именно в
 * многослойных иконках.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { createHandHistory } from './lib/hand-history.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePath } from './lib/path-data.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRID = JSON.parse(readFileSync(join(repoRoot, 'semantics', 'grid.json'), 'utf8'));
const CANVAS = GRID.canvas.width;
const EPS = GRID.ratios.strokeWidth.tolerance * CANVAS;
const TOUCH = (GRID.ratios.strokeWidth.base / 2) * CANVAS;
const SAMPLE_STEPS = 24;
const VARIANTS = ['outline', 'filled'];

if (!(EPS < GRID.ratios.clearanceMin * CANVAS)) {
  throw new Error(
    'check-adjacency: grid.json противоречив — strokeWidth.tolerance ≥ clearanceMin: ' +
      'разрыв стыка неотделим от легального охранного зазора',
  );
}

/** Разбить path-data на суб-пути (каждый начинается с M/m). */
export function splitSubpaths(d) {
  const out = [];
  const re = /[Mm][^Mm]*/g;
  let match;
  while ((match = re.exec(d)) !== null) out.push(match[0].trim());
  return out;
}

function polyOf(d) {
  return samplePath(d, SAMPLE_STEPS);
}

function pointInPoly(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Зазор между двумя залитыми частями; 0 при перекрытии областей. */
export function gapBetween(a, b) {
  for (const point of a.pts) {
    for (const poly of b.subPolys) if (pointInPoly(point, poly)) return 0;
  }
  for (const point of b.pts) {
    for (const poly of a.subPolys) if (pointInPoly(point, poly)) return 0;
  }

  let best = Infinity;
  for (const pa of a.pts) {
    for (const pb of b.pts) {
      const dx = pa[0] - pb[0];
      const dy = pa[1] - pb[1];
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < best) best = distanceSquared;
    }
  }
  return Math.sqrt(best);
}

function partFromPathData(name, d) {
  const subPolys = splitSubpaths(d)
    .map(polyOf)
    .filter((poly) => poly.length >= 2);
  return { name, subPolys, pts: subPolys.flat() };
}

function handComponents(handD) {
  return splitSubpaths(handD)
    .map(polyOf)
    .filter((poly) => poly.length >= 3);
}

function coverageWithin(part, component) {
  let covered = 0;
  const touchSquared = TOUCH * TOUCH;
  for (const point of part.pts) {
    if (pointInPoly(point, component)) {
      covered++;
      continue;
    }
    let near = false;
    for (const candidate of component) {
      const dx = point[0] - candidate[0];
      const dy = point[1] - candidate[1];
      if (dx * dx + dy * dy <= touchSquared) {
        near = true;
        break;
      }
    }
    if (near) covered++;
  }
  return covered;
}

function assignComponents(parts, handComps) {
  for (const part of parts) {
    let bestIndex = -1;
    let bestCoverage = 0;
    for (let index = 0; index < handComps.length; index++) {
      const coverage = coverageWithin(part, handComps[index]);
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestIndex = index;
      }
    }
    part.comp = bestIndex;
  }
}

/** Части одной компоненты руки, разорванные в генерате дальше ε. */
export function findAdjacencyDefects(parts, eps = EPS) {
  const byComponent = new Map();
  for (const part of parts) {
    if (part.comp < 0) continue;
    if (!byComponent.has(part.comp)) byComponent.set(part.comp, []);
    byComponent.get(part.comp).push(part);
  }

  const defects = [];
  for (const [component, cluster] of byComponent) {
    if (cluster.length < 2) continue;
    for (const part of cluster) {
      let nearestGap = Infinity;
      let nearestName = null;
      for (const sibling of cluster) {
        if (sibling === part) continue;
        const gap = gapBetween(part, sibling);
        if (gap < nearestGap) {
          nearestGap = gap;
          nearestName = sibling.name;
        }
      }
      if (nearestName !== null && nearestGap > eps) {
        const key = [part.name, nearestName].sort().join('~');
        if (!defects.some((defect) => [defect.a, defect.b].sort().join('~') === key)) {
          defects.push({ a: part.name, b: nearestName, gap: nearestGap, comp: component });
        }
      }
    }
  }
  return defects;
}

export function adjacencyDefectsBetween(handD, generatedParts, eps = EPS) {
  const parts = generatedParts.map((part) => partFromPathData(part.name, part.d));
  assignComponents(parts, handComponents(handD));
  return findAdjacencyDefects(parts, eps);
}

/** Все path-элементы SVG образуют один baseline path-data. */
export function handPathData(svg) {
  return renderedPathData(svg).join('');
}

/**
 * Изолированная материализация каждой именованной части для конкретного
 * варианта. partsScope сохраняет sibling-зависимые конструкции вроде socket.
 */
export function materializeParts(entry, grid, allGlyphs, variant) {
  const out = [];
  for (const part of entry.parts ?? []) {
    let built;
    try {
      built = buildGlyph(
        { ...entry, parts: [part], partsScope: entry.parts },
        grid,
        {},
        allGlyphs,
      );
    } catch {
      continue;
    }
    const d = built[variant];
    if (d) out.push({ name: part.name || `part${out.length}`, d });
  }
  return out;
}

function shippedRelativePath(name, variant) {
  return variant === 'outline'
    ? `svg/Outline/${name}.svg`
    : `svg/Filled/${name}_filled.svg`;
}

/**
 * Baseline варианта: текущая отгрузка только для status:hand; для generated —
 * последний доказанный hand blob из истории.
 */
export function resolveHandBaseline({ repo, history, name, variant, status }) {
  const relativePath = shippedRelativePath(name, variant);
  if (status === 'hand') {
    const absolutePath = join(repo, relativePath);
    if (!existsSync(absolutePath)) {
      return { error: `${relativePath}: status:hand, но файл отсутствует` };
    }
    const d = handPathData(readFileSync(absolutePath, 'utf8'));
    return d
      ? { d, source: 'current-hand', relativePath }
      : { error: `${relativePath}: ручной SVG не содержит path-геометрии` };
  }

  if (status === 'generated') {
    const baseline = history.handFromHistory(relativePath, name, variant);
    if (!baseline) {
      return {
        error:
          `${name}/${variant}: historical hand baseline не найден; ` +
          'нельзя выводить закон смежности из текущего генерата',
      };
    }
    const d = handPathData(baseline.svg);
    return d
      ? {
          d,
          source: `git:${baseline.shortSha}`,
          relativePath: baseline.path,
          sha: baseline.sha,
        }
      : { error: `${name}/${variant}: historical hand blob не содержит path-геометрии` };
  }

  return { error: `${name}/${variant}: неизвестный status ${String(status)}` };
}

/** Проверить один variant глифа. */
export function checkGlyphVariant({
  name,
  entry,
  variant,
  grid,
  allGlyphs,
  repo,
  history,
  eps = EPS,
}) {
  const status = entry.status?.[variant];
  if (!status || !Array.isArray(entry.parts) || entry.parts.length < 2) {
    return { checked: false, defects: [], errors: [] };
  }

  const generatedParts = materializeParts(entry, grid, allGlyphs, variant);
  if (generatedParts.length < 2) {
    return { checked: false, defects: [], errors: [] };
  }

  const baseline = resolveHandBaseline({ repo, history, name, variant, status });
  if (baseline.error) {
    return { checked: false, defects: [], errors: [baseline.error] };
  }

  return {
    checked: true,
    defects: adjacencyDefectsBetween(baseline.d, generatedParts, eps),
    errors: [],
    baselineSource: baseline.source,
  };
}

function targetsForArg(arg, anatomy) {
  const [name, requestedVariant] = arg.split('/');
  const entry = anatomy.glyphs[name];
  if (!entry) return null;
  if (requestedVariant && !VARIANTS.includes(requestedVariant)) return null;
  const variants = requestedVariant
    ? [requestedVariant]
    : VARIANTS.filter((variant) => entry.status?.[variant]);
  return variants.map((variant) => ({ name, variant, entry }));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(repo, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(repo, 'semantics', 'anatomy.json'), 'utf8'));
  const history = createHandHistory(repo);
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));

  const onlyFixtures = args.length > 0 && args.every((arg) => arg.endsWith('.json'));
  if (!onlyFixtures && history.isShallow()) {
    console.error(
      'check-adjacency: HARD — git checkout shallow; historical hand baseline недоступен. ' +
        'CI/release обязаны checkout с fetch-depth: 0.',
    );
    process.exit(2);
  }

  if (args.length > 0) {
    const failures = [];
    let checked = 0;

    for (const arg of args) {
      if (arg.endsWith('.json')) {
        const fixture = JSON.parse(readFileSync(arg, 'utf8'));
        const defects = adjacencyDefectsBetween(fixture.hand, fixture.parts, EPS);
        checked++;
        for (const defect of defects) {
          failures.push(
            `${basename(arg)}: «${defect.a}»↔«${defect.b}» ` +
              `зазор ${defect.gap.toFixed(3)} > ε ${EPS}`,
          );
        }
        continue;
      }

      const targets = targetsForArg(arg, anatomy);
      if (!targets || targets.length === 0) {
        console.error(`check-adjacency: нет цели «${arg}» в anatomy`);
        process.exit(2);
      }

      for (const target of targets) {
        const result = checkGlyphVariant({
          ...target,
          grid,
          allGlyphs: anatomy.glyphs,
          repo,
          history,
        });
        if (result.errors.length > 0) {
          for (const error of result.errors) failures.push(error);
          continue;
        }
        if (!result.checked) continue;
        checked++;
        for (const defect of result.defects) {
          failures.push(
            `${target.name}/${target.variant}: «${defect.a}»↔«${defect.b}» ` +
              `зазор ${defect.gap.toFixed(3)} > ε ${EPS}; baseline ${result.baselineSource}`,
          );
        }
      }
    }

    if (failures.length > 0) {
      console.error(`check-adjacency: FAIL — ${failures.length} нарушений:`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exit(1);
    }
    console.log(`check-adjacency: OK — ${checked} variant-целей без разрывов (ε=${EPS})`);
    process.exit(0);
  }

  const offenders = [];
  const baselineErrors = [];
  let checked = 0;
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    for (const variant of VARIANTS) {
      const result = checkGlyphVariant({
        name,
        entry,
        variant,
        grid,
        allGlyphs: anatomy.glyphs,
        repo,
        history,
      });
      const key = `${name}/${variant}`;
      for (const error of result.errors) baselineErrors.push({ name, variant, key, error });
      if (!result.checked) continue;
      checked++;
      for (const defect of result.defects) {
        offenders.push({ name, variant, key, baselineSource: result.baselineSource, ...defect });
      }
    }
  }

  offenders.sort((left, right) => right.gap - left.gap);
  console.log('check-adjacency: REPORT-каталог обоих вариантов:');
  for (const error of baselineErrors) console.log(`  - [NO BASELINE] ${error.error}`);
  for (const offender of offenders) {
    console.log(
      `  - ${offender.key}: «${offender.a}»↔«${offender.b}» ` +
        `зазор ${offender.gap.toFixed(3)} (ε ${EPS}, baseline ${offender.baselineSource})`,
    );
  }
  if (baselineErrors.length === 0 && offenders.length === 0) {
    console.log(`  дефектов нет; проверено ${checked} variant-целей.`);
  }

  const promotedFile = join(repo, 'semantics', 'adjacency-promoted.json');
  const promoted = existsSync(promotedFile)
    ? JSON.parse(readFileSync(promotedFile, 'utf8')).promoted || []
    : [];
  const isPromoted = ({ name, key }) => promoted.includes(name) || promoted.includes(key);
  const hardOffenders = offenders.filter(isPromoted);
  const hardBaselineErrors = baselineErrors.filter(isPromoted);

  if (hardOffenders.length > 0 || hardBaselineErrors.length > 0) {
    console.error(
      `check-adjacency: FAIL — ${hardOffenders.length} разрывов и ` +
        `${hardBaselineErrors.length} недоказанных baseline у защищённых вариантов:`,
    );
    for (const error of hardBaselineErrors) console.error(`  - ${error.key}: ${error.error}`);
    for (const offender of hardOffenders) {
      console.error(
        `  - ${offender.key}: «${offender.a}»↔«${offender.b}» ` +
          `зазор ${offender.gap.toFixed(3)} > ε ${EPS}`,
      );
    }
    process.exit(1);
  }

  console.log(
    `check-adjacency: OK — ${checked} variant-целей проверены; ` +
      `${promoted.length} promoted-записей HARD-чисты`,
  );
}
