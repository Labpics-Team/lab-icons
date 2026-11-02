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

В этом checkout выполнены syntax checks и ограниченная структурная release
проекция. Она сначала подтвердила точное равенство прежнего contract через
существующий compiler output Notifications/Notifications Unread, затем добавила
три motion exports и их замкнутые runtime/types. Численные package ceilings
не увеличены. Focused Vitest не запускался: pnpm остановил команду до тестов
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
