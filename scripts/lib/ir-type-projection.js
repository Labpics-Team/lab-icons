/** Type-only проекция каталога: геометрия остаётся в JSON, union — компактным. */
export function renderIrTypeProjection(catalog) {
  const ids = Object.keys(catalog.icons).sort();
  const axes = Object.keys(catalog.axes).sort();
  const quote = (value) => `  '${value}',`;
  return [
    '/**',
    ' * Компактная type-level проекция semantics/catalog.json.',
    ' * Runtime всё равно использует полный канонический каталог; этот список не',
    ' * дублирует геометрию, а не даёт генератору .d.ts раскрыть весь JSON на сотни КБ.',
    ' */',
    'export const ICON_IDS = [',
    ...ids.map(quote),
    '] as const;',
    '',
    'export type CatalogIconId = (typeof ICON_IDS)[number];',
    '',
    `export const AXIS_NAMES = [${axes.map((axis) => `'${axis}'`).join(', ')}] as const;`,
    '',
    'export type CatalogAxisName = (typeof AXIS_NAMES)[number];',
    '',
  ].join('\n');
}
