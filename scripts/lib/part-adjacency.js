/**
 * Граф смежности именованных частей относительно path-aware baseline.
 *
 * Старый гейт проверял только «у каждой части есть ближайший сосед». Это не
 * доказывает связность: группы A—B и C—D обе локально валидны, но между ними
 * может отсутствовать обязательный мост. Здесь закон формулируется графом:
 * части, назначенные одной компоненте чернил baseline, обязаны образовать одну
 * связную компоненту при пороге касания eps.
 */

import { samplePolylines } from './curve-sampling.js';
import {
  DEFAULT_RASTER_PHASES,
  labelMaskFeatures,
  rasterizePathEntries,
} from './ink-raster.js';

const GEOM_EPS = 1e-9;

function normalizeEntries(part) {
  const entries = Array.isArray(part.entries)
    ? part.entries
    : typeof part.d === 'string'
      ? [{ d: part.d, fillRule: part.fillRule }]
      : null;
  if (!entries || entries.length === 0) {
    throw new Error(`part-adjacency: часть ${String(part.id)} не несёт path entries`);
  }
  return entries.map((entry, index) => {
    if (!entry || typeof entry.d !== 'string' || entry.d.trim() === '') {
      throw new Error(`part-adjacency: ${String(part.id)} path ${index} не несёт d`);
    }
    return { d: entry.d, fillRule: entry.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' };
  });
}

function assertParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('part-adjacency: parts обязан быть непустым массивом');
  }
  const ids = new Set();
  return parts.map((part, index) => {
    if (!part || typeof part.id !== 'string' || part.id.trim() === '') {
      throw new Error(`part-adjacency: часть ${index} не имеет стабильного id`);
    }
    if (ids.has(part.id)) throw new Error(`part-adjacency: дублирован id ${part.id}`);
    ids.add(part.id);
    const entries = normalizeEntries(part);
    return {
      id: part.id,
      entries,
      segments: boundarySegments(entries),
    };
  });
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) <= GEOM_EPS && Math.abs(a[1] - b[1]) <= GEOM_EPS;
}

function boundarySegments(entries, stepsPerSeg = 24) {
  const segments = [];
  for (const entry of entries) {
    for (const poly of samplePolylines(entry.d, stepsPerSeg)) {
      if (poly.length < 2) continue;
      for (let index = 0; index + 1 < poly.length; index++) {
        if (!samePoint(poly[index], poly[index + 1])) {
          segments.push([poly[index], poly[index + 1]]);
        }
      }
      // SVG fill замыкает открытый суб-путь неявным ребром.
      if (!samePoint(poly[0], poly[poly.length - 1])) {
        segments.push([poly[poly.length - 1], poly[0]]);
      }
    }
  }
  if (segments.length === 0) throw new Error('part-adjacency: часть не имеет измеримой границы');
  return segments;
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return Math.abs(orient(a, b, p)) <= GEOM_EPS &&
    p[0] >= Math.min(a[0], b[0]) - GEOM_EPS &&
    p[0] <= Math.max(a[0], b[0]) + GEOM_EPS &&
    p[1] >= Math.min(a[1], b[1]) - GEOM_EPS &&
    p[1] <= Math.max(a[1], b[1]) + GEOM_EPS;
}

function segmentsIntersect(a, b, c, d) {
  const abC = orient(a, b, c);
  const abD = orient(a, b, d);
  const cdA = orient(c, d, a);
  const cdB = orient(c, d, b);
  if (((abC > GEOM_EPS && abD < -GEOM_EPS) || (abC < -GEOM_EPS && abD > GEOM_EPS)) &&
      ((cdA > GEOM_EPS && cdB < -GEOM_EPS) || (cdA < -GEOM_EPS && cdB > GEOM_EPS))) {
    return true;
  }
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (length2 <= GEOM_EPS) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2));
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t));
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function masksOverlap(a, b) {
  if (a.mask.length !== b.mask.length || a.cols !== b.cols || a.rows !== b.rows) {
    throw new Error('part-adjacency: raster parts имеют разные размеры');
  }
  for (let index = 0; index < a.mask.length; index++) {
    if (a.mask[index] && b.mask[index]) return true;
  }
  return false;
}

/** Минимальный геометрический зазор двух частей; overlap/touch = 0. */
export function partGap(partA, partB, rasterA = null, rasterB = null) {
  if (rasterA && rasterB && masksOverlap(rasterA, rasterB)) return 0;
  let best = Infinity;
  for (const [a, b] of partA.segments) {
    for (const [c, d] of partB.segments) {
      const distance = segmentDistance(a, b, c, d);
      if (distance < best) best = distance;
      if (best <= GEOM_EPS) return 0;
    }
  }
  return best;
}

function occupiedCells(mask) {
  const cells = [];
  for (let index = 0; index < mask.length; index++) if (mask[index]) cells.push(index);
  return cells;
}

function componentCountsNear(partRaster, baselineLabels, radiusCells) {
  const counts = new Map();
  const { cols, rows } = partRaster;
  for (const index of occupiedCells(partRaster.mask)) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const labelsForCell = new Set();
    for (let dr = -radiusCells; dr <= radiusCells; dr++) {
      for (let dc = -radiusCells; dc <= radiusCells; dc++) {
        if (dr * dr + dc * dc > radiusCells * radiusCells) continue;
        const rr = row + dr;
        const cc = col + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
        const label = baselineLabels[rr * cols + cc];
        if (label >= 0) labelsForCell.add(label);
      }
    }
    for (const label of labelsForCell) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([component, count]) => ({ component, count }))
    .sort((a, b) => b.count - a.count || a.component - b.component);
}

function assignParts(parts, partRasters, baselineLabels, assignmentRadius, step) {
  const assignments = [];
  const errors = [];
  const radiusCells = Math.max(0, Math.ceil(assignmentRadius / step));

  for (let index = 0; index < parts.length; index++) {
    const candidates = componentCountsNear(partRasters[index], baselineLabels, radiusCells);
    if (candidates.length === 0) {
      errors.push(`${parts[index].id}: не примыкает ни к одной компоненте baseline`);
      assignments.push({ id: parts[index].id, component: null, candidates });
      continue;
    }
    if (candidates.length > 1 && candidates[0].count === candidates[1].count) {
      errors.push(
        `${parts[index].id}: неоднозначное назначение baseline ` +
          `(${candidates[0].component}=${candidates[0].count}, ${candidates[1].component}=${candidates[1].count})`,
      );
      assignments.push({ id: parts[index].id, component: null, candidates });
      continue;
    }
    assignments.push({ id: parts[index].id, component: candidates[0].component, candidates });
  }
  return { assignments, errors };
}

function graphComponents(ids, pairGaps, eps) {
  const remaining = new Set(ids);
  const groups = [];
  while (remaining.size > 0) {
    const seed = [...remaining].sort()[0];
    remaining.delete(seed);
    const group = [];
    const stack = [seed];
    while (stack.length > 0) {
      const current = stack.pop();
      group.push(current);
      for (const candidate of [...remaining]) {
        const key = [current, candidate].sort().join('~');
        if ((pairGaps.get(key) ?? Infinity) <= eps) {
          remaining.delete(candidate);
          stack.push(candidate);
        }
      }
    }
    groups.push(group.sort());
  }
  return groups.sort((a, b) => a.join(',').localeCompare(b.join(',')));
}

function minimumBridge(groups, pairGaps) {
  let best = null;
  for (let left = 0; left < groups.length; left++) {
    for (let right = left + 1; right < groups.length; right++) {
      for (const a of groups[left]) {
        for (const b of groups[right]) {
          const gap = pairGaps.get([a, b].sort().join('~')) ?? Infinity;
          if (!best || gap < best.gap) best = { a, b, gap };
        }
      }
    }
  }
  return best;
}

function partitionSignature(assignments) {
  const groups = new Map();
  for (const assignment of assignments) {
    if (assignment.component == null) continue;
    if (!groups.has(assignment.component)) groups.set(assignment.component, []);
    groups.get(assignment.component).push(assignment.id);
  }
  return [...groups.values()]
    .map((ids) => ids.sort().join(','))
    .sort()
    .join('|');
}

/** Один phase-sample adjacency закона. */
export function analyzePartAdjacency({
  baselineEntries,
  parts: rawParts,
  width = 24,
  height = width,
  step = 0.12,
  phaseX = 0.5,
  phaseY = 0.5,
  eps = 0.15,
  assignmentRadius = 0.9,
  stepsPerSeg = 24,
}) {
  if (!Array.isArray(baselineEntries) || baselineEntries.length === 0) {
    throw new Error('part-adjacency: baselineEntries обязан быть непустым массивом');
  }
  if (!(Number.isFinite(eps) && eps >= 0)) throw new Error(`part-adjacency: eps обязан быть >= 0; найдено ${eps}`);
  if (!(Number.isFinite(assignmentRadius) && assignmentRadius >= 0)) {
    throw new Error(`part-adjacency: assignmentRadius обязан быть >= 0; найдено ${assignmentRadius}`);
  }

  const parts = assertParts(rawParts);
  const rasterOptions = { width, height, step, phaseX, phaseY, stepsPerSeg };
  const baselineRaster = rasterizePathEntries(baselineEntries, rasterOptions);
  const labeled = labelMaskFeatures(
    baselineRaster.mask,
    baselineRaster.cols,
    baselineRaster.rows,
    { eightConnected: true },
  );
  if (labeled.features.length === 0) {
    throw new Error('part-adjacency: baseline не содержит чернил');
  }

  const partRasters = parts.map((part) => rasterizePathEntries(part.entries, rasterOptions));
  const { assignments, errors } = assignParts(
    parts,
    partRasters,
    labeled.labels,
    assignmentRadius,
    step,
  );

  const pairGaps = new Map();
  for (let left = 0; left < parts.length; left++) {
    for (let right = left + 1; right < parts.length; right++) {
      const key = [parts[left].id, parts[right].id].sort().join('~');
      pairGaps.set(key, partGap(parts[left], parts[right], partRasters[left], partRasters[right]));
    }
  }

  const byComponent = new Map();
  for (const assignment of assignments) {
    if (assignment.component == null) continue;
    if (!byComponent.has(assignment.component)) byComponent.set(assignment.component, []);
    byComponent.get(assignment.component).push(assignment.id);
  }

  const defects = [];
  for (const [component, ids] of byComponent) {
    const groups = graphComponents(ids, pairGaps, eps);
    if (groups.length > 1) {
      defects.push({
        component,
        groups,
        bridge: minimumBridge(groups, pairGaps),
      });
    }
  }

  return {
    phase: [phaseX, phaseY],
    baselineComponents: labeled.features,
    assignments,
    partitionSignature: partitionSignature(assignments),
    pairGaps,
    defects,
    errors,
  };
}

/**
 * Четыре фиксированные raster-фазы: если принадлежность части baseline-компоненте
 * меняется от квантования, это отдельный HARD-кандидат, а не случайный verdict.
 */
export function analyzePartAdjacencyAcrossPhases({
  phases = DEFAULT_RASTER_PHASES,
  ...options
}) {
  const samples = phases.map(([phaseX, phaseY]) =>
    analyzePartAdjacency({ ...options, phaseX, phaseY }),
  );
  const partitionSignatures = samples.map((sample) => sample.partitionSignature);
  const stableAssignments = partitionSignatures.every(
    (signature) => signature === partitionSignatures[0],
  );
  const errors = [...new Set(samples.flatMap((sample) => sample.errors))];
  if (!stableAssignments) {
    errors.push(`назначение частей зависит от raster phase: ${partitionSignatures.join(' ; ')}`);
  }
  const defects = [];
  const seen = new Set();
  for (const sample of samples) {
    for (const defect of sample.defects) {
      const key = defect.groups.map((group) => group.join(',')).sort().join('|');
      if (!seen.has(key)) {
        seen.add(key);
        defects.push(defect);
      }
    }
  }
  return {
    stableAssignments,
    partitionSignatures,
    samples,
    defects,
    errors,
  };
}
