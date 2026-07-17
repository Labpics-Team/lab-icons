/**
 * scripts/lib/icon-geometry.js — геометрия слоёв иконки из исходного SVG (zero-dep).
 *
 * Порядок <path> пока является историческим контрактом анимационного слоя, но
 * статические гейты не имеют права склеивать разные элементы в один compound
 * path: SVG применяет fill-rule к каждому <path> отдельно, а затем композитит
 * их чернила объединением. renderedPathEntries сохраняет эту границу.
 */

import { parsePathData, pathBBox } from './path-data.js';

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
  // Presentation attribute является CSS value: `\\65 venodd` браузер
  // декодирует как evenodd. Наш bounded parser намеренно не реализует CSS
  // escapes, поэтому принять неизвестное как default nonzero означало бы
  // засвидетельствовать другой силуэт. Закрытый язык допускает только literal.
  throw new Error(
    `icon-geometry: ${source} использует неканонический fill-rule ${JSON.stringify(value)}`,
  );
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
  return direct == null ? 'nonzero' : normalizeFillRule(direct, 'presentation attribute fill-rule');
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

function parsedViewBox(svgContent) {
  const svgTag = svgContent.match(SVG_TAG_RE)?.[0] ?? null;
  const rawViewBox = svgTag ? attributeValue(svgTag, 'viewBox') : null;
  if (rawViewBox == null) throw new Error('icon-geometry: viewBox не найден');

  const values = rawViewBox.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (
    values.length !== 4 ||
    values.some((value) => !Number.isFinite(value)) ||
    !(values[2] > 0 && values[3] > 0)
  ) {
    throw new Error(`icon-geometry: невалидный viewBox "${rawViewBox}"`);
  }
  return values;
}

function viewportRectangleSegments(viewBox) {
  const [x, y, width, height] = viewBox;
  return [
    { cmd: 'M', x, y },
    { cmd: 'L', x: x + width, y },
    { cmd: 'L', x: x + width, y: y + height },
    { cmd: 'L', x, y: y + height },
    { cmd: 'Z' },
  ];
}

/**
 * Исторические Figma-файлы содержат шесть clipPath, совпадающих с viewBox.
 * Для корневого <svg> это identity: viewport и без него отсекает те же точки.
 * Поддерживать clip «примерно» нельзя — IR пока не имеет clip composition.
 * Поэтому язык закрыт: только этот доказуемый no-op понижается в обычные paths,
 * любой иной clip обязан сначала получить явную IR-семантику.
 */
function lowerViewportIdentityClip(svgContent) {
  const hasClipPath = /<clipPath\b/i.test(svgContent);
  const hasClipReference = /\sclip-path\s*=/i.test(svgContent);
  if (!hasClipPath && !hasClipReference) return svgContent;
  if (!hasClipPath || !hasClipReference) {
    throw new Error('icon-geometry: неполный clipPath-контракт запрещён');
  }

  const svgTag = svgContent.match(SVG_TAG_RE)?.[0];
  const closeSvg = /<\/svg>\s*$/i.exec(svgContent);
  if (!svgTag || !closeSvg) throw new Error('icon-geometry: clipPath требует целый корневой <svg>');
  const body = svgContent.slice((svgContent.indexOf(svgTag) + svgTag.length), closeSvg.index);
  const structure = body.match(
    /^\s*<g\b([^>]*)>([\s\S]*?)<\/g>\s*<defs\b([^>]*)>\s*<clipPath\b([^>]*)>\s*(<path\b[^>]*>)\s*<\/clipPath>\s*<\/defs>\s*$/i,
  );
  if (!structure) {
    throw new Error(
      'icon-geometry: поддержан только один viewport-identity clipPath вокруг всех path',
    );
  }

  const [, groupAttrs, renderedBody, defsAttrs, clipAttrs, clipPathTag] = structure;
  if (defsAttrs.trim() !== '') {
    throw new Error('icon-geometry: атрибуты <defs> в identity clipPath запрещены');
  }
  const clipId = attributeValue(`<clipPath ${clipAttrs}>`, 'id');
  const clipUnits = attributeValue(`<clipPath ${clipAttrs}>`, 'clipPathUnits');
  const reference = attributeValue(`<g ${groupAttrs}>`, 'clip-path');
  if (
    !clipId ||
    (clipUnits != null && clipUnits !== 'userSpaceOnUse') ||
    reference !== `url(#${clipId})` ||
    groupAttrs.replace(/\sclip-path\s*=\s*(?:"[^"]*"|'[^']*')/i, '').trim() !== '' ||
    clipAttrs
      .replace(/\sid\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
      .replace(/\sclipPathUnits\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
      .trim() !== ''
  ) {
    throw new Error('icon-geometry: clipPath не является локальным viewport identity');
  }

  const clipD = attributeValue(clipPathTag, 'd');
  if (!clipD) throw new Error('icon-geometry: identity clipPath не имеет d');
  const extraClipPathAttrs = clipPathTag
    .replace(/^<path\b/i, '')
    .replace(/\/?\s*>$/, '')
    .replace(/\sd\s*=\s*(?:"[^"]*"|'[^']*')/i, '')
    .trim();
  if (extraClipPathAttrs !== '') {
    throw new Error('icon-geometry: identity clipPath path допускает только d');
  }
  const actual = JSON.stringify(parsePathData(normalizeHead(clipD)));
  const expected = JSON.stringify(viewportRectangleSegments(parsedViewBox(svgContent)));
  if (actual !== expected) {
    throw new Error(
      'icon-geometry: неэквивалентный clipPath запрещён; сначала выразить его в IR composition',
    );
  }
  const [viewX, viewY, viewWidth, viewHeight] = parsedViewBox(svgContent);
  for (const pathTag of renderedBody.match(PATH_TAG_RE) ?? []) {
    const d = attributeValue(pathTag, 'd');
    if (!d) continue;
    const bounds = pathBBox(normalizeHead(d));
    if (
      bounds.minX < viewX ||
      bounds.minY < viewY ||
      bounds.maxX > viewX + viewWidth ||
      bounds.maxY > viewY + viewHeight
    ) {
      throw new Error(
        'icon-geometry: viewport clip не identity для геометрии за viewBox',
      );
    }
  }
  return `${svgTag}${renderedBody}</svg>`;
}

/**
 * Закрытый source-язык после lowering: svg + fill-paths. Иначе fingerprint
 * path-data не является fingerprint отображения (transform/mask/stroke могли
 * бы поменять пиксели, не меняя d).
 */
function assertSupportedRenderedLanguage(svgContent, { artifact }) {
  const document = svgContent.trim();
  const root = document.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/i);
  const openingSvgCount = document.match(/<svg\b/gi)?.length ?? 0;
  const closingSvgCount = document.match(/<\/svg\s*>/gi)?.length ?? 0;
  if (!root || openingSvgCount !== 1 || closingSvgCount !== 1) {
    throw new Error(
      'icon-geometry: source обязан иметь ровно один корневой <svg> без nested viewport',
    );
  }
  const directPathResidue = root[1].replace(PATH_TAG_RE, '').trim();
  if (directPathResidue !== '') {
    throw new Error(
      'icon-geometry: внутри корневого <svg> разрешены только непосредственные <path>',
    );
  }

  const allowedTags = new Set(['svg', 'path']);
  for (const match of svgContent.matchAll(/<\/?([a-z][\w:-]*)\b[^>]*>/gi)) {
    const tagName = match[1].toLowerCase();
    if (!allowedTags.has(tagName)) {
      throw new Error(
        `icon-geometry: <${match[1]}> вне закрытого source-языка svg+path`,
      );
    }
  }

  const attributes = (tag) => {
    const head = tag.match(/^<([a-z][\w:-]*)\b/i);
    if (!head) throw new Error('icon-geometry: невалидный opening tag');
    let rest = tag.slice(head[0].length).replace(/\/?\s*>$/, '');
    const parsed = new Map();
    while (rest.trim() !== '') {
      const match = rest.match(/^\s+([a-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!match) throw new Error(`icon-geometry: невалидные атрибуты <${head[1]}>`);
      const name = match[1].toLowerCase();
      if (parsed.has(name)) throw new Error(`icon-geometry: повторён атрибут ${name}`);
      parsed.set(name, match[2] ?? match[3] ?? '');
      rest = rest.slice(match[0].length);
    }
    return parsed;
  };

  const svgTag = svgContent.match(SVG_TAG_RE)?.[0];
  if (!svgTag) throw new Error('icon-geometry: source обязан иметь корневой <svg>');
  const rootAttrs = attributes(svgTag);
  const allowedRootAttrs = new Set(['viewbox', 'xmlns', 'width', 'height', 'fill']);
  for (const name of rootAttrs.keys()) {
    if (!allowedRootAttrs.has(name)) {
      throw new Error(`icon-geometry: svg.${name} вне закрытого source-языка`);
    }
  }
  if (
    JSON.stringify(parsedViewBox(svgContent)) !== '[0,0,24,24]' ||
    rootAttrs.get('viewbox')?.trim() !== '0 0 24 24'
  ) {
    throw new Error('icon-geometry: source viewBox обязан быть literal 0 0 24 24');
  }
  for (const dimension of ['width', 'height']) {
    if (rootAttrs.get(dimension)?.trim() !== '24') {
      throw new Error(`icon-geometry: source ${dimension} обязан быть обязательным literal 24`);
    }
  }
  if (rootAttrs.get('xmlns') !== 'http://www.w3.org/2000/svg') {
    throw new Error('icon-geometry: source xmlns обязан быть http://www.w3.org/2000/svg');
  }
  const rootFill = rootAttrs.get('fill');
  if (artifact && rootFill?.toLowerCase() !== 'currentcolor') {
    throw new Error('icon-geometry: installed source svg.fill обязан быть currentColor');
  }
  if (!artifact && rootFill != null && !['currentcolor', '#101012'].includes(rootFill.toLowerCase())) {
    throw new Error('icon-geometry: source svg.fill вне монохромного контракта');
  }

  for (const pathTag of svgContent.match(PATH_TAG_RE) ?? []) {
    const pathAttrs = attributes(pathTag);
    const allowedPathAttrs = new Set(['d', 'fill', 'fill-rule', 'clip-rule', 'style']);
    for (const name of pathAttrs.keys()) {
      if (!allowedPathAttrs.has(name)) {
        throw new Error(
          `icon-geometry: path.${name} вне geometry fingerprint; сначала выразить семантику в IR`,
        );
      }
    }
    const fill = pathAttrs.get('fill');
    const allowedFills = artifact ? ['currentcolor'] : ['currentcolor', '#101012'];
    if (fill != null && !allowedFills.includes(fill.toLowerCase())) {
      throw new Error('icon-geometry: source path.fill вне монохромного контракта');
    }
    const style = attributeValue(pathTag, 'style');
    if (style == null) continue;
    const unsupported = style.split(';').some((declaration) => {
      const property = declaration.slice(0, declaration.indexOf(':')).trim().toLowerCase();
      return declaration.trim() !== '' && property !== 'fill-rule';
    });
    if (unsupported) {
      throw new Error(
        'icon-geometry: path style вне fill-rule не покрывается geometry fingerprint',
      );
    }
  }
}

/**
 * Рендерящиеся path-элементы без геометрии из <defs>.
 *
 * @returns {Array<{index:number, d:string, fillRule:'evenodd'|'nonzero'}>}
 */
function pathEntriesFromRenderedContent(renderedContent) {
  assertPathLocalFillRule(renderedContent);
  const entries = [];
  let index = 0;
  for (const tag of renderedContent.match(PATH_TAG_RE) ?? []) {
    const d = attributeValue(tag, 'd');
    if (!d) continue;
    entries.push({ index, d: normalizeHead(d), fillRule: ownFillRule(tag) });
    index++;
  }
  return entries;
}

export function renderedPathEntries(svgContent) {
  const renderedContent = lowerViewportIdentityClip(svgContent)
    .replace(/<defs\b[\s\S]*?<\/defs>/gi, '');
  return pathEntriesFromRenderedContent(renderedContent);
}

/**
 * Строгая граница source/catalog/package. В отличие от общего геометрического
 * reader, здесь запрещено всё, чья render-семантика не входит в fingerprint.
 */
export function sourcePathEntries(svgContent) {
  const renderedContent = lowerViewportIdentityClip(svgContent);
  // Сначала выдаём более точную ошибку для уже известного cascade-класса.
  assertPathLocalFillRule(renderedContent);
  assertSupportedRenderedLanguage(renderedContent, { artifact: true });
  return pathEntriesFromRenderedContent(renderedContent);
}

/** Авторский input до deterministic build lowering; root paint добавляет compiler. */
export function authorPathEntries(svgContent) {
  const renderedContent = lowerViewportIdentityClip(svgContent);
  assertPathLocalFillRule(renderedContent);
  assertSupportedRenderedLanguage(renderedContent, { artifact: false });
  return pathEntriesFromRenderedContent(renderedContent);
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
  const values = parsedViewBox(svgContent);
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
