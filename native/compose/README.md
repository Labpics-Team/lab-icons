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
Один символ разделяет sampled buffer между частями этого пути: координаты и
коэффициенты не дублируются ни в экспорте, ни в подготовленных буферах.
Числовой формат 4 добавляет ссылки на исходные точки для контуров и общей опоры,
а также параметр эффекта в часах. Decoder читает форматы 1…4, включая ранний
формат 3 с отдельными motion paths.

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
./gradlew desktopTest -PpreviewSymbols=true
./gradlew publishDesktopPublicationToDistributionRepository publishKotlinMultiplatformPublicationToDistributionRepository -PpreviewSymbols=true
node ../../scripts/export-native-symbols.mjs --preview --symbol plus-circle --package pics.lab.icons.consumer.generated --output consumer/build/exported
./gradlew -p consumer run --args=--headless -PiconsVersion=<package-version> -PiconsRepository=<absolute-build-repository> -PexportedIconSource=<absolute-consumer-build-exported>
```

На Windows используется `gradlew.bat`. Consumer — отдельная Gradle-сборка,
которая получает Maven-артефакт. `--headless` использует `ImageComposeScene`,
проверяет 52 контроллера часов, прерывание, обратный ход, продолжение и disposal;
сохраняет `consumer/build/native-icons-clock-headless.png` и закрывает сцену.
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

Основания: [Compose custom drawing](https://developer.android.com/develop/ui/compose/graphics/draw/overview),
[Kotlin Base64](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.io.encoding/-base64/),
[KMP publication](https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html).
