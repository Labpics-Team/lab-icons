import { createHash } from 'node:crypto';
import { roundedDigitGeometry, calendarNumberLayout } from '../../src/core/calendar-geometry.js';
import { opticalPosition, opticalPathData, sampleOpticalPath } from '../../src/core/optical-sampling.js';
import { pathBBox } from '../../src/core/path-data.js';
import { compileOpticalGrid, opticalScalar } from './optical-grid.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

/** Ten shared stroke masters and source shell selectors; no per-day geometry copies. */
export function compileCalendarSymbol(data, declaration, profiles) {
  if (!declaration.calendar) return undefined;
  const profile = profiles[declaration.calendar.profile];
  if (!profile || profile.weightScale?.length !== 3 || profile.weightScale[1] !== 1) throw new TypeError('Calendar needs an optical weight profile');
  const { axes } = data;
  const viewport = declaration.calendar.viewport;
  const container = declaration.variants[viewport?.variant]?.anatomy.parts.find(part => part.id === viewport.partId);
  const containerPath = container && data.variants[viewport.variant].paths[container.pathIndex];
  const scale = declaration.calendar.contentScale;
  if (!containerPath || !Number.isInteger(viewport.contourIndex) || viewport.contourIndex < 0 ||
      viewport.contourIndex >= [...containerPath.commands].filter(c => c === 'M').length || !(scale > 0 && scale < 1)) {
    throw new TypeError('Calendar needs a source-bound content viewport');
  }
  const layouts = new Map();
  const masters = axes.weight.flatMap((weight, w) => axes.opsz.map(opsz => {
    const coordinates = sampleOpticalPath(containerPath, opticalPosition(axes, weight, opsz));
    const bounds = pathBBox(opticalPathData(containerPath, coordinates, [viewport.contourIndex]));
    const width = (bounds.maxX - bounds.minX) * scale, height = (bounds.maxY - bounds.minY) * scale;
    const aperture = { x: (bounds.minX + bounds.maxX - width) / 2, y: (bounds.minY + bounds.maxY - height) / 2, width, height };
    const layout = calendarNumberLayout({ opsz, aperture });
    layouts.set(`${weight}/${opsz}`, layout);
    const cell = { centerX: layout.centerX, centerY: layout.centerY, width: layout.cellWidth, height };
    return { weight, opsz, paths: Array.from({ length: 10 }, (_, digit) => {
      const glyph = roundedDigitGeometry(digit, { opsz, cell, strokeScale: profile.weightScale[w] });
      return { d: glyph.d, strokeWidth: glyph.paint.strokeWidth };
    }) };
  }));
  const digits = compileOpticalGrid({ axes, source: masters[4].paths, masters }).paths;
  const spacingAt = (w, o) => { const layout = layouts.get(`${axes.weight[w]}/${axes.opsz[o]}`); return (layout.cellWidth + layout.gap) / 2; };
  const spacing = opticalScalar(spacingAt(1, 1), spacingAt);
  const shells = Object.fromEntries(['outline', 'filled'].map(variant => {
    const paths = data.variants[variant].paths;
    const layer = hash(paths);
    const parts = declaration.variants[variant].anatomy.parts.filter(part => part.role === 'enclosure').map(part => {
      const path = paths[part.pathIndex];
      if (!path || part.contourIndices?.some(index => index < 0 || index >= [...path.commands].filter(c => c === 'M').length)) {
        throw new TypeError('Calendar shell selector no longer names its source contour');
      }
      return { id: part.id, pathIndex: part.pathIndex, ...(part.contourIndices && { contourIndices: part.contourIndices }),
        key: hash({ layer, pathIndex: part.pathIndex, contourIndices: part.contourIndices }), layer, anchor: [12, 12] };
    });
    if (!parts.length) throw new TypeError('Calendar requires an authored enclosure');
    return [variant, parts];
  }));
  return { key: hash({ digits, spacing }), digits, spacing, shells };
}
