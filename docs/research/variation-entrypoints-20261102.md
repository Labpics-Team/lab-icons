# Явный импорт авторской вариативности

Обычный `symbols/<id>` снова загружает только проверенную авторскую форму.
`variations/<id>` явно подключает геометрический закон для того же символа.
Срез включает `ellipsis-horizontal` и `ellipsis-vertical`: четыре независимых
Outline/Filled masters из закреплённого Figma baseline. Их геометрия, receipt
и неизменённый результат variation сохраняются.

Измеренный producer: `a97d6953552f334509ae55d43c1e48f0fa432037`, tree
`ed645b79751839d035f41d7eddc0b053cc017a96`. Baseline:
`1b9412237a8d1b2db6e929be746dd79274390292`. SHA-256 emitter:
`297fe2bf57696aa7a7acfa39bb38a4d179ef3b4a051ca3227b93634de81fe027`.
[Машинный отчёт](variation-entrypoints-20261102.json) содержит hashes masters,
выходных файлов и bundles, полный граф разрешения и загруженные native модули.

## Владение и альтернативы

Compiler пишет один приватный `ir/symbol-data/<id>.js` только для доказанных
семейств. Оба публичных entrypoint используют его неизменяемые source objects
и author/anatomy receipts. Native probe проверяет `===` для defaults обоих
вариантов; приватный package import получает `ERR_PACKAGE_PATH_NOT_EXPORTED`.
Размещение данных остаётся решением compiler. Runtime parser, каталог,
интернирование и второй набор masters не нужны.

Прежний объединённый entrypoint включал variation engine в обычный `glyph()`.
Разделение только публичного имени с дублированием данных уменьшило бы отдельный
импорт ценой утраты общей identity. Отложенная асинхронная загрузка изменила бы
синхронный контракт `glyph()`. Выбран явный синхронный opt-in с общими данными.

Отдельный helper для добавления variation capabilities был проверен и отклонён:
capabilities-only bundle сохранял SHA engine. Текущий compiler помещает
материализацию capabilities в нулевую PURE IIFE; чтение и spread находятся
внутри удаляемого вызова. Используется существующая `createCompiledCapabilities`,
без нового runtime helper. Положительный glyph consumer сохраняет настоящий
engine; capabilities и static consumers удаляют его.

Обычный source request с `variation` получает `AUTHOR_VARIATION_UNSUPPORTED`.
Source capabilities не содержат этого поля и не обещают его в declarations.
Существование variation entrypoint не означает поддержку любого variant или
произвольного закона: admission принадлежит author spec и compiler.

Основания: [esbuild PURE](https://esbuild.github.io/api/#pure),
[tree shaking и side effects](https://esbuild.github.io/api/#tree-shaking),
[контрпример №1990](https://github.com/evanw/esbuild/issues/1990),
[Node package exports](https://nodejs.org/docs/latest-v24.x/api/packages.html#package-entry-points).
PURE подтверждает возможность удаления выражения; сохранение поведения и
фактических зависимостей отдельно проверяется consumers.

## Измерение

2026-11-02, Windows x64, Node 24.15.0, esbuild 0.28.1, fflate 0.8.3
с gzip level 9 / mtime 0, Brotli 1.2.0 quality 11. Compiler обрабатывает только
две семьи. Browser consumers: ESM, ES2022, minify, tree shaking и реальное
`sideEffects: false`; runtime projection использует production UTF-8 flags.
Каждый bundle исполняется, результаты сравниваются с baseline. Единственное
изменение source capabilities — удаление opt-in поля.

В таблицах — bytes `raw/gzip/Brotli`, baseline → producer.

| Consumer | Horizontal | Vertical |
|---|---|---|
| Source glyph | 27238/7411/6196 → 12970/3070/2545 | 26985/7356/6180 → 12911/3069/2543 |
| Source capabilities | 10545/2160/1792 → 7125/1581/1349 | 5760/1642/1421 → 2467/1103/968 |
| Source glyph + capabilities | 35982/8111/6751 → 18278/3674/3018 | 30944/7636/6416 → 13561/3221/2699 |
| Static Outline | 819/339/280 → 819/340/275 | 819/341/279 → 819/341/283 |
| Variable glyph | 27280/7425/6195 → 27288/7463/6209 | 27027/7371/6216 → 27035/7406/6247 |
| Variable capabilities | 10545/2160/1792 → 10571/2167/1817 | 5760/1642/1421 → 5786/1659/1437 |
| Variable glyph + capabilities | 36024/8122/6761 → 36050/8167/6773 | 30986/7649/6408 → 31012/7678/6452 |

Обычный glyph получает существенно меньший bundle; явный opt-in имеет небольшой
дополнительный compressed cost. Static consumer содержит только литерал SVG,
с тем же raw размером. Перемена имён после tree shaking меняет compressed bytes;
они не подбирались ради меньшего результата.

Cold native probe запускает отдельный Node process и наблюдает реальные loader
hooks. Ни один ordinary source import не загружает `variation-runtime.js`.
Следующая таблица суммирует raw размер загруженных файлов и размер **каждого
файла после отдельного сжатия**. Это иной сценарий, чем browser bundle.

| Native graph | Horizontal raw/gzip/Brotli | Vertical raw/gzip/Brotli |
|---|---|---|
| Baseline unified | 43532/10477/8504 | 38970/9965/8145 |
| Source | 20501/4573/3671 | 16662/4079/3364 |
| Variable отдельно | 42317/10740/8804 | 38157/10210/8457 |
| Variable, затем source | 42852/10964/8980 | 38688/10432/8633 |

Во всех новых native totals учтён приватный data module и его зависимости.
Добавление source после variable использует уже загруженные авторские объекты.
Общий raw граф стал меньше, но сумма compressed native файлов opt-in стала
больше baseline. Этот tradeoff сохранён в отчёте.

Прямые declarations `raw/gzip/Brotli`:

| Declaration | Horizontal | Vertical |
|---|---|---|
| Baseline unified | 718/257/206 | 712/257/205 |
| Source | 470/224/165 | 466/223/164 |
| Variable | 692/252/186 | 686/252/210 |

Прежние ceilings source declarations и runtime не увеличены. Новые outputs
ещё требуют измерения настоящего package artifact в self-hosted CI.

Воспроизведение с измеренного producer:

```powershell
node scripts/bench/variation-entrypoints.mjs 1b9412237a8d1b2db6e929be746dd79274390292 docs/research/variation-entrypoints-20261102.json
```

Это детерминированные размеры и dependency graphs, без timing, frame-time,
memory или статистических error bars. Полный build/pack, опубликованная установка,
browser/visual qualification и весь corpus в этом эксперименте не проверялись.
Native `registerHooks` используется только измерительным probe, не продуктом.

Узкие producer checks прошли: 62 tests для symbol modules, variation runtime/types,
release contract и export surface. Проверены Bundler/NodeNext consumers,
точные отказы, общая identity, независимость Outline/Filled, удаление engine
для capabilities/static и неизменённая variation geometry. Отдельный native
state export control прошёл; полный state suite здесь не запускался.
