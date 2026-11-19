/**
 * Fail-closed intake Figma SVG в канонический source-язык библиотеки.
 * Функция меняет только доказанно нейтральную экспортную обвязку: paint
 * монохромного мастера и viewport-identity clip. Геометрия path не округляется.
 */

import {
  authorPathEntries,
  lowerViewportIdentityClip,
} from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { optimize } from 'svgo';

const ICON_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MONOCHROME_PAINT = new Set(['none', 'currentcolor', '#101012']);
const PATH_PAINT = new Set(['currentcolor', '#101012']);
const ELEMENT_NAMES = new Set(['svg', 'path', 'g', 'defs', 'clipPath', 'rect']);

// Целый атрибут потребляется вместе с кавычками: текст внутри d/style не
// является отдельным атрибутом, даже если выглядит как id='…' или fill='…'.
function mapAttributes(tag, transform) {
  return tag.replace(/[\t\n\r ]+([^\t\n\r <>="'/]+)[\t\n\r ]*=[\t\n\r ]*(?:"([^"]*)"|'([^']*)')/g,
    (original, name, doubleQuoted, singleQuoted) => transform({ original, name, value: doubleQuoted ?? singleQuoted }));
}

/** Имена и node ID сохраняются в provenance мастера, отдельно от геометрии. */
function stripExportMetadata(tag, source) {
  const seen = new Set();
  return mapAttributes(tag, ({ original, name }) => {
    if (name !== 'id' && name !== 'data-node-id') return original;
    if (seen.has(name)) throw new Error(`figma-import: ${source} повторяет export metadata ${name}`);
    seen.add(name);
    return '';
  });
}

/** Удаление сбалансированной группы допустимо лишь без наследуемых эффектов. */
function lowerNeutralExportGroups(svg, source) {
  let depth = 0;
  const lowered = svg.replace(/<\/?g\b[^>]*>/gi, (tag) => {
    if (/^<\/g\s*>$/i.test(tag)) {
      if (depth === 0) throw new Error(`figma-import: ${source} имеет несбалансированную группу`);
      depth -= 1;
      return '';
    }
    if (!/^<g\b/i.test(tag)) {
      throw new Error(`figma-import: ${source} имеет невалидный closing group`);
    }
    const neutral = stripExportMetadata(tag, source);
    if (!/^<g\s*\/?\s*>$/i.test(neutral)) {
      throw new Error(`figma-import: ${source} группа несёт render-семантику; допустимы только id/data-node-id`);
    }
    if (!/\/\s*>$/.test(tag)) depth += 1;
    return '';
  });
  if (depth !== 0) throw new Error(`figma-import: ${source} имеет несбалансированную группу`);
  return lowered.replace(/<path\b[^>]*>/gi, (tag) => stripExportMetadata(tag, source));
}

export function canonicalIconName(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!ICON_ID_RE.test(normalized)) {
    throw new Error(`figma-import: ${JSON.stringify(value)} не образует канонический icon id`);
  }
  return normalized;
}

function stripRootPaint(svg, source) {
  let inheritsNone = false;
  const stripped = svg.replace(/^<svg\b[^>]*>/, (tag) => {
    let seen = false;
    return mapAttributes(tag, ({ original, name, value }) => {
      if (name !== 'fill') return original;
      if (seen) throw new Error(`figma-import: ${source} повторяет root fill`);
      seen = true;
      const paint = value.trim().toLowerCase();
      if (!MONOCHROME_PAINT.has(paint)) throw new Error(`figma-import: ${source} root fill=${JSON.stringify(paint)} вне монохромного контракта`);
      inheritsNone = paint === 'none';
      return '';
    });
  });
  if (inheritsNone) {
    for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
      let explicitFill = false;
      mapAttributes(tag, ({ original, name }) => {
        if (name === 'fill') explicitFill = true;
        return original;
      });
      if (!explicitFill) throw new Error(`figma-import: ${source} path наследует root fill=none; требуется явная поддержанная заливка`);
    }
  }
  return stripped;
}

function stripPathPaint(svg, source) {
  return svg.replace(/<path\b[^>]*>/gi, (tag) => {
    let seen = false;
    return mapAttributes(tag, ({ original, name, value }) => {
      if (name === 'style' && /(?:^|;)\s*fill\s*:/i.test(value)) throw new Error(`figma-import: ${source} path style.fill вне закрытого paint-контракта`);
      if (name !== 'fill') return original;
      if (seen) throw new Error(`figma-import: ${source} повторяет path.fill`);
      seen = true;
      const paint = value.trim().toLowerCase();
      if (!PATH_PAINT.has(paint)) throw new Error(`figma-import: ${source} path fill=${JSON.stringify(paint)} вне монохромного контракта`);
      return '';
    });
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
  // Проверяем исходный XML штатным парсером уже используемого SVGO. Его
  // сериализация отброшена: она не меняет авторские d или порядок контуров.
  optimize(document, { plugins: [{
    name: 'validate-author-element-names',
    fn: () => ({ element: { enter(node) {
      if (!ELEMENT_NAMES.has(node.name)) throw new Error(`figma-import: ${source} недопустимый SVG элемент <${node.name}>`);
    } } }),
  }], multipass: false, path: source });

  let normalized = stripRootPaint(document, source);
  normalized = lowerViewportIdentityClip(normalized);
  normalized = lowerNeutralExportGroups(normalized, source);
  normalized = stripPathPaint(normalized, source);

  // Это одновременно проверяет viewBox, закрытый svg+path-язык, локальный
  // fill-rule и непустую геометрию. Ошибка возникает до любой записи на диск.
  const entries = authorPathEntries(normalized);
  if (entries.length === 0) {
    throw new Error(`figma-import: ${source} не содержит рендерящихся path`);
  }
  for (const entry of entries) {
    const segments = parsePathData(entry.d);
    if (segments[0]?.cmd !== 'M' || segments.some((segment) => Object.values(segment).some((value) => typeof value === 'number' && !Number.isFinite(value)))) {
      throw new Error(`figma-import: ${source} имеет невалидный path`);
    }
  }
  return `${normalized}\n`;
}
