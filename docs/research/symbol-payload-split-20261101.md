# Независимые данные геометрии и возможностей

На baseline `983ac0b62398d95d9b5e68fd3025d0d733a14caa` импорт одного
`glyph()` удерживал геометрию и
`glyphCapabilities` одного символа. Обе функции замыкали общий объект
`source + capabilities` внутри `createCompiledSymbol`. Отсутствующий запрос
уже возвращал неизменяемую авторскую Outline-форму без разбора и новых объектов;
это поведение сохранено.

Генератор теперь экспортирует результаты двух независимых фабрик с
`/* @__PURE__ */`. Фабрика геометрии получает имя и две авторские формы;
фабрика возможностей получает только сведения о возможностях.
`freezeTree` остаётся общим владельцем неизменяемости. Дополнительных обёрток
при вызове публичных функций нет. Публичные имена, declarations, отдельный
Filled-мастер и ошибки запроса сохранены. Внутренняя общая фабрика удалена;
тестовые потребители обращаются к действующим фабрикам напрямую.

[esbuild API](https://esbuild.github.io/api/#tree-shaking), прочитанный
2026-11-01, определяет tree shaking как удаление declarations. PURE разрешает
удалить неиспользуемый вызов целиком; аргументы с побочными эффектами сохраняются.
Генератор передаёт литералы и локальные ссылки без таких эффектов. Замораживание
имеет значение только для сохраняемых данных этой функции и не регистрирует
глобальное состояние. Проверка использует установленный esbuild `0.28.1`.

Добавление PURE внутрь общей фабрики не разделяет используемое замыкание.
Передача этого решения настройкам потребителя тоже лишняя:
[Rollup `treeshake.propertyReadSideEffects`](https://rollupjs.org/configuration-options/#treeshake-propertyreadsideeffects)
описывает различия режимов и риск удаления getter/error-эффектов. Разделение
данных работает со штатными настройками esbuild и сохраняет существующий
контроль опасного чтения свойств.

На настоящем `renderSymbolModule` с настоящим runtime две проверки сначала
упали: импорт `glyph` сохранил sentinel возможностей, импорт
`glyphCapabilities` сохранил sentinel геометрии. Шесть соседних проверок прошли.
После изменения каждый импорт сохраняет свой sentinel и удаляет чужой.
Статический Outline-import удаляет оба набора и runtime; подмена его окружения
общим объектом и чтением свойств снова удерживает геометрию.

Ограниченные source-проверки подтверждают неизменяемую identity, отдельный
Filled, default-возможности, недоверенные запросы и `AUTHOR_PARITY_REQUIRED`.
Проверены также действующие motion/Lottie-потребители и имена экспортов.

Новые packed-измерения, полная CI и проверка declarations в установленном
consumer ещё требуются. Размерные бюджеты не менялись. Ускорение, экономия
байтов и публикация этим source-результатом не заявлены. Прямой native ESM-import
по-прежнему загружает весь модуль одного символа и исполняет обе фабрики:
tree shaking требует сборщика.

## Общие receipts без общего payload

На `d5ff4768107a12c01ec9ea860eea3c34bc73b2bb` независимые фабрики всё ещё
содержали две JSON-копии author provenance и, при наличии, anatomy receipt
одного варианта. Владелец `authorSymbolPayload` передаёт обеим проекциям один
`item.author` и предварительно сравнивает обе anatomy-записи с одним
`sourceContract.anatomy`. Дублирование возникало только при сериализации.

Генератор теперь выдаёт общие локальные константы для `author` и `anatomy`,
только когда JSON-записи соответствующего варианта совпадают. Outline и Filled
имеют отдельные константы даже при равных значениях. Отсутствующие и расходящиеся
записи сохраняются; исходные объекты не изменяются. Обе PURE-фабрики получают
прямые ссылки на receipts и собственные payload. Чтения полей другого payload,
runtime interner, разбора JSON и нового импортируемого модуля нет.

Документация esbuild и Rollup выше повторно проверена 2026-11-02. Общая
константа является самостоятельной удаляемой declaration. Общий объект
`source + capabilities` снова связал бы геометрию с возможностями; runtime
interner добавил бы поиск и новое состояние ради уже известных при сборке
равенств. Оба варианта отвергнуты. Build-only сериализация заменяет только
проверенные поля, остальные значения проходят прежний JSON serializer.

RED-контроль обнаружил две копии sentinel receipt; настоящие `time` и
`reload` после materialization имели равные, но отдельные author-объекты.
После изменения receipt появляется один раз и обе функции возвращают один
замороженный объект. Production compiler → module → consumer сохраняет
полные glyph/capability значения, исходные пути, SVG, default identity,
отдельный Filled и `AUTHOR_PARITY_REQUIRED`. Consumer только геометрии или
возможностей удаляет чужой payload; статический импорт удаляет receipts и
обе фабрики. Расхождение author receipt и отсутствие anatomy не подменяются.

Это сокращение записанного полного symbol module и его дублируемых объектов.
Экономия one-glyph bundle не предполагается: он уже удалял capabilities,
а сохранённые локальные ссылки могут иметь собственную небольшую цену.
Размеры exact packed artifacts и consumer bundles, а также скорость и память
требуют новых удалённых измерений. Бюджеты не изменены; source-контроль не
закрывает BENCH или публикацию.

## Точные строковые участки и граница сжатия

Удалённый consumer `75c67fc32a3f6b037df091f1383adfae754f21f8` сохранил
проверенное движение уведомлений, но package admission завершился FAIL:
`component` — 58469/9845 raw/gzip, `notifications` — 25338/4691,
`notifications-unread` — 31868/5573. Ceilings — 59341/9351, 23951/4165,
30360/5034 соответственно. SHA256 отчёта
`230cdd6d8429354c46bcbaf67a9e4dc6525ea052b0188e658fd015939e282b77`.
Уменьшение raw через общие receipts не удостоверяло улучшение gzip.

[RFC 1951 §2](https://www.rfc-editor.org/rfc/rfc1951) ограничивает обратные
ссылки DEFLATE окном 32 KiB. Перестановка одинаковых данных способна изменить
сжатие. Ограниченный опыт с четырьмя настоящими символами подтвердил точные
baseline bytes и SHA256, затем сравнил порядок данных, общие поддеревья и
структурные constructors. Универсальное объединение повторов и constructors
ухудшили gzip и отвергнуты. Выбор production layout сравнивает raw и
`fflate@0.8.3 gzipSync({ level: 9, mtime: 0 })`; размер одного модуля не
заменяет проверку consumer.

Новая проекция сохраняет статический SVG литералом. Сборка находит точные
UTF-16 участки авторского текста для `parts[].d`; runtime выполняет только
записанный `slice(start, end)`. Если часть отсутствует в статической строке,
она остаётся точным литералом. `d` и compiler SVG собираются из известных
строковых операндов только при materialization модуля. Search, parser,
контурные преобразования и восстановление анатомии в runtime не добавлены.
Проверка Unicode prefix и независимого Filled сохраняет точные строки и
порядок всех записей. Между author masters не вводится новая correspondence.

В esbuild `0.28.1` whitespace-minification удаляет PURE-аннотации. Это
наблюдение подтверждено малым контролем и настоящим статическим consumer;
такой формат не используется. Другой контроль обнаружил, что конкатенация
строк в аргументах PURE-фабрики сама может удерживать геометрию. Поэтому вся
source materialization заключена в отдельный PURE-вызов без аргументов.
Неиспользуемые source и slice declarations удаляются; статический consumer
содержит прежнее количество raw bytes и тот же SVG. Новые вызовы и
конкатенации при холодном импорте являются дополнительной работой, не
заявляются бесплатными или более быстрыми. Повторный `glyph()` возвращает
прежний frozen snapshot без новых строк и объектов.

Ограниченные source controls 2026-11-02: Windows x64, esbuild `0.28.1`,
fflate `0.8.3`, Brotli quality 11. Это сравнение точных строк, не BENCH.

| Символ | Module raw/gzip/Brotli до → после | Glyph-only raw/gzip/Brotli до → после |
|---|---|---|
| component | 58469/9845/5976 → 22042/8030/5982 | 47003/8780/6516 → 23059/8621/6535 |
| notifications | 25338/4691/3649 → 12657/4617/3690 | 20537/4788/3808 → 12425/4800/3857 |
| notifications-unread | 31868/5573/4287 → 16891/5536/4375 | 25857/5651/4469 → 16145/5696/4520 |
| time | 11227/2456/2058 → без изменений | 10988/3008/2554 → без изменений |

`time` сохраняет прежнее представление: альтернативный layout не улучшил
оба module-показателя. Lottie unread — 13138/4634 bytes/gzip, при ceilings
13309/4701; lowering не изменён. Module gzip уведомлений всё ещё превышает
ceiling на 452 и 502 B; glyph-only gzip и Brotli имеют показанное ухудшение.
Эти findings открыты. Source parity и tree shaking прошли, но shipping,
consumer nonregression, cold import/память и полная удалённая квалификация
не закрыты. Дальнейший срез должен устранить остаток у владельца проекции,
а не расширять budgets или менять meaning/proof data.

## Отвергнутый закрытый source skeleton

Следующий ограниченный опыт использовал только форму, которую уже выдаёт
compiler: `layers`, fill/currentColor, `morphGroup: null`, source provenance,
одинаковый source/artifact fingerprint и file части, равный file корня.
Сборка проверяла точный состав и порядок ключей. Все остальные значения,
включая author/anatomy, anchors, topology, роли и независимые варианты,
передавались явно; несовпадение сохраняло литерал. Материализация создавала
фиксированный root/part skeleton один раз. Ни JSON codec, ни path parser,
ни catalog, ни геометрическое выведение в runtime не добавлялись.

Сравнение использовало тот же `75c67fc` baseline, четыре настоящих compiler
payload и среду предыдущей таблицы. 44 ограниченных source-теста прошли,
включая JSON/key order, frozen snapshots и static tree shaking. Но маленький
runtime helper добавил измеряемые байты в настоящий glyph-only consumer:

| Символ | Module raw/gzip после skeleton | Glyph-only raw/gzip/Brotli после skeleton |
|---|---|---|
| component | 19304/7809 | 20697/8625/6597 |
| notifications | 11199/4465 | 11345/4856/3922 |
| notifications-unread | 14038/5315 | 13668/5675/4554 |
| time | 5791/2326 | 7674/3140/2705 |

Например, `time` уменьшил собственный модуль, но увеличил gzip/Brotli
consumer на 132/151 B. Оба уведомления всё ещё превышали неизменённые
module ceilings. Отдельный constructor только частей и literal-path packet
также не закрыли обе границы. Skeleton отвергнут; новый runtime файл,
package closure и увеличение budgets в продукт не внесены. Эти исходы
опровергают выбор по размеру одного generated module, но не доказывают
невозможность любого другого закрытого представления.

Независимое хранение compiler `source.svg` литералом и точные part-срезы
из него удалили удерживаемую glyph-only копию static wrapper. Получились
`component` 22523/8533/6511 и `notifications` 12083/4731/3791 raw/gzip/Brotli;
однако module gzip уведомлений стал 4708 B, а unread consumer Brotli
увеличился на 6 B. Этот layout также не принят. Аналогичное хранение
`source.d` не закрыло все границы. Экономия raw, gzip, Brotli, cold import
и allocations — разные свойства, требующие собственных наблюдений.

Малый контроль esbuild `0.28.1` уточнил ограничение minification:
`minifyIdentifiers` сохраняет PURE-комментарии, но `minifySyntax` способен
раскрыть PURE-IIFE в объект с вычисляемыми строками и связать static export
с неиспользуемым IR. Настоящий static consumer обнаружил этот дефект во всех
четырёх controls. Наличие PURE-комментария у внешней фабрики недостаточно.
Изменение не принято. Heavy BENCH, полный corpus build, remote qualification
и cold import/память этим локальным опытом не проверялись.

## Различающий контроль: только JS-литералы

На runtime `349532d62152cf4a0fe9fb1ce37745d19a40692a` отдельно проверена
одна build-only переменная: `compactDataLiteral` вместо JSON-literal данных.
Порядок declarations, ссылки на receipts, static SVG и обе PURE-фабрики
сохранены. Source paths, `d` и compiler SVG остаются литералами: runtime
slice, concatenation, skeleton, parser и новая dependency отсутствуют.
Выбор сравнивает исходный JSON layout и эту эквивалентную запись по прежним
raw/pinned gzip; layout с ухудшением одного из них сохраняет baseline.

| Символ | Module raw/gzip/Brotli до → после | Module admission |
|---|---|---|
| component | 58469/9845/5976 → 58041/9290/5925 | пределах 59341/9351 |
| notifications | 25338/4691/3649 → 24910/4661/3626 | FAIL 23951/4165 |
| notifications-unread | 31868/5573/4287 → 31296/5535/4262 | FAIL 30360/5034 |
| time | 11227/2456/2058 → 10979/2434/2034 | без ухудшения |

Во всех четырёх controls glyph-only, caps-only и static consumers совпали
с baseline по raw, gzip, Brotli **и SHA256**. В baseline и candidate
использованы одни compiler payload, runtime 349, entry и bundler.
Они не совпадают с более ранними glyph-only числами предыдущих таблиц:
runtime изменил диагностическую строку. Проверены все JSON/key order,
receipts, frozen snapshots, default identity и точные refusals — 44 теста.
Уменьшение raw `component` на 428 B изменило gzip на 555 B; это наблюдение
о конкретном encoder/layout, а не линейная модель стоимости свойств.

Контроль закрывает source-ceilings `component` без новой runtime-работы.
Уведомления остаются открыты: оба raw и gzip превышают свои ceilings.
Предыдущая span-проекция удалена из выбранного generator, поскольку её
дополнительные вызовы/строки не прошли полную consumer nonregression.
Новый полный corpus/package build, удалённый BENCH и shipping ещё нужны.

Перед этим проверены две закрытые source-capability проекции: отдельный
materializer каждого варианта и одна фабрика, создающая оба skeleton и
делегирующая freeze/parser владельцу `createCompiledCapabilities`.
Фиксировались только `modelState: null`, пустые supportedAxes/axes и точный
порядок ключей; motion/author/anatomy передавались полностью, несовпадение
оставалось литералом. Связь с source/geometry не добавлялась. Metafile
подтвердил 0 B private helper в glyph-only и static, и 282 B в caps-only
у второй фабрики. Однако её caps-only gzip/Brotli ухудшились:
`component` 941/816 → 992/857, `notifications` 1506/1285 → 1546/1342,
unread 1524/1299 → 1561/1369, `time` 936/809 → 988/854. Module ceilings
уведомлений также не закрылись. Обе фабрики отвергнуты и удалены;
private runtime и новые package dependencies не внесены.

Метод closed tuple подтверждён первичной типовой схемой
[Font Awesome 7.x IconDefinition](https://github.com/FortAwesome/Font-Awesome/blob/7.x/js-packages/%40fortawesome/fontawesome-common-types/index.d.ts),
но её зрелость не доказала преимущество skeleton в этом payload.
[esbuild PURE](https://esbuild.github.io/api/#pure) отдельно ограничивает
аннотацию самим вызовом; аргументы с побочными эффектами сохраняются. Эти первичные
источники повторно проверены 2026-11-02 и не заменяют измерения.

## JSON extension data и резервное представление

Изолированное ревью `f2582fa` воспроизвело потерю собственного ключа
`__proto__` в дополнительных JSON-данных. Компактный literal сохранял его,
но выбор по размеру мог вернуться к прежнему object literal, где этот ключ
имеет специальные JavaScript semantics. Это ошибка существовавшего baseline;
она опровергает общий claim JSON-равенства для принятых extension records.

Оба представления теперь проходят один build-only JSON encoder и записывают
такой ключ как computed property. Остальные JSON keys, values и порядок
сохраняются. Runtime helper, parser или новая регистрация не добавлены.
Настоящий generated module → consumer RED обнаружил потерю собственного ключа;
после исправления source/capability JSON и обычный Object.prototype сохранены.
38 ограниченных controls проверили специальный ключ, четыре текущих masters,
неизменные glyph/caps/static bundles и существующую авторскую вариацию.
Полная remote qualification остаётся отдельным гейтом.

## Точные notification bytes и граница повторов

На `8fbb434fb3c56b22703088c9e69b4f618bc2685f` узкий
`authoredSymbolPayloads(['notifications', 'notifications-unread'])` воспроизвёл
оба shipping модуля remote run `41403011004` побайтно. Authenticated report
`schema6-8fbb434-report.json` имеет SHA-256
`b63ab4be495f7a8b866035ae24b3c25ea33211c0c10be466163880e1413e4d91`.
Все три materialized runtime также совпали по digest. Числа ниже получены
на Node `24.15.0`, Windows, esbuild `0.28.1`, fflate `0.8.3`,
`gzipSync({ level: 9, mtime: 0 })`; они не являются новым browser или full pack run.

Повторяется `part.d` внутри `source.d` и `source.svg`. Два author/anatomy
receipts одного варианта уже разделены существующим build owner;
Outline/Filled остаются независимыми. Проверены два разных остатка:
exact path strings и равные scalar strings внутри разных metadata records.
Проверка [notification-payloads.mjs](../../scripts/bench/notification-payloads.mjs)
сохраняет все значения/ключи/порядок, функцию и snapshot identity,
frozen trees, getter receiver и прежние отказы. Материализованные native
модули и пять selective consumers используют один закреплённый compiler вход.

| Представление | notifications raw/gzip B | unread raw/gzip B | Отказ |
|---|---:|---:|---|
| Shipping baseline | 24910/4661 | 31296/5535 | Ceilings 23951/4165 и 30360/5034 превышены |
| Exact path constants, PURE source IIFE, независимый static literal | 16660/4584 | 21576/5463 | Gzip ceiling превышен на 419/429 B |
| Те же paths также в static string expression | 12504/4519 | 16622/5395 | Ухудшились outline/filled consumers |
| Exact scalar references без объединения objects | 23755/4764 | 29329/5672 | Ухудшились glyph/caps/both consumers |
| Path и scalar references вместе | 15505/4689 | 19605/5602 | Ухудшился caps consumer |

Path-only уменьшил настоящий glyph consumer с `20965/4937` до
`12459/4812` B и unread с `26285/5802` до `16101/5649` B.
Caps и оба static consumers по raw/gzip не ухудшились. Это полезный
контрпример к выводу «повторы неустранимы без нового runtime adapter»,
и этот срез внесён в общий build owner `sourceRecords`. Это не закрытие
shipping gate. Scalar references уменьшили raw, сохранили
все объекты независимыми, однако увеличили compressed consumer bytes;
равенство поддерева само по себе не доказывает пользу его разделения.

Deliberate sabotage удалил PURE только с source materializer. Caps consumer
уведомлений вырос с `4531/1511` до `12176/4421` B, unread — с `4668/1529`
до `15946/5257` B; static тоже удержал геометрию. Это согласуется с
[ответом сопровождающего esbuild #3392](https://github.com/evanw/esbuild/issues/3392)
и [границей PURE](https://esbuild.github.io/api/#pure): внешняя аннотация
фабрики не устраняет потенциальные эффекты её заранее вычисленных аргументов.
Идентичность объектов ограничивает объединение object literals; exact string
references сохраняют scalar values по
[ECMAScript PropertyDefinitionEvaluation](https://tc39.es/ecma262/multipage/ecmascript-language-expressions.html#sec-object-initializer-runtime-semantics-propertydefinitionevaluation).
Источники проверены 2026-11-02; применимость esbuild проверена на закреплённой версии.

[Полные измерения](notification-payloads-20261102.json) содержат digests,
retained module graph, native controls и каждый consumer. [RED на точном
исходном emitter](notification-payload-red-20261102.txt) обнаружил четыре
копии `part.d` против требуемых двух: одну source и одну независимую static.
После исправления прошли 44 tests, включая exact данные/extension keys,
равные/расходящиеся receipts, варианты и static tree shaking. `pnpm exec`
потребовал переустановку из-за junction
node_modules в изолированном worktree, поэтому тот же pinned Vitest `4.1.12`
запущен через его официальный Node entrypoint. Полная suite не запускалась.

Source-only fixture раньше требовал одинаковый SHA всего minified consumer.
Он теперь проверяет exact публичные данные и raw/gzip без роста; другое
представление вправе менять private minifier names. Например, caps `i → t`
в source-only `console.log` entry менял gzip на 1 B, хотя actual shipping
closure сохранял caps `1511/1529` B. Поэтому caps gzip guard перенесён в
настоящий трёхмодульный runtime closure, с неизменным baseline. Во вторичном
source-only `time` control Brotli вырос на 8 B при уменьшении raw/gzip;
Brotli nonregression и parse/allocations этим срезом не заявляются.

Изолированное ревью source digest
`80d08832720b5058bfe97e39cb0667ba255edc57177945ef10e0e4a8ac637b76`
прошло: 1008 строковых случаев, 644 проверки четырёх layouts и восемь
tree-shaking controls подтвердили exact JSON strings и границу materializer.
Отдельная ось последствий второго порядка не нашла доказанного пропущенного
простого представления в проверенных path/scalar/skeleton семействах.

В product emitter принят только path-only layout, сравниваемый прежним
`compactGeneratedModule` по raw/pinned gzip. Целиком отмеченный PURE source
materializer не удерживает геометрию в caps/static. Generated public static
строки остаются прежними независимыми литералами. Нет нового decoder,
адаптера или runtime dependency. Ceilings не повышены: module gzip остаётся
RED на 419/429 B. Отрицательный результат для остальных представлений
не доказывает невозможность любого сильнейшего build-only решения. Browser,
full corpus/package, timing/allocations и удалённая qualification остаются
отдельными открытыми проверками исходной задачи.

Воспроизведение из этого checkout:

```powershell
node scripts/bench/notification-payloads.mjs `
  E:/AgentWork/annulus-consumer-evidence-20261102/schema6-8fbb434-report.json `
  docs/research/notification-payloads-20261102.json
```
