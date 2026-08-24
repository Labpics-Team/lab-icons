# SIZE-01 — бюджеты consumer-бандлов и вердикт full-catalog vs split

Финальные замеры на master `14ccd5e` (INV-06 + CONTRACT-PREP влиты); столбец
«до» — тот же метод на `423506d`. `pnpm build` воспроизводит package-size
ratchet байт-в-байт (`check-package-size: OK`). Windows, node v24.15.0,
esbuild 0.28.1, fflate 0.8.3.

## Сценарии (esbuild: bundle+minify+treeshake, platform=browser, es2022)

Пакетные subpath-импорты резолвятся в `dist/*` — так, как их видит потребитель
опубликованного пакета.

## До INV-06 (`423506d`) / после (`14ccd5e`)

| # | Сценарий | min bytes до → после | gzip (fflate-9)¹ до → после | brotli-11 до → после | import² до → после |
|---|----------|---------------------:|----------------------------:|---------------------:|-------------------:|
| A | `import { accessibilityFilled } from '@labpics/icons'` | 637 → 637 | 394 → 394 | 353 → 353 | 1.8 → 1.8 ms |
| B | `import { glyph } from '@labpics/icons/ir'` + 1 вызов | 929 423 → **837 563** (−9.9%) | 225 714 → **210 010** (−7.0%) | 168 536 → **156 803** (−7.0%) | 18.2 → 16.4 ms |
| C | `import * as icons from '@labpics/icons'` (все 476) | 362 391 → 362 391 | 102 372 → 102 372 | 72 054 → 72 054 | 5.8 → 5.8 ms |
| D | `import { buildCalendarNumberGeometry } from '@labpics/icons/ir/recipes'` | 11 537 → 11 537 | 4 590 → 4 590 | 4 055 → 4 055 | — |

¹ fflate@0.8.3 `gzipSync level=9 mtime=0` — pinned oracle репозитория (тот же,
что в обоих ratchet); zlib-9 для справки: A 390, B 196 634, C 96 969, D 4 525.
² parse+eval: `await import()` собранного бандла в свежем node-процессе,
медиана из 5; пол пустого модуля ≈ 0.6 ms — вычитать при интерпретации.

Разложение дельты B по промежуточному коммиту `cc4bd1f` (чистый INV-06):

| Срез | min bytes | fflate-gzip | brotli |
|------|----------:|------------:|-------:|
| INV-06: anatomy.runtime.json вместо anatomy.json | −91 994 | −15 795 | −11 822 |
| CONTRACT-PREP: GlyphModelError + semver-класс | +134 | +91 | +89 |

Эффект INV-06 подтверждён измерением; цена GlyphModelError — 134 B min
(0.016% бандла B), приемлема без обсуждения.

Числа A/C/D на `423506d` отличаются от r1-отчёта на −7…−47 B (A 644→637,
C 362 431→362 391, D 11 544→11 537 при идентичном dist): расхождение метода
записи entry, не кода. Канон отныне — скрипт гейта (`bundleScenario`, stdin
`console.log`-anchor); оба замера «до/после» в таблице сделаны им, столбцы
сопоставимы.

## Attribution сценария B (esbuild metafile, bytesInOutput, `14ccd5e`)

| Модуль | bytes | доля |
|--------|------:|-----:|
| `dist/index.js` (все 476 SVG-литералов через `import * as staticIcons`) | 362 384 | 43.3% |
| `dist/ir/index.js` (код IR + catalog.json + anatomy.runtime.json + grid.json) | 475 053 | 56.7% |

Внутри `dist/ir/index.js`: catalog.json ~345 KB — крупнейшая оставшаяся
статья; anatomy-статья после INV-06 сжата кратно (runtime-проекция 32 глифов
вместо полного anatomy.json).

## Факты

1. **Tree-shake статического entry идеален**: 1 иконка = 637 B min / 353 B br.
   В бандл A попадает только срез dist/index.js, ноль чужих модулей.
2. **`/ir` монолитен**: `glyph()` для одной иконки тянет 156.8 KB brotli —
   весь статический каталог (namespace-импорт `import * as staticIcons`
   неразделим tree-shake-ом) и весь catalog.json. INV-06 снял anatomy-статью,
   но структурная причина монолита осталась.
3. **Full-catalog статики дешевле, чем кажется**: все 476 иконок = 72.1 KB
   brotli / 102.4 KB gzip. Это цена «иконки всего продукта», а не страницы.
4. **`/ir/recipes` — уже существующий и работающий split**: 11.5 KB min /
   4.1 KB brotli без каталога и статики (ratchet защищает forbiddenNeedles).
5. **Parse/eval**: монолитный B = ~16 ms в node (однократно на загрузку).
   Не блокер сам по себе; блокером остаётся transfer.

## Вердикт: full-catalog для статики — ДА; монолит для `/ir` — НЕТ

- **Статический entry (`.`)**: split не нужен. Per-icon tree-shake уже даёт
  ~0.4–3.4 KB на иконку, полный импорт — 72 KB brotli. Per-icon файлы (476 шт.)
  добавили бы install-вес и request-фан-аут без выигрыша в transfer.
- **`/ir`**: цена «одного `glyph()`» = 156.8 KB brotli — дефект формы, не
  данность. Направления снижения (по attribution, в порядке отдачи):
  1. `import * as staticIcons` → source-only-путь по требованию или явная
     инъекция потребителем (−362 KB min, −43%);
  2. ~~INV-06: anatomy.runtime.json~~ — **сделано**, −92 KB min / −11.8 KB br;
  3. catalog.json (~345 KB min) — кандидат на runtime-проекцию, отдельный узел.
- Решение «split loaders» для статики **отклонено измерением**; решение
  «разгрузить /ir» **подтверждено измерением** — это следующие узлы, не SIZE-01.

## Бюджеты (baseline master `14ccd5e` + допустимый рост)

Рост ≤ +10% от baseline — люфт на несжимаемые правки (новый axis-контракт,
багфикс геометрии); всё сверх — только с измеренным объяснением (INV-11).
Для C рост дополнительно ограничен природой: новые иконки. 476 иконок × avg
733 B → ~+0.2% на иконку; +10% ≈ +45 новых иконок без пересмотра.

| Сценарий | Метрика | Baseline | Ceiling (+10%) |
|----------|---------|---------:|---------------:|
| A: 1 статическая | min bytes | 637 | 700 |
| A | fflate-gzip | 394 | 433 |
| B: glyph() 1 иконка | min bytes | 837 563 | 921 319³ |
| B | fflate-gzip | 210 010 | 231 011³ |
| C: full catalog | min bytes | 362 391 | 398 630 |
| C | fflate-gzip | 102 372 | 112 609 |
| D: recipes-only | min bytes | 11 537 | 12 690 |
| D | fflate-gzip | 4 590 | 5 049 |

³ Бюджет B — временный потолок «не хуже»; целевое направление — вниз
(п. «Вердикт»). Опускание baseline — штатное движение ratchet, не требует
решения.

## Гейт (применён)

`scripts/check-consumer-size.js` + `release/consumer-size-ratchet.json` —
consumer-срезы A–D в `pnpm verify` рядом с `check:package-size`. Семантика та
же: baseline сверяется точно (drift в обе стороны виден), max — потолок;
measurement pinned к точным версиям esbuild/fflate из package.json;
изменение только вместе с измеренным объяснением в PR (INV-11).
Способность упасть доказана sabotage-прогоном (заниженный max → exit 1) и
негативными тестами `test/consumer-size.test.js`.

## Verify wall-time baseline (CI, gh run list -L 8, 2026-08-18)

| Run | Итог | Длительность |
|-----|------|-------------:|
| 32161493522 (#84 merge) | success | 14.5 мин |
| 32160036085 | success | 16.2 мин |
| 32156033905 | success | 14.7 мин |
| 32154789975 | success | 15.0 мин |
| 32153250949 | success | 14.8 мин |

Baseline: **~15 мин** (медиана success-ранов). Цена нового гейта локально
≈ 3 c (4 esbuild-бандла + gzip) — в шум CI-baseline.

## Воспроизведение

```sh
pnpm install --frozen-lockfile && pnpm build
node scripts/check-package-size.js     # dist == package-size ratchet
node scripts/check-consumer-size.js    # сценарии A–D == consumer ratchet
# brotli-11 и import-timing (не в гейте): esbuild JS API теми же опциями,
# node:zlib brotliCompressSync q11; timing — fresh node process,
# performance.now вокруг await import(bundle), 5 прогонов, медиана.
```
