# Граница публичных типов Glyph IR

Импорт `symbols/ellipse` раньше требовал декларации всего compiler и recipes.
Теперь данные Glyph IR живут в приватном `glyph-types`, а два исходных интерфейса
paint — в малом `paint-types`. Публичные имена, поля, перегрузки и literal IDs
сохранены. Compiler проверяет возвращаемый объект через `satisfies GlyphCompiler`;
`createGlyphCompiler` и регистрация кандидатов остаются внутренними.

Перенос закрывает общий источник зависимости: source symbols, named variations,
motion и экспортёры импортируют данные без функций compiler. Потребителю не нужно
знать новые приватные пути. Package exports их не открывает, release contract
включает требуемые транзитивные `.d.ts`.

## Проверенные альтернативы

- Размещение paint внутри `glyph-types` увеличивало recipes-only closure
  с 9 до 31 КБ. Отдельный малый leaf сохраняет одно определение каждого интерфейса.
- Вывод типа публичных функций средствами TypeScript 7 создавал extensionless
  `import("./glyph-types")`; реальный NodeNext consumer получал семь TS2834.
  Compiler-owned contract с явными `.js` type imports устранил этот отказ.
- `ReturnType<typeof createGlyphCompiler>` ссылался на удалённый `@internal`
  constructor и давал TS2305. Проверяемый contract оставляет constructor закрытым.
- Изменение function declarations на const ради коротких типов не используется:
  потребитель может расширять namespaces функций. Проверены также добавленные
  поля interfaces через фактические возвраты `./ir` и `./ir/recipes`.

Основания: [type-only imports и разрешение модулей](https://www.typescriptlang.org/docs/handbook/modules/reference.html),
[declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html).
Контрпримеры переноса interfaces:
[TypeScript #18877](https://github.com/microsoft/TypeScript/issues/18877),
[TypeScript #12607](https://github.com/microsoft/TypeScript/issues/12607).

## Измерение двух семей

Baseline: `1dd91b1bf3e58af5e2f72f634fd37a506bae942d`. Снимок текущих исходников
закреплён `sourceDigests` в [JSON](glyph-type-boundary-20261102.json).
Windows x64, Node 24.15.0, TypeScript 7.0.2; gzip fflate 0.8.3 level 9,
mtime 0; Brotli 1.2.0 quality 11. Семьи: ellipse и ellipsis-horizontal.
JSON содержит состав closure, хеш каждого output и отдельно результат сжатия
конкатенации. В таблице суммируются отдельно сжатые файлы, байты.

| Declaration closure | Raw до → после | gzip до → после | Brotli до → после |
|---|---:|---:|---:|
| Source ellipse | 34 906 → 22 890 | 10 778 → 7 563 | 8 965 → 6 260 |
| Variation ellipsis-horizontal | 35 152 → 23 139 | 10 814 → 7 609 | 8 963 → 6 294 |
| Публичный IR | 39 358 → 37 867 | 12 057 → 12 084 | 10 069 → 10 006 |
| Recipes | 9 239 → 9 497 | 2 341 → 2 602 | 1 991 → 2 197 |
| Все уникальные outputs | 41 984 → 40 412 | 13 404 → 13 399 | 11 125 → 10 991 |

Цена отдельного paint leaf: recipes-only +258 raw / +261 gzip / +206 Brotli.
Сумма gzip полного IR выросла на 27 байт; сумма всех уникальных outputs снизилась.
Это измерение деклараций, без вывода об import latency, памяти, runtime bundle,
установке пакета или готовности к production. Полные outputs и прежние budgets
должны проверяться self-hosted CI на публикуемом SHA.

## Проверка потребителя

`checkGlyphTypeBoundary()` используется существующим Vitest test и не требует
истории Git. Он создаёт installed-layout пакет из настоящих деклараций двух семей,
проверяет strict Bundler и NodeNext с `skipLibCheck: false`, различает source и
variation requests, проверяет Parameters/ReturnType, namespaces функций, интерфейсы
GlyphIR/GlyphCapabilities/RecipePart/NormalizedPoint и оба paint interfaces.
Отрицательные назначения получают точные TS2322, TS2345 и TS2339; исходные поля
сохраняют типы. Source и variation closures обязаны исключать compiler и recipes.

`node scripts/bench/glyph-type-boundary.mjs <полный-baseline-SHA> <report.json>`
добавляет сравнение с baseline. Последний запуск: findings `[]`.
Release-contract, symbol-modules и public type tests: 46 PASS.
Нормализованный esbuild 0.28.1 output всех 13 изменённых TS-модулей совпал с baseline;
два новых type leaves дают пустой JavaScript. Авторские paths и геометрия не менялись.

`pnpm exec` остановился до Vitest с `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` после изменения
package file projection. Проверки выполнены через установленный
`node node_modules/vitest/vitest.mjs`; версия 4.1.12 совпадает с lockfile.
Dependency install, полный build, pack, browser и тяжёлые benchmark здесь не запускались.
Ранее отвергнутый эксперимент сохранён в
[отдельном JSON](glyph-type-boundary-rejected-20261102.json).
