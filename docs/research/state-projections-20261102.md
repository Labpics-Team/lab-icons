# Отдельная проекция возможностей state-группы

Проверка 2026-11-02. Исходный commit —
`3873ce53873f6bf7ac6b2e3a2cf35f73ba966f8f`.
Первый кандидат не прошёл размерный гейт. Исправление эмиссии ниже проходит
прежние потолки трёх модулей в ограниченной source-проверке; packed CI ещё не
выполнен. Готовность к поставке не утверждается. Бюджеты не изменены.

Настоящий consumer `status-circle-state` использует `renderStateSvg` вместе
с `compileStateEffect`. Общая фабрика получала SVG, авторские receipts и proof,
а также сразу создавала capabilities. Поэтому этот consumer сохранял metadata,
а импорт только capabilities сохранял геометрию.

Кандидат разделяет данные на две проекции: общий render/effect runtime и
capabilities. Runtime получает закрытые tuples
`[id, partId, contentSvg, staticSharedSvg?]`; metadata сохраняет named records.
Общие `sharedPartIds` передаются прямой локальной ссылкой. Публичный API,
исходные compiled payload/proof и SVG не меняются. Build проверяет
типы полей перед tuple-эмиссией; runtime не разбирает пути и не восстанавливает
анатомию. Импорт только effect сохраняет SVG этой группы, а импорт только
state render сохраняет effect runtime: это явная цена двух проекций.

[esbuild PURE](https://esbuild.github.io/api/#pure),
[maintainer issue 2279](https://github.com/evanw/esbuild/issues/2279) и
[issue 4191](https://github.com/evanw/esbuild/issues/4191), прочитанные в этом
исследовании 2026-11-02, объясняют ограничение общего объекта: PURE допускает
удаление вызова, но не объявляет произвольное чтение свойства безвредным.
Tree shaking не гарантирует повторную оптимизацию произвольной глубины.
Две прямые литеральные проекции позволяют штатному сборщику удалить ненужную
фабрику целиком. Требовать особых consumer-настроек не нужно.

Ранее проверенные три проекции отделяли ещё и effect от render, но добавляли
повторяемые IDs и увеличивали полный модуль. Дополнительные общие ссылки
уменьшали raw, но ухудшали gzip. После одного сравнения двух проекций
структурный подбор остановлен; эти альтернативы не скрывают открытый гейт.

## Ограниченное сравнение

[Исходные результаты](state-projections-20261102.jsonl) содержат SHA-256 всех
измеренных строк и одинаковые baseline/candidate inputs. Использованы
Windows, Node `v24.15.0`, esbuild `0.28.1`, fflate `0.8.3`
`gzipSync({level: 9, mtime: 0})`, Brotli `1.2.0` quality 11.
Оба emitter/runtime взяты соответственно из Git baseline и рабочего snapshot;
production compiler получил те же три enclosure-группы и Figma-мастера.
Bundle consumer — esbuild, browser ESM, ES2022, bundle/minify.

Детерминированные размеры записаны один раз; интервалы времени, error bars,
браузер, packed install, peak memory и throughput не измерялись. Это
bounded module/consumer control, а не удалённая BENCH-квалификация.

| Модуль, raw/gzip bytes | Baseline | Кандидат | Результат существующего ceiling |
|---|---:|---:|---|
| expression-face | 7052 / 3066 | 7138 / 3087 | FAIL: +86 / +21 |
| playback-circle | 4637 / 2126 | 4739 / 2149 | FAIL: +102 / +23 |
| status-circle | 10329 / 4401 | 10423 / 4416 | FAIL: +94 / +15 |

| status-circle consumer, raw/gzip bytes | Baseline | Кандидат |
|---|---:|---:|
| renderStateSvg + compileStateEffect | 13055 / 5518 | 9196 / 3819 |
| capabilities | 12960 / 5491 | 4167 / 1847 |
| state render | 12955 / 5491 | 9096 / 3794 |
| effect | 12996 / 5502 | 9137 / 3802 |
| полный публичный API | 13240 / 5552 | 13356 / 5556 |

Consumer экономит данные, но этот выигрыш не закрывает отдельный обязательный
ceiling конечного модуля. Увеличения лимитов и нового CI-пути нет.

## Проверенные свойства

`test/state-projections.test.js`: **19 PASS**. Проверены штатное удаление чужой
проекции, полный публичный API, обе SVG-композиции, shared-array identity,
замороженные receipts, пустой optional override, tuple slots,
11 malformed source packets, точные Unicode-строки и собственный JSON
`__proto__`, а также отказы и reduced motion.

Фокус `test/author-state-groups.test.js`: **25 PASS**, остальные **88 не
выполнялись**. Тесты теперь импортируют настоящий emitted module; старой
совместимой test-фабрики нет. Независимый oracle читает raw authored paths,
проверяет SVG, fixed suffix и эффекты. SHA исходных payload/proof совпали.
Полные public snapshots обоих runtime совпали для каждого состояния всех
трёх групп в отдельном сравнении. Это не claim о полной optical acceptance.

Полные type/build/pack, exact-SHA self-hosted CI, независимое review и
потребительская квалификация остаются открытыми. Размерный отказ уже известен
и должен быть разрешён владельцем до интеграции кандидата.

## Исправление эмиссии

После подтверждённого отказа сохранены обе проекции и их семантика. Из конечного
JavaScript удалён повторяемый generated-комментарий, сокращены приватные имена
и пробелы в фиксированном шаблоне wrappers. Публичные имена и два аргумента
каждой функции сохранены; обе PURE-аннотации записываются явно. Парсер,
препроцессор и consumer-настройки не добавлены. Whitespace-minification всего
модуля исключена: esbuild удаляет эти аннотации по
[штатному контракту](https://github.com/evanw/esbuild/issues/1990).

[Повторный ограниченный контроль](state-projection-fix-20261102.jsonl) использует
те же baseline, три source payload и версии инструментов. Emitter загружен
после изменения, а source/proof hashes и snapshots всех пяти публичных функций
совпали с baseline. Размеры raw/gzip:

| Модуль | Прежний потолок | Исправленный emitter |
|---|---:|---:|
| expression-face | 7052 / 3066 | 6785 / 2919 |
| playback-circle | 4637 / 2126 | 4386 / 1988 |
| status-circle | 10329 / 4401 | 10070 / 4245 |

Selective consumer сохранил выигрыш: status render+effect 9196/3819 вместо
13055/5518, capabilities 4167/1846 вместо 12960/5491. Все пять импортов вместе
дают 13356/5556 вместо 13240/5552; это наблюдаемая цена разделения, не claim
об улучшении этого сценария. Эти числа не являются измерением frame time или
памяти. Повторно выполнены 19 source consumer/refusal controls — PASS.
Устранение подтверждённого module finding требует независимого повторного
review; полный packed гейт и настоящий Lab UI consumer остаются открытыми.
