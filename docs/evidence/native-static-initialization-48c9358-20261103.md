# Отложенная инициализация семантических данных

Источник: `48c9358d96ab989ee408a6bf695d64b08a642835`, срез RUNTIME-SLICE-01.
Статический native import не создаёт source, capabilities и metadata records.
Сгенерированный модуль создаёт соответствующую фабрику при первом обращении.
Данные остаются замороженными, повторный default возвращает тот же объект.
Части, контуры, авторские SVG, anchors и публичные декларации сохранены.

Внутренние object-only фабрики не менялись. Cache принадлежит generated module; shared
data provider сохраняет identity исходника при использовании base, variation
и content entrypoints в любом порядке. Равные motion descriptors создаются
независимыми записями. Сообщение invalid variant стало короче; TypeError,
допустимые значения и received value сохранены.

## Выполненные проверки

125/125 bounded checks прошли на точном источнике: исходные данные и SVG,
публичные имена/arity, frozen/shared identity, getters, точные отказы,
вариации mic `bodyWidth` 0.8/0.9/1, сохранённые byte budgets и deliberate
eager-initialization controls. Native marker witness проверяет два настоящих
семейства и оба порядка первого обращения к source/capabilities.

[Числа и source digests](native-static-initialization-48c9358-20261103.json)
получены в малом installed-layout fixture на Windows x64, Node v24.15.0,
esbuild 0.28.1 и fflate 0.8.3, gzip level 9/mtime 0. Полный каталог не собирался.
Обе стороны используют одинаковые payload, текущий emitter и один production
build helper; frozen runtime source — `eccb51c4398d8b5ff95ece70d36ac4dbaf81e356`.
Это сравнение исходников runtime при фиксированной политике сборки.

| Точный consumer entry | Raw / gzip B | Сохранённый потолок B |
|---|---:|---:|
| `glyph-one`: `glyph()` alert | 11209 / 3190 | 12433 / 3265 |
| `authored-time`: `glyph()` time | 8403 / 3135 | 12652 / 3250 |
| `authored-static`: Outline time | 1155 / 583 | 1155 / 583 |

Изолированная проверка API/identity использовала десять fresh ESM sessions
пяти семейств: literal, packet, annulus/content, dots и mic. Отдельные оси
проверили цену изменения для потребителя и восстановление freeze observer.
Общий source-only verdict на 48c9358 — PASS.

Условный comparator на первом commit `dc72e5b` не запускал десять проверок:
извлечённая historical функция теряла lexical `MINIFIED_ENTRIES`. Дефект
независимо воспроизведён и исправлен в 48c9358: обе стороны вызывают полный
production helper. Исправление отдельно перепроверено; прежний FAIL сохранён.

## Граница результата

Native import продолжает загружать и разбирать dependency closure одного
символа. Отложенное создание records не доказывает отсутствие иных аллокаций.
Freeze observer в отдельном consumer process различает import, first use,
warm default и explicit request; он не включён в latency/heap measurements.
Замораживание разобранного explicit request учитывается отдельно от IR.

Полная упаковка, установка tarball, браузер и сравнительные CPU/memory/timing
наблюдения этого SHA здесь не выполнялись. BENCH-01, native Lottie fidelity,
полная оптическая приёмка и publication остаются открытыми. Авторские рисунки
и допуск `bodyWidth` этим срезом не расширяются.
