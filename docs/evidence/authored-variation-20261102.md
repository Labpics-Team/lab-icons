# Авторская вариация: локальная проверка

Дата: 2026-11-02. Base source: `75c67fc32a3f6b037df091f1383adfae754f21f8`.
Worktree: `E:/AgentWork/lab-icons-author-variation-20261102`.

Исходный RED: narrow Vitest witness запросил у прежнего `createCompiledGlyph`
`variation: { dotScale: 1.1, spacingScale: 0.9 }` и потребовал изменённый `d`.
Он упал с предметным отказом `TypeError: неизвестные поля запроса: variation`;
runtime и fixture импортировались. Для нового допущенного symbol runtime тот же
публичный запрос проверен на четырёх настоящих authored masters.

Проверки **Да**: 89 тестов в пяти файлах (`authored-variation`, `author-activity`,
`author-anatomy`, `symbol-runtime`, `symbol-modules`), 2.40 s, Vitest 4.1.12/Node 24.15.0.
Они проверили exact default object/path/paint, независимые Outline/Filled,
изменение size и gap по точному `pathBBox`, control-hull domain и policy receipt,
неподдержанные compound/nested families, source/axis/polarity drift, stable IDs,
существующие horizontal opacity gestures и отказ выдуманного vertical motion.
Lottie probe проверяет положительный static export и точный
`VARIATION_UNSUPPORTED` для запроса изменённой геометрии.

Проверки **Да**: узкий TypeScript `--ignoreConfig --noEmit` для variation/motion/
Lottie runtime с `strict`, `noUncheckedIndexedAccess`, ES2022 и bundler resolution.
Первый вызов без `--ignoreConfig` был отвергнут текущим TypeScript до проверки исходника;
затем исправлена несовместимость возвращаемого типа в ветке неверного запроса.

Проверки **Да**: четыре проверки mock artifact/type closure в двух затронутых
файлах `release-contract` и `package-artifact`. Полный первый `release-contract`
запуск нашёл два устаревших fixture graph; их compiler declaration теперь
отражает реальную связь с variation provenance. Повторный запуск проверил именно
две затронутые проверки; остальные 16 не запускались повторно. В package fixture
две выбранные проверки прошли, 22 остальных не запускались. `node --check`
прошёл для изменённых build/package/compiler scripts; `git diff --check` прошёл.

Проверки **Не было**: полный build/suite, npm packed consumer, browser и preview
16/24/48, benchmark, независимое review immutable commit, remote CI, merge и
runtime release. Эти проверки остаются у основного delivery-среза и self-hosted
runner. Budgets, workflows и исходные masters не изменены.

После интеграции найден отдельный declaration-контрпример: обычные symbol
declarations получили повторение `variation?: never` и выросли на 34 bytes каждая
(`component`: 484 при прежнем потолке 450). Ограничение перенесено в общий
`AuthorSymbolGlyphRequest`; variation request исключает это поле перед собственным
объявлением. Публичная перегрузка сохраняет тот же контракт. Узкий реальный
TypeScript consumer прошёл положительные случаи и три точных отрицательных
диагностики; `component`, `time`, `ellipse` снова имеют 450/440/446 bytes, равные
прежним потолкам. Runtime не менялся. Полный packed type/size gate остаётся открыт.
