/**
 * Fail-closed intake Figma SVG в канонический source-язык библиотеки.
 * Функция меняет только доказанно нейтральную экспортную обвязку: paint
 * монохромного мастера и viewport-identity clip. Геометрия path не округляется.
 */

import {
  authorPathEntries,
  lowerViewportIdentityClip,
} from './icon-geometry.js';

const ICON_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONOCHROME_PAINT = new Set(['none', 'currentcolor', '#101012']);
const PATH_PAINT = new Set(['currentcolor', '#101012']);

export function canonicalIconName(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!ICON_ID_RE.test(normalized)) {
    throw new Error(`figma-import: ${JSON.stringify(value)} не образует канонический icon id`);
  }
  return normalized;
}

function stripRootPaint(svg, source) {
  return svg.replace(/^<svg\b[^>]*>/i, (tag) => {
    const paints = [...tag.matchAll(/\sfill\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)];
    if (paints.length > 1) {
      throw new Error(`figma-import: ${source} повторяет root fill`);
    }
    if (paints.length === 0) return tag;
    const paint = paints[0];
    const value = (paint[1] ?? paint[2] ?? '').trim().toLowerCase();
    if (!MONOCHROME_PAINT.has(value)) {
      throw new Error(`figma-import: ${source} root fill=${JSON.stringify(value)} вне монохромного контракта`);
    }
    return tag.replace(paint[0], '');
  });
}

function stripPathPaint(svg, source) {
  return svg.replace(/<path\b[^>]*>/gi, (tag) => {
    if (/(?:^|;)\s*fill\s*:/i.test(tag.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find((value) => value != null) ?? '')) {
      throw new Error(`figma-import: ${source} path style.fill вне закрытого paint-контракта`);
    }
    const paints = [...tag.matchAll(/\sfill\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)];
    if (paints.length > 1) {
      throw new Error(`figma-import: ${source} повторяет path.fill`);
    }
    if (paints.length === 0) return tag;
    const value = (paints[0][1] ?? paints[0][2] ?? '').trim().toLowerCase();
    if (!PATH_PAINT.has(value)) {
      throw new Error(`figma-import: ${source} path fill=${JSON.stringify(value)} вне монохромного контракта`);
    }
    return tag.replace(paints[0][0], '');
  });
}

export function normalizeFigmaSvg(input, { source = '<memory>' } = {}) {
  if (typeof input !== 'string') throw new TypeError('figma-import: SVG обязан быть строкой');
  const document = input.replace(/^\uFEFF/, '').trim();
  const openingRoots = document.match(/<svg\b/gi)?.length ?? 0;
  const closingRoots = document.match(/<\/svg\s*>/gi)?.length ?? 0;
  if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/i.test(document) || openingRoots !== 1 || closingRoots !== 1) {
    throw new Error(`figma-import: ${source} обязан иметь ровно один корневой <svg> без мусора до него`);
  }

  let normalized = stripRootPaint(document, source);
  normalized = lowerViewportIdentityClip(normalized);
  normalized = stripPathPaint(normalized, source);

  // Это одновременно проверяет viewBox, закрытый svg+path-язык, локальный
  // fill-rule и непустую геометрию. Ошибка возникает до любой записи на диск.
  if (authorPathEntries(normalized).length === 0) {
    throw new Error(`figma-import: ${source} не содержит рендерящихся path`);
  }
  return `${normalized}\n`;
}
