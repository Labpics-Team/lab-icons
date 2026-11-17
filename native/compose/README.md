# Lab Icons для Compose

Kotlin Multiplatform renderer получает тот же SymbolData, что и web: команды
M/L/C/Z, координаты, sparse-поправки осей, fill-rule и селекторы частей.
Каждое семейство подключается отдельно. Числовой пакет декодируется один раз;
SVG parser, браузер и каталог для отдельного Icon не нужны.

Состояния подключаются отдельно через `pics.lab.icons.states.*States`.
Поэтому `symbols.volumeHigh` содержит только свой рисунок и жесты, а
`states.volumeStates` явно добавляет все состояния громкости.

```kotlin
import pics.lab.icons.rememberIconMotion
import pics.lab.icons.states.microphoneStates

val motion = rememberIconMotion(microphoneStates)
Icon(microphoneStates, tint = labelColor, motion = motion)
// В обработчике кнопки:
motion.setState("off")
```

Начальный вариант состояния доступен без эффекта после первого кадра:
`Icon(microphoneStates, labelColor, state = "off")` для статики либо
`rememberIconMotion(microphoneStates, initialState = "off")` для движения.
Начертание по-прежнему задаёт `variant`; `selected`/`unselected` выбирают Filled/Outline.

`rememberIconMotion` освобождает controller при удалении из композиции.
`effect("cycle")`, `effect("ring")`, `effect("level", to = .5f)` и
`effect("draw")` используют объявленные части текущего символа. Прерывание
подхватывает видимые значения. `reducedMotion = true` немедленно завершает
эффект. Draw обрезает штрих направляющей исходной залитой формой; PathMeasure
создаётся один раз. Кадр не ищет части по строкам и не разбирает SVG.
Отрицательные части Filled используют `DstOut` внутри собственного `saveLayer`:
фон потребителя сохраняется. Цвет применяется к объединённому слою через `SrcIn`,
поэтому полупрозрачный tint не затемняет пересечения частей.
Направляющая постепенно вырезает отверстие;
положительные части, PathMeasure, stroke и границы слоя готовятся вне кадра.
Части движения выбирают целые контуры исходного числового пути по индексам.
В неподвижной позе один символ разделяет sampled buffer между частями этого пути.
Переход сохраняет координатные snapshots только изменившихся частей; Canvas
переиспользует эти точки и свой Path, не готовит второй оптический buffer.
Числовой формат 4 добавляет ссылки на исходные точки для контуров и общей опоры,
а также параметр эффекта в часах. Decoder читает форматы 1…5, включая ранний
формат 3 с отдельными motion paths.
Формат 5 добавляет оптический stroke с круглыми концами/соединениями, оптическое
смещение части и календарный пакет: десять общих цифр, интервал и ссылки оболочки.
Открытые пути разрешены только для stroke. Старые экспорты сохраняют прежние
значения по умолчанию; новый отдельный Kotlin-экспорт требует decoder формата 5.

Явный `to` продолжает текущую фазу либо исходный `rest` при первом вызове.
Без `to` новый или завершённый жест проигрывается с начала, а прерванный
продолжается. Поэтому `effect("draw", to = .5f)` плавно скрывает половину
полного знака; `effect("draw")` рисует его заново при каждом полном повторе.

Для `symbols.time` и `symbols.history` эффект `advance` принимает часы от авторской
позы: минутная стрелка делает 360°, часовая — 30° за час. Отрицательные значения
разрешены; без `to` прибавляется час к текущей фазе. Прерывание продолжает видимую
позу, `set`/`setState` возвращает исходный рисунок. Вызов `advance()` во время
возврата также отсчитывает час от видимого угла. Стрелки и оболочка окрашиваются
одним слоем, поэтому их пересечение не затемняет tint. Системных часов у символа нет.

```kotlin
import pics.lab.icons.symbols.time

val clock = rememberIconMotion(time)
Icon(time, tint = labelColor, motion = clock)
// В обработчике кнопки:
clock.effect("advance", to = 2f, durationMillis = 1000)
clock.effect("advance") // Ещё один час от текущей фазы.
```

`symbols.calendarNumber` принимает явный `kotlin.time.Instant` и именованную
IANA-зону. Дата и зона передаются вместе; часы и обновление даты принадлежат
приложению. Без даты сохраняется авторский рисунок. Число вычисляется один раз
через `kotlinx-datetime:0.7.1`; преобразование не зависит от локали и системной зоны.
Дни используют общие оптические контуры и интервал, без шрифта или SVG parser.

```kotlin
import kotlin.time.Instant
import pics.lab.icons.symbols.calendarNumber

val date = Instant.parse("2024-03-01T00:30:00Z")
Icon(calendarNumber, labelColor, date = date, timeZone = "America/Los_Angeles") // 29
val calendar = rememberIconMotion(calendarNumber, initialDate = date, initialTimeZone = "UTC")
Icon(calendarNumber, labelColor, motion = calendar)
// В обработчике изменения данных:
calendar.setDate(nextDate, "Asia/Tokyo", durationMillis = 180)
```

`initialDate`/`initialTimeZone` читаются при создании controller; рекомпозиция
не заменяет его дату, выбранный вариант или текущую позу. После создания дата
меняется через `setDate`. Одновременные `motion` и `date`/`timeZone` у `Icon`
отвергаются как два источника состояния. Смена даты сохраняет текущий state/variant,
оболочку и видимые значения при прерывании. Static и motion рисует один Canvas-путь.
Прозрачность общего слоя — максимум видимости его частей; покрытие каждой части
делится на этот максимум, а tint применяется один раз после объединения/вычитания.

## Оптические переходы

```kotlin
val icon = rememberIconMotion(time, initialWeight = 300f, initialOpsz = 16f)
Icon(time, labelColor, size = 48.dp, motion = icon)
val change = icon.setOptics(weight = 600f, opsz = 48f, durationMillis = 240)
// Следующее изменение продолжает видимую форму:
icon.setOptics(weight = 450f, opsz = 32f)
icon.setOptics(opsz = null) // снова следовать фактическому логическому размеру
```

`initialState`/`initialWeight`/`initialOpsz` читаются при создании controller. С ним `Icon`
получает оптику от controller; одновременные `weight`/`opsz` у `Icon` отвергаются.
У статического `Icon` эти свойства остаются обычными входами. Миграция:
`Icon(..., weight = w, opsz = o, motion = m)` заменяется начальной настройкой
`rememberIconMotion(..., initialWeight = w, initialOpsz = o)` и `Icon(..., motion = m)`.

Переход линейно смешивает готовые координаты конечных поз, опору вращения,
смещение и толщину открытого штриха. Он не пересчитывает геометрию из
промежуточных значений weight/opsz. Прерывание сохраняет последний видимый
рисунок; нулевой кадр устанавливается до запуска часов. Старый `finish()`
не восстанавливает прежний target. `setOptics` сохраняет state/date/variant
и, как web `set`, возвращает жест к исходной позе. Новый жест продолжает
оставшуюся оптическую часть перехода.

При `opsz = null` размер берётся из фактических layout constraints и делится
на плотность ровно один раз. Ограничение Icon до 32 dp даёт opsz 32 и при
density 1, и при density 2, даже если запрошено 96 dp. Смена layout во время
перехода продолжает его с видимой формы к новой оптической цели; отдельные
часы для layout не создаются. Изменение tint не пересчитывает геометрию.

Часы и controls принадлежат публичному
`pics.lab:motion-compose:0.1.0` из Maven repository
`https://raw.githubusercontent.com/Labpics-Team/lab-motion/maven-compose-v0.1.0/`.
В покое controller не запрашивает кадры; буферы и handles повторно используются.

```kotlin
import pics.lab.icons.Icon
import pics.lab.icons.IconVariant
import pics.lab.icons.symbols.plusCircle

Icon(plusCircle, tint = labelColor, size = 20.dp, weight = 500f)
Icon(plusCircle, tint = labelColor, variant = IconVariant.Filled, opsz = 24f)
```

`size` задаётся после пользовательского масштаба в логических единицах. Плотность
экрана применяется Compose при рисовании. `opsz = null` следует фактическому
логическому размеру внутри layout constraints; явный opsz от него независим.
Диапазоны находятся в `symbol.axes`, выход за них отвергается.

Цвет передаёт вызывающий компонент. Декоративный Icon не добавляет семантику;
имя действия принадлежит кнопке. Для самостоятельного изображения можно передать
`contentDescription`. Неподвижный Icon не создаёт coroutine или frame-clock waiter.
При изменении осей каждый экземпляр переиспользует числовые буферы и Path;
изменение tint не пересчитывает геометрию.

Float-проекция проверяется против независимых samples web-рендера. Допуск проверки
координат — 1/2048 единицы viewBox, то есть менее 1/1024 логического пикселя при
размере 48. Исходный SVG продолжает храниться отдельно без этой проекции.

## Проверка разработки

Обычная генерация требует принятия всех оптических masters. Явный режим preview
позволяет локально проверять незавершённую работу; он не означает готовность выпуска.

```sh
./gradlew desktopTest
./gradlew publishDesktopPublicationToDistributionRepository publishKotlinMultiplatformPublicationToDistributionRepository
node ../../scripts/export-native-symbols.mjs --symbol plus-circle --package pics.lab.icons.consumer.generated --output consumer/build/exported
./gradlew -p consumer run --args=--headless -PiconsVersion=<package-version> -PiconsRepository=<absolute-build-repository> -PexportedIconSource=<absolute-consumer-build-exported>
```

На Windows используется `gradlew.bat`. Consumer — отдельная Gradle-сборка,
которая получает Maven-артефакт. `--headless` использует `ImageComposeScene`,
проверяет 52 контроллера часов, прерывание, обратный ход, продолжение и disposal;
сохраняет `consumer/build/native-icons-clock-headless.png` и закрывает сцену.
Календарная сцена дополнительно проверяет 72 пары static/motion, сохранение
controller/date/selection при рекомпозиции, прерывание и disposal; изображение
сохраняется в `consumer/build/native-icons-calendar-headless.png`.
Оптическая сцена проверяет оба начертания time/calendar-number/checkmark-circle/
volume-high: первый кадр, середину, прерывание, поздний `finish`, точное совпадение
конечной позы со статическим Icon и автоматическую оптику под constraints/DPR.
Изображение сохраняется в `consumer/build/native-icons-optical-headless.png`.
Он не открывает окно и не читает рабочий стол. Это обычный локальный путь проверки.
Оконный `--smoke` сохраняет `consumer/build/native-icons-consumer.png` и запускается
только в изолированной среде. На рабочем компьютере используются `desktopTest`
и headless-проверки: без видимых окон и звуков.
Plus-circle компилируется из отдельно экспортированного Kotlin-файла в пакете
consumer. Это проверяет импорт готового семейства и доставку самостоятельного экспорта.
Consumer также проверяет прерывание Motion, состояния, draw, reduced motion и
освобождение активных controls. Семантические части и эффекты входят в тот же
числовой экспорт; каждая активная часть готовит только собственный Path.
`NegativeDrawTest` сравнивает настоящий Compose paint со статическим путём
на всех девяти опорах, с полупрозрачным tint и тремя фонами. Проверяются также
последний участок направляющей, повтор, обратный ход и сохранение фона.
`ClockMotionTest` сравнивает статический и динамический рисунок на девяти опорах
с полупрозрачным tint и проверяет единицы времени и промежуточные позы.
900 положений дополнительно проверяют отсутствие повторного окрашивания
пересечений стрелок с оболочкой; отдельный сценарий продолжает прерванный reset.
Календарные проверки покрывают UTC/Los Angeles/Tokyo, midnight/leap/DST,
отказ неизвестной или безымянной offset-зоне, дни 1/8/10/11/28/31 на девяти опорах,
однократный tint, сохранение фона, порядок частей и чтение binary 1…4.
110 независимых web-samples проверяют координаты, толщину и интервал цифр.
Последний [протокол native calendar с изображением](evidence/calendar-20261117.md)
содержит команды повторения и границы выполненной проверки.

Основания: [Compose custom drawing](https://developer.android.com/develop/ui/compose/graphics/draw/overview),
[Kotlin Base64](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.io.encoding/-base64/),
[KMP publication](https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html).
Дата: [kotlinx-datetime 0.7.1](https://github.com/Kotlin/kotlinx-datetime/tree/v0.7.1).
