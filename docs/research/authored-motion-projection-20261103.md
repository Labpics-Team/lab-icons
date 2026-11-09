# Авторское движение без полного IR в потребителе

Срез основан на `2bf18f9903511d5b0ed703118e7134188253571a`. Предыдущая попытка
добавить полный Timer motion в default symbol превышала неизменный gzip ceiling.
Отдельный rotation codec уменьшал сам module, но увеличивал полную native и
bundled загрузку. Эти отрицательные измерения сохранены в timer checkout;
новый срез не объявляет их результатами своего артефакта.

Одна аннотация `semantics/author-anatomy.json` теперь допускает `scope: motion`.
Весь документ по-прежнему проверяется; обычный compiler projection сохраняет
прежний source контракт, а motion projection явно принимает дополнительную
анатомию. Так static и source consumers не платят за новый жест. Reload и
Refresh используют существующие аннотации, без второй таблицы параметров.

Target `gestures/<symbol>` содержит самостоятельные PURE roots для SVG,
effect operands и capabilities. В runtime нет общего IR каталога, geometry
compiler, path parser или scheduler. Авторские path, правила заливки, порядок
и master receipts проверяются при сборке. Общая `projectRotationEffect`
используется прежним `compileSymbolEffect` и новым target runtime; формула
вращения, фазовая семантика и reduced motion не дублируются. Публичные
интерфейсы motion сохраняют собственные объявления полей: их перенос в base
ранее нарушил отрицательные interface-augmentation гарантии.

`renderMotionSvg(variant?)` возвращает подготовленный addressable SVG.
`compileMotionEffect(gesture, { duration, from?, to?, reducedMotion?, variant? })`
возвращает существующий SymbolEffect v1 или явный отказ. `motionCapabilities`
отдельно предоставляет смысл жеста и происхождение. Исполнитель связывает
`data-part` с публичным Lab Motion `animate`; Lab Icons не получает его часы.
Прерывание сохраняет видимый экземпляр, новый эффект задаёт следующую фазу.
Для прямого keyframe consumer `from` обязан соответствовать видимой фазе.

Timer имеет только Outline target: исходный `timer-hand` вращается вокруг
объявленного `[0.5, 0.5]`, `timer-dial` сохраняется. Это один оборот за
интервал, не абсолютное показание времени. Filled compound и fused Time не
получают выдуманной независимой стрелки. Геометрический pivot не был
перемещён в центр диагностически fitted лопасти. Независимая визуальная
приёмка rest, ±45° и половины оборота остаётся открытой; контакт стрелки
с неподвижной верхней меткой известен. Canvas-clearance не заменяет эту приёмку.

При первоначальной подготовке выполнены syntax checks и ограниченная структурная release
проекция. Она сначала подтвердила точное равенство прежнего contract через
существующий compiler output Notifications/Notifications Unread, затем добавила
три motion exports и их замкнутые runtime/types. Численные package ceilings
не увеличены. Первая попытка Vitest не запустила тесты: pnpm остановил команду
с `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`; shared dependency junction удалён без
изменения его target. Full build, type/pack, реальные byte closures и browser
интерruption должны проверяться в чистом self-hosted окружении.

Regression проверяет прежние source contracts и module bytes, явные углы,
reverse/reduced-motion интервалы, настоящие authored paths, подмену source,
anchors и parts, честные variant/gesture/request отказы, independent PURE roots
и native consumer import closure. До выполнения этих checks срез не считается
готовым к выпуску.

Основания выбора проверены по первичным источникам 2026-11-03:

- [CSS Transforms §6](https://www.w3.org/TR/css-transforms-1/#transform-box):
  `view-box` использует ближайший SVG viewport; проценты origin относятся
  к объявленному viewBox, а не bbox каждой path.
- [esbuild tree shaking](https://esbuild.github.io/api/#tree-shaking):
  PURE call не делает его arguments автоматически безопасными; три корня
  используют literal operands, и retained graph проверяет настоящий consumer.
- [Node subpath exports](https://nodejs.org/api/packages.html#subpath-exports):
  opt-in — отдельный заявленный entrypoint с настоящим runtime и declarations.

Новый экспорт не гарантирует минимальную стоимость сам по себе. Решение
подтвердит или опровергнет сравнение полных native closures и bundled consumers
при неизменной static поставке, затем consumer render и interruption.

Последующая source-проверка `4e0a2f3` выполнила 20 focused tests: все прошли,
без skipped. Независимые source и public-type reviews прошли. Отдельное
request review обнаружило, что `from:null` и `to:null` выбирали defaults.
В `8e2b96e` общий parser задаёт default только для `undefined`; native RED/GREEN
и свежий isolated review проверили точные отказы обоих API, reverse, reduced
motion и прежние defaults. Это исправление не меняет рисунок и не подтверждает
новые installed artifacts.

Lab UI `ab2206f` закреплён на Icons `8e2b96e`: 118 узких preparation/harness/
public-entrypoint проверок прошли без skipped, независимый source-pair review
проверил пять raw masters и совместимость pin. Реальные package/browser/types/
bytes проверены в [self-hosted consumer](https://github.com/Labpics-Team/labui/actions/runs/41540698903):
прогон завершился FAILURE. Зафиксированы 239 browser records, четыре timer-позы
обычного режима и полный снимок первого journey. Это допускает отдельный
оптический просмотр сохранённых изображений, но не закрывает browser acceptance.
Физический motion entry измерен как 14257 / 3942 B raw/gzip при неизменном
gzip ceiling 3817 B. Общий browser deadline 120000 ms исчерпан; по исходному
порядку следующая незавершённая область — reduced playback-circle journey,
а точная причина пока не установлена. Ранее предположенная проблема timer
transform/download опровергнута завершённым полным снимком первого режима.

В source `e3474a3` приняты подготовленные ширины `gestures/mic` и
`gestures/mic-circle`, Observatory использует настоящие rotation exports.
Стандартная minify с keepNames для двух физических runtime дала в
[удалённом CI](https://github.com/Labpics-Team/lab-icons/actions/runs/41547617417)
capsule 9186 / 4623 B и motion 11411 / 3776 B raw/gzip, ниже прежних ceilings.
CI остаётся FAILURE: factual baselines ещё требуют обновления по измерению,
14 новых release files не покрыты package ratchet, а author-consumer oracle
остановился на compound Filled `mic-circle`, смешав semantic contours и
физические SVG paths. Runtime ради этого oracle не изменён.

Lab UI `80d6236` закрепляет exact producer `e3474a3`, использует public
`@labpics/motion@0.5.0` value и проверяет подготовленную ширину, interruption,
новую цель, pause/seek/stop/finish, reduced motion и disposal. Три lifecycle
дефекта закрыты отдельными RED/GREEN: stopped форма при смене preference,
rejected completion при очистке и поздняя renderer readiness. 123 узких
integration checks и 14 readiness checks прошли без skipped; независимое
review относится к исходникам. Новые PNG, installed bytes и поведение ждут
[штатного consumer](https://github.com/Labpics-Team/labui/actions/runs/41548515452).
Merge и publication не выполнены.
