/**
 * scripts/lib/icon-geometry.js — геометрия слоёв иконки из исходного SVG (zero-dep).
 *
 * Порядок <path> пока является историческим контрактом анимационного слоя, но
 * статические гейты не имеют права склеивать разные элементы в один compound
 * path: SVG применяет fill-rule к каждому <path> отдельно, а затем композитит
 * их чернила объединением. renderedPathEntries сохраняет эту границу.
 */

import { pathBBox } from './path-data.js';

const VIEWBOX_RE = /viewBox\s*=\s*["']([\d.\s-]+)["']/i;
const PATH_TAG_RE = /<path\b[^>]*>/gi;
const FILL_RULE_CONTAINER_RE = /<(?:svg|g)\b[^>]*>/gi;

/** Значение quoted-атрибута тега; corpus contract запрещает style-магии извне. */
function attributeValue(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? (match[1] ?? match[2] ?? '') : null;
}

/**
 * Первый moveto path-элемента по SVG-спеке АБСОЛЮТЕН даже при «m» —
 * но при последующей обработке фрагмента он может перестать быть первым.
 * Нормализация: m→M + явная l перед неявным относительным хвостом.
 */
function normalizeHead(d) {
  // СТРОГОЕ SVG-число: максимум одна точка, опц. экспонента — жадный
  // [\d.]+ склеивал «7.57.62.5» в одно «число» и ломал radio.
  const num = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`;
  return d.replace(
    new RegExp(String.raw`^\s*m[\s,]*(${num})[\s,]*(${num})([\s,]*)(-?[\d.]|)`),
    (whole, x, y, sep, tailStart) =>
      `M${x} ${y}` + (tailStart ? `l${tailStart}` : sep + tailStart),
  );
}

/**
 * Эффективный fill-rule самого path. В корпусе наследуемый fill-rule на
 * контейнерах запрещён: без полноценного XML cascade его нельзя угадывать.
 */
function ownFillRule(tag) {
  const direct = attributeValue(tag, 'fill-rule')?.trim().toLowerCase();
  if (direct === 'evenodd') return 'evenodd';
  if (direct === 'nonzero') return 'nonzero';

  const style = attributeValue(tag, 'style');
  const styled = style?.match(/(?:^|;)\s*fill-rule\s*:\s*(evenodd|nonzero)\b/i)?.[1];
  return styled?.toLowerCase() === 'evenodd' ? 'evenodd' : 'nonzero';
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
  const vb = VIEWBOX_RE.exec(svgContent);
  if (!vb) throw new Error('icon-geometry: viewBox не найден');
  const [x, y, width, height] = vb[1].trim().split(/\s+/).map(Number);
  if ([x, y, width, height].some((v) => !Number.isFinite(v))) {
    throw new Error(`icon-geometry: невалидный viewBox "${vb[1]}"`);
  }

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
