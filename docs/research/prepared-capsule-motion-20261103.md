# Подготовленная ширина из авторского закона

Срез продолжает `8e2b96e52cb65f06884a510af233865213ccf699` и существующие
оптические допуски capsule. Ни Figma masters, ни диапазон `[0.8, 1]` не менялись.
Сравнение формы с одними численными допусками не заменяет визуальную приёмку;
этому срезу нужна отдельная проверка установленного потребителя.

Build projection связывает `microphone-body` с реальной composition и проверяет
полный master, path fingerprint, порядок и адресацию SVG. Для negative Filled
`mic-circle` выдаётся программа полного `evenodd` path с неизменными prefix/suffix.
Потребителю не нужны индекс body, число контуров или координаты автора.

Static и prepared используют одну арифметику `capsule-path.ts`. При подготовке
команды преобразуются в плоские operands с буквальным префиксом команды.
В кадре нет массива control points, повторной сборки IR или hashing. Static
materialization дополнительно сохраняет проверку фактически вычисленных controls,
span и winding. Грамматика, конечность и связывание static packet не ослаблены.

На Node 24.15.0 выполнен узкий native контроль четырёх реальных source variants
для ширин `.8`, `.8000000000000002`, `.875`, `.9`, `.92`,
`.9999999999999999`, `1`. Все 28 static результатов совпали с runtime базового
SHA, а подготовленный физический `d` совпал с тем же legacy результатом.
Проверены точный default, frozen/reused preparation и точные отказы. Исходные
controls сохранены вне worktree в `width-motion-source-native-20261103`.
Это ограниченная проверка source, а не pack/browser или stress benchmark.

Отдельно выполнены семь повреждений packet/grammar и два PURE consumers:
preparation не удерживает metadata digest, metadata не удерживает геометрию
и sampler, оба не удерживают compiler/motion/authoring. Контракт относится
к именам export; caller bundler без `keepNames` может переименовать function
objects, как описано в esbuild. Это не меняет public export binding.

Измерение выявило, что whitespace-only build не укладывается в прежний motion
gzip budget. По [esbuild minify](https://esbuild.github.io/api/#minify) проверены
независимые штатные режимы; ограничения `.name` и `.toString()` проверены там же
и в [keep names](https://esbuild.github.io/api/#keep-names), 2026-11-03.
Syntax-only не устранил превышение. Полное штатное `minify` с `keepNames`
сохранило export names и retained graph и вошло в бюджеты обеих проверенных точек.
Property mangling не применяется. Остальные bundle entries не менялись.

| Runtime | Whitespace, raw/gzip B | Syntax, raw/gzip B | Minify + keepNames, raw/gzip B | Прежний ceiling |
|---|---:|---:|---:|---:|
| Motion из базового SHA | 14257 / 3942 | 13986 / 3897 | 11411 / 3776 | 14620 / 3817 |
| Capsule с общим serializer | 12179 / 5001 | 11930 / 4939 | 9186 / 4623 | 11254 / 4680 |

Проверка использовала esbuild 0.28.1, `target: es2022`, production externals,
provenance headers и package oracle `fflate gzipSync level=9 mtime=0`.
[Сырые результаты](prepared-capsule-build-options-20261103.json) содержат source
и output SHA-256. Измерены только два emitted runtime: полная native/bundled
стоимость новых потребителей, declarations, полный build/pack и браузерное
прерывание остаются для чистого self-hosted CI. Численные ceilings не повышены.

`test/author-capsule-motion.test.js` содержит real-source differential,
counterexample для whole-body scaleX, повреждение receipts/targets, отказы и
PURE consumers. `test/runtime-name-contract.test.js` проверяет имена реальных
production bundles и возвращаемой `glyph`, включая поведение exact default.
На момент source контроля Vitest не запускался; эти tests не записаны как PASS.
