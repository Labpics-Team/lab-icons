# Отклонённое разделение variation domain

2026-11-02 исследован повтор domain между compiled variation и её capabilities
в двух настоящих семействах многоточий. Baseline —
`633f963f5503e183f468c0d3763a24ec55c94afb`; текущий emitter сохраняет его
поведение. Четыре независимых Figma masters и `geometrySha256` не меняются.

Вариант выносил совпадающий domain каждого авторского варианта в отдельный
object literal. Обе PURE-фабрики получали прямую ссылку; Outline/Filled,
расходящиеся и отсутствующие записи оставались независимыми. Runtime parser,
новый API, интернирование и minification модуля не добавлялись. Выбор layout
сохранял прежние raw/gzip ограничения.

| Семейство | Module raw/gzip/Brotli до → после | glyph gzip до → после | capabilities gzip до → после |
|---|---|---|---|
| horizontal | 26704/4002/3175 → 23647/3990/3184 | 7422 → 7439 | 2160 → 2169 |
| vertical | 22142/3490/2816 → 19212/3490/2863 | 7378 → 7393 | 1642 → 1662 |

Combined glyph/capabilities consumer уменьшился на 2872/2745 raw bytes и
23/21 gzip bytes. Однако glyph-only получил дополнительные 12 raw bytes,
capabilities-only — 8; gzip и Brotli обоих сценариев также выросли.
Static consumer совпал по raw/gzip/Brotli и SHA256. Результат каждого
исполнимого consumer совпал с baseline по JSON fingerprint.

Уменьшение module raw не доказывает выигрыша потребителя. Пinned esbuild
сохраняет дополнительные object bindings после удаления неиспользуемой
фабрики. [Штатный PURE](https://esbuild.github.io/api/#pure) относится к вызову,
а [tree shaking](https://esbuild.github.io/api/#tree-shaking) удаляет
declarations; эти правила не гарантируют inline object literal. Первичные
секции повторно прочитаны 2026-11-02. Дополнительная whitespace-minification
не выбрана: она удаляет PURE по
[issue 1990](https://github.com/evanw/esbuild/issues/1990).

Вариант отклонён. Прежний emitter восстановлен; package ceilings не повышены.
Положительные controls реальных generated variation, независимых glyph/caps,
static tree shaking, precise refusal и расходящихся/отсутствующих записей
сохранены в `test/symbol-modules.test.js`. Настройка имён ради случайного gzip
и runtime представление ради этого маленького выигрыша не обоснованы.

[Raw результат](variation-domain-20261102.json) содержит digest и неизменяемый
текст экспериментального emitter для воспроизведения. Узкий
[probe](../../scripts/bench/variation-domain.mjs) принимает этот снимок:

```sh
node scripts/bench/variation-domain.mjs \
  633f963f5503e183f468c0d3763a24ec55c94afb \
  /tmp/variation-domain-repeat.json \
  docs/research/variation-domain-20261102.json
```

Среда: Windows x64, Node v24.15.0, esbuild 0.28.1, fflate 0.8.3 level 9/
mtime 0, Brotli 1.2.0 quality 11; обычный minified browser ESM bundle ES2022.
Payload проходит тот же compiler и target projection, что production build.
Это две семьи/четыре masters, не полный build/pack/install, браузерная
qualification, latency, память или публикация. Исходные module ceilings
многоточий остаются открытыми; отрицательный результат их не закрывает.
