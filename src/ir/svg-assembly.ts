import type { GlyphPart, GlyphComposition } from './glyph-types.js';
import { sha256Hex } from './sha256.js';

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function stableSvgId(value: string): string {
  // DOM id участвует в реальной render-семантике: два разных mask с одним id
  // в общем документе могут разрешить url(#id) к чужой геометрии. 32-bit FNV
  // действительно столкнулся на двух допустимых calendar opsz; используем уже
  // проверенный синхронный SHA-256 целиком, а не вероятностный короткий hash.
  return `lab-icons-mask-${sha256Hex(value)}`;
}

function pathForPart(part: GlyphPart, color = 'currentColor'): string {
  const paint = part.paint.kind === 'fill'
    ? `fill="${color}"`
    : `fill="none" stroke="${color}" stroke-width="${part.paint.strokeWidth}" ` +
      `stroke-linecap="${part.paint.linecap}" stroke-linejoin="${part.paint.linejoin}"`;
  const fillRule = part.fillRule == null ? '' : ` fill-rule="${part.fillRule}"`;
  return `<path data-part="${escapeAttribute(part.id)}" ` +
    `data-role="${escapeAttribute(part.role)}" ${paint} ` +
    `${fillRule} d="${escapeAttribute(part.d)}"/>`;
}

/** Общая сериализация самостоятельных слоёв для glyph и build-time state groups. */
export function assembleGlyphLayers(parts: readonly GlyphPart[]): string {
  if (parts.some(part => part.fillRule == null)) {
    throw new Error('@labpics/icons/ir: layer обязан иметь самостоятельный fillRule');
  }
  return parts.map(part => pathForPart(part)).join('');
}

/** Рамка готовится при сборке; state runtime получает только строки. */
export function assembleGlyphFrame(
  viewBox: readonly [number, number, number, number],
  dimensions: readonly [number, number] = [viewBox[2], viewBox[3]],
): readonly [string, string] {
  return [
    `<svg viewBox="${viewBox.join(' ')}" xmlns="http://www.w3.org/2000/svg" ` +
      `width="${dimensions[0]}" height="${dimensions[1]}" fill="currentColor">`,
    '</svg>',
  ];
}

export function assembleGlyphSvg(
  viewBox: readonly [number, number, number, number],
  parts: readonly GlyphPart[],
  composition: GlyphComposition,
  dimensions: readonly [number, number] = [viewBox[2], viewBox[3]],
): string {
  let paths: string;
  if (composition.kind === 'layers') {
    paths = assembleGlyphLayers(parts);
  } else if (composition.kind === 'compound') {
    paths = (() => {
        if (parts.some((part) => part.paint.kind !== 'fill')) {
          throw new Error('@labpics/icons/ir: compound composition пока допускает только fill outlines');
        }
        const ids = parts.map((part) => part.id).join(' ');
        const roles = parts.map((part) => part.role).join(' ');
        return `<path data-parts="${escapeAttribute(ids)}" ` +
          `data-roles="${escapeAttribute(roles)}" fill="currentColor" ` +
          `fill-rule="${composition.fillRule}" d="${escapeAttribute(parts.map((part) => part.d).join(''))}"/>`;
      })();
  } else {
    const byId = new Map(parts.map((part) => [part.id, part]));
    const ids = [...composition.basePartIds, ...composition.subtractPartIds];
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== parts.length ||
      ids.some((id) => !byId.has(id))
    ) {
      throw new Error('@labpics/icons/ir: mask-subtract обязан классифицировать каждую часть ровно один раз');
    }
    const base = composition.basePartIds.map((id) => byId.get(id)!);
    const subtract = composition.subtractPartIds.map((id) => byId.get(id)!);
    const [x, y, width, height] = viewBox;
    const maskBody =
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#000"/>` +
      base.map((part) => pathForPart(part, '#fff')).join('') +
      subtract.map((part) => pathForPart(part, '#000')).join('');
    const visibleBody = base.map((part) => pathForPart(part)).join('');
    // Hash exactly the render-relevant mask payload, including viewport and
    // base/subtract classification. Hashing only d/strokeWidth would let a
    // future composition change reuse an id for different DOM semantics.
    const maskId = stableSvgId(`${viewBox.join(' ')}\0${maskBody}\0${visibleBody}`);
    paths = `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" ` +
      `x="${x}" y="${y}" width="${width}" height="${height}" mask-type="luminance">` +
      `${maskBody}</mask></defs><g mask="url(#${maskId})">${visibleBody}</g>`;
  }
  const [start, end] = assembleGlyphFrame(viewBox, dimensions);
  return `${start}${paths}${end}`;
}

