import { parsePathData } from '../../src/core/path-data.js';

export class LottieGeometryError extends Error {
  constructor(code, message) { super(message); this.name = 'LottieGeometryError'; this.code = code; }
}

const fail = (code, message) => { throw new LottieGeometryError(code, message); };
const point = (x, y) => [x, y];
const sub = (a, b) => point(a[0] - b[0], a[1] - b[1]);

/** Только build-time lowering: сохраняет контуры и направление без аппроксимации дуг. */
export function lottieContours(d) {
  let segments;
  try { segments = parsePathData(d); } catch (cause) { fail('PATH_INVALID', cause.message); }
  if (segments[0]?.cmd !== 'M') fail('PATH_INVALID', 'Контур обязан начинаться с M.');
  const contours = [];
  let path;
  let cursor;
  function finish() {
    if (!path) return;
    if (!path.c) fail('OPEN_CONTOUR_UNSUPPORTED', 'Target требует явно замкнутые fill-контуры.');
    contours.push(path);
    path = undefined;
  }
  function edge(end, control1 = cursor, control2 = end) {
    if (!path || path.c) fail('PATH_INVALID', 'Сегмент вне открытого subpath.');
    path.o[path.v.length - 1] = sub(control1, cursor);
    path.v.push(end); path.i.push(sub(control2, end)); path.o.push([0, 0]);
    cursor = end;
  }
  for (const segment of segments) {
    if (segment.cmd === 'M') {
      finish();
      cursor = point(segment.x, segment.y);
      path = { v: [cursor], i: [[0, 0]], o: [[0, 0]], c: false };
    } else if (segment.cmd === 'Z') {
      if (!path || path.c) fail('PATH_INVALID', 'Повторное закрытие или Z без M.');
      // Совпавший endpoint переносит incoming tangent в первую вершину;
      // иначе Lottie закрывает последний линейный сегмент самостоятельно.
      if (path.v.length > 1 && cursor[0] === path.v[0][0] && cursor[1] === path.v[0][1]) {
        path.i[0] = path.i.pop(); path.v.pop(); path.o.pop();
      }
      path.c = true;
      cursor = path.v[0];
    } else if (segment.cmd === 'L') edge(point(segment.x, segment.y));
    else if (segment.cmd === 'C') edge(point(segment.x, segment.y), point(segment.x1, segment.y1), point(segment.x2, segment.y2));
    else if (segment.cmd === 'Q') {
      const end = point(segment.x, segment.y), control = point(segment.x1, segment.y1);
      edge(end,
        point(cursor[0] + (control[0] - cursor[0]) * 2 / 3, cursor[1] + (control[1] - cursor[1]) * 2 / 3),
        point(end[0] + (control[0] - end[0]) * 2 / 3, end[1] + (control[1] - end[1]) * 2 / 3));
    } else if (segment.cmd === 'A') {
      if (segment.rx === 0 || segment.ry === 0) edge(point(segment.x, segment.y));
      else if (cursor && cursor[0] === segment.x && cursor[1] === segment.y) continue;
      else fail('ARC_UNSUPPORTED', 'Невырожденная SVG-дуга не имеет точного cubic-представления этого target.');
    } else fail('PATH_INVALID', `Команда ${segment.cmd} не поддержана.`);
  }
  finish();
  if (!contours.length || contours.some(contour => [contour.v, contour.i, contour.o].some(points => points.some(p => p.some(value => !Number.isFinite(value)))))) {
    fail('PATH_INVALID', 'Нужны конечные замкнутые контуры.');
  }
  return contours;
}

/** При отказе сохраняется причина; корпус не получает ложного target admission. */
export function compileLottieGeometry(glyph) {
  try {
    if (glyph.provenance.kind !== 'source' || !glyph.provenance.author) fail('AUTHOR_SOURCE_REQUIRED', 'Нужен текущий авторский источник.');
    if (glyph.composition.kind !== 'layers') fail('COMPOSITION_UNSUPPORTED', 'Target сохраняет независимые авторские fill layers.');
    if (!Array.isArray(glyph.viewBox) || glyph.viewBox.length !== 4 || glyph.viewBox.some(value => !Number.isFinite(value)) || glyph.viewBox[2] <= 0 || glyph.viewBox[3] <= 0) {
      fail('PATH_INVALID', 'Нужен конечный положительный viewBox.');
    }
    const parts = glyph.parts.map(part => {
      if (part.paint?.kind !== 'fill' || part.paint.fill !== 'currentColor' || !['nonzero', 'evenodd'].includes(part.fillRule)) {
        fail('PAINT_UNSUPPORTED', 'Stroke, маски и неопределённый fill-rule требуют отдельного target.');
      }
      return { id: part.id, anchor: [...part.anchor], fillRule: part.fillRule, contours: lottieContours(part.d) };
    });
    if (!parts.length || new Set(parts.map(part => part.id)).size !== parts.length) fail('PATH_INVALID', 'Части обязаны иметь уникальные ID.');
    return { ok: true, geometry: { version: 1, icon: glyph.icon, variant: glyph.variant,
      viewBox: [...glyph.viewBox], author: { ...glyph.provenance.author }, parts } };
  } catch (error) {
    if (!(error instanceof LottieGeometryError)) throw error;
    return { ok: false, reason: { code: error.code, message: error.message } };
  }
}

export function renderLottieSymbolModule(icon, variants) {
  if (!/^[a-z][a-z0-9-]*$/.test(icon)) throw new TypeError('lottie module: невалидное имя');
  return [
    '/** GENERATED: target-contours одного авторского символа; path parser остаётся в сборке. */',
    `import { glyph, glyphCapabilities } from '../symbols/${icon}.js';`,
    "import { createLottieSymbol } from '../ir/lottie-runtime.js';",
    `const symbol = /* @__PURE__ */ createLottieSymbol({ glyph, glyphCapabilities }, ${JSON.stringify(variants)});`,
    'export function exportLottie(request) { return symbol.exportLottie(request); }',
    'export function lottieCapabilities(variant) { return symbol.lottieCapabilities(variant); }', '',
  ].join('\n');
}

export function lottieSymbolDeclaration() {
  return [
    "import type { LottieExportRequest, LottieExportResult, LottieCapabilities } from './types.js';",
    "import type { IconVariant } from '../ir/compiler.js';",
    'export declare function exportLottie(request?: LottieExportRequest): LottieExportResult;',
    'export declare function lottieCapabilities(variant?: IconVariant): LottieCapabilities;', '',
  ].join('\n');
}
