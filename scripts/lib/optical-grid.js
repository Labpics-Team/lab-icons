import { parsePathData } from '../../src/core/path-data.js';
import { projectedContourAreas } from '../../src/core/annulus-content-geometry.js';

const fields = { M: ['x', 'y'], L: ['x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] };
const sparse = values => values.flatMap((value, index) => value === 0 ? [] : [index, value]);
const winding = path => {
  const points = [];
  for (let i = 0; i < path.coordinates.length; i += 2) points.push(path.coordinates.slice(i, i + 2));
  return projectedContourAreas(path.commands, points, points[0]).map(area => {
    if (!Number.isFinite(area) || area === 0) throw new TypeError('optical contour has no finite nonzero signed area');
    return Math.sign(area);
  });
};

/** Offline normalization keeps source curve correspondence; no point fitting. */
export function opticalPathSource({ d, fillRule = 'nonzero' }) {
  if (!['nonzero', 'evenodd'].includes(fillRule)) throw new TypeError('optical path has an unsupported fill rule');
  const segments = parsePathData(d), coordinates = [];
  let commands = '';
  for (const segment of segments) {
    if (!fields[segment.cmd]) throw new TypeError(`optical path requires compatible M/L/C/Z: ${segment.cmd}`);
    commands += segment.cmd;
    for (const name of fields[segment.cmd]) {
      if (!Number.isFinite(segment[name])) throw new TypeError('optical path has a nonfinite coordinate');
      coordinates.push(segment[name]);
    }
  }
  if (!commands.startsWith('M') || !commands.endsWith('Z') || /Z[^M]/.test(commands) ||
      (commands.match(/M/g)?.length ?? 0) !== (commands.match(/Z/g)?.length ?? 0)) {
    throw new TypeError('optical path requires closed corresponding contours');
  }
  return { commands, coordinates, fillRule };
}

function validateAxis(axis, name) {
  if (!Array.isArray(axis) || axis.length !== 3 || axis.some(value => !Number.isFinite(value)) ||
      !(axis[0] < axis[1] && axis[1] < axis[2])) throw new TypeError(`${name} requires three ordered finite supports`);
}

/**
 * Masters arrive as complete paths; only nonzero coefficient terms are shipped.
 * The four mixed terms are the residual after removing the two axis deltas.
 * Therefore each cell is exactly the bilinear interpolant of its four masters,
 * before ordinary binary64 rounding. No epsilon discards authored corrections.
 */
export function compileOpticalGrid({ axes, source, masters }) {
  validateAxis(axes?.weight, 'weight'); validateAxis(axes?.opsz, 'opsz');
  if (!Array.isArray(source) || !source.length || !Array.isArray(masters) || masters.length !== 9) {
    throw new TypeError('optical grid requires source paths and all nine masters');
  }
  const base = source.map(opticalPathSource), windings = base.map(winding), grid = new Map();
  for (const master of masters) {
    const w = axes.weight.indexOf(master.weight), o = axes.opsz.indexOf(master.opsz);
    const key = `${w}/${o}`;
    if (w < 0 || o < 0 || grid.has(key) || !Array.isArray(master.paths) || master.paths.length !== base.length) {
      throw new TypeError('optical grid has missing, duplicate or foreign supports/paths');
    }
    const paths = master.paths.map(opticalPathSource);
    for (let index = 0; index < base.length; index++) {
      if (paths[index].commands !== base[index].commands || paths[index].fillRule !== base[index].fillRule) {
        throw new TypeError(`optical grid changed path correspondence or paint at ${key}/${index}`);
      }
      if (winding(paths[index]).some((sign, contour) => sign !== windings[index][contour])) {
        throw new TypeError(`optical grid changed contour winding at ${key}/${index}`);
      }
    }
    grid.set(key, paths);
  }
  const center = grid.get('1/1');
  if (base.some((path, index) => path.coordinates.some((value, coordinate) => value !== center[index].coordinates[coordinate]))) {
    throw new TypeError('optical center must preserve the source master exactly');
  }
  const paths = base.map((path, pathIndex) => {
    const at = (w, o) => grid.get(`${w}/${o}`)[pathIndex].coordinates;
    const terms = [at(0, 1), at(2, 1), at(1, 0), at(1, 2)]
      .map(master => master.map((value, index) => value - path.coordinates[index]));
    for (const w of [0, 2]) for (const o of [0, 2]) {
      terms.push(at(w, o).map((value, index) => value - path.coordinates[index]
        - terms[w === 0 ? 0 : 1][index] - terms[o === 0 ? 2 : 3][index]));
    }
    // Every factor is in [0,1]. This conservative envelope also prevents an
    // overflowing intermediate sum even when the final mathematical value fits.
    if (path.coordinates.some((value, index) => !Number.isFinite(
      terms.reduce((bound, term) => bound + Math.abs(term[index]), Math.abs(value))))) {
      throw new RangeError('optical coefficients exceed the finite coordinate envelope');
    }
    return { ...path, terms: terms.flatMap((term, index) => {
      const delta = sparse(term);
      return delta.length ? [[index, delta]] : [];
    }) };
  });
  return { axes: { weight: [...axes.weight], opsz: [...axes.opsz] }, paths };
}
