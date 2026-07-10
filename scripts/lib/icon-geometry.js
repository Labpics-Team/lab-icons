/**
 * scripts/lib/icon-geometry.js — геометрия слоёв иконки из исходного SVG (zero-dep).
 *
 * Порядок <path> пока является историческим контрактом анимационного слоя, но
 * статические гейты не имеют права склеивать разные элементы в один compound
 * path: SVG применяет fill-rule к каждому <path> отдельно, а затем композитит
 * их чернила объединением. renderedPathEntries сохраняет эту границу.
 */

import { pathBBox } from './path-data.js';

const SVG_TAG_RE = /<svg\b[^>]*>/i;
const PATH_TAG_RE = /<path\b[^>]*>/gi;
const FILL_RULE_CONTAINER_RE = /<(?:svg|g)\b[^>]*>/gi;
const CSS_WIDE_FILL_RULES = new Set(['inherit', 'unset', 'revert', 'revert-layer']);

/** Значение quoted-атрибута тега; имя обязано начинаться после whitespace. */
function attributeValue(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : null;
}

/**
 * Первый moveto path-элемента по SVG-спеке АБСОЛЮТЕН даже при «m» —
 * но при последующей обработке фрагмента он может перестать быть первым.
 * Нормализация: m→M + явная l перед неявным относительным хвостом.
 */
function normalizeHead(d) {
  // СТРОГОЕ SVG-число: один знак, максимум одна точка, опц. экспонента —
  // жадный [\d.]+ склеивал «7.57.62.5» в одно «число» и ломал radio.
  const num = String.raw`[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
  return d.replace(
    new RegExp(String.raw`^\s*m[\s,]*(${num})[\s,]*(${num})([\s,]*)([+-]?[\d.]|)`),
    (whole, x, y, sep, tailStart) =>
      `M${x} ${y}` + (tailStart ? `l${tailStart}` : sep + tailStart),
  );
}

function normalizeFillRule(value, source) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'evenodd' || normalized === 'nonzero') return normalized;
  if (normalized === 'initial') return 'nonzero';
  if (CSS_WIDE_FILL_RULES.has(normalized)) {
    throw new Error(
      `icon-geometry: ${source} использует ${normalized}; inherited fill-rule без полного XML/CSS cascade запрещён`,
    );
  }
  return null;
}

/**
 * Значение fill-rule из inline style с реальной локальной cascade:
 * - style перекрывает presentation attribute;
 * - среди деклараций одного приоритета побеждает последняя;
 * - !important перекрывает обычную декларацию;
 * - синтаксически неверная декларация игнорируется по CSS-правилам.
 */
function styleFillRule(style) {
  if (typeof style !== 'string') return null;
  let selected = null;
  for (const declaration of style.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    if (property !== 'fill-rule') continue;

    const raw = declaration.slice(colon + 1).trim();
    const important = /\s*!important\s*$/i.test(raw);
    const value = normalizeFillRule(
      raw.replace(/\s*!important\s*$/i, ''),
      'inline style fill-rule',
    );
    if (!value) continue;

    if (!selected || important || !selected.important) selected = { value, important };
  }
  return selected?.value ?? null;
}

/**
 * Эффективный fill-rule самого path. В корпусе наследуемый fill-rule на
 * контейнерах запрещён: без полноценного XML cascade его нельзя угадывать.
 */
function ownFillRule(tag) {
  const styled = styleFillRule(attributeValue(tag, 'style'));
  if (styled) return styled;

  const direct = attributeValue(tag, 'fill-rule');
  return direct == null ? 'nonzero' : (normalizeFillRule(direct, 'presentation attribute fill-rule') ?? 'nonzero');
}

/**
 * Не молчим на наследуемом fill-rule. Поддержать каскад «примерно» хуже, чем
 * упасть: вложенные группы потребовали бы XML-стек и могли дать ложнозелёный
 * topology verdict. Канон корпуса — правило локально на path.
 */
function assertPathLocalFillRule(svgContent) {
  for (const tag of svgContent.match(FILL_RULE_CONTAINER_RE) ?? []) {
    const direct = attributeValue(tag, 'fill-rule');
    const style = attributeValue(tag, 'style');
    if (direct != null || /(?:^|;)\s*fill-rule\s*:/i.test(style ?? '')) {
      throw new Error('icon-geometry: наследуемый fill-rule на <svg>/<g> запрещён; перенести правило на конкретный <path>');
    }
  }
}

/**
 * Рендерящиеся path-элементы без геометрии из <defs>.
 *
 * @returns {Array<{index:number, d:string, fillRule:'evenodd'|'nonzero'}>}
 */
export function renderedPathEntries(svgContent) {
  const withoutDefs = svgContent.replace(/<defs\b[\s\S]*?<\/defs>/gi, '');
  assertPathLocalFillRule(withoutDefs);
  const entries = [];
  let index = 0;
  for (const tag of withoutDefs.match(PATH_TAG_RE) ?? []) {
    const d = attributeValue(tag, 'd');
    if (!d) continue;
    entries.push({ index, d: normalizeHead(d), fillRule: ownFillRule(tag) });
    index++;
  }
  return entries;
}

/**
 * Обратносовместимый список d-строк. Использовать join() допустимо только для
 * метрик, которым безразлична per-path семантика заливки; рендер-гейты обязаны
 * потреблять renderedPathEntries().
 */
export function renderedPathData(svgContent) {
  return renderedPathEntries(svgContent).map((entry) => entry.d);
}

/**
 * @param {string} svgContent — содержимое .svg файла
 * @returns {{
 *   viewBox: {x:number, y:number, width:number, height:number},
 *   paths: Array<{ index:number, bbox:{minX:number,minY:number,maxX:number,maxY:number},
 *                  anchor:{x:number,y:number}, width:number, height:number, area:number }>
 * }}
 */
export function iconGeometry(svgContent) {
  const svgTag = svgContent.match(SVG_TAG_RE)?.[0] ?? null;
  const rawViewBox = svgTag ? attributeValue(svgTag, 'viewBox') : null;
  if (rawViewBox == null) throw new Error('icon-geometry: viewBox не найден');

  const values = rawViewBox.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`icon-geometry: невалидный viewBox "${rawViewBox}"`);
  }
  const [x, y, width, height] = values;

  const paths = [];
  for (const { index, d } of renderedPathEntries(svgContent)) {
    const bbox = pathBBox(d);
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    paths.push({
      index,
      bbox,
      anchor: { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 },
      width: w,
      height: h,
      area: w * h,
    });
  }
  if (paths.length === 0) throw new Error('icon-geometry: в SVG нет <path>');
  return { viewBox: { x, y, width, height }, paths };
}
