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
фон потребителя сохраняется. Направляющая постепенно вырезает отверстие;
положительные части, PathMeasure, stroke и границы слоя готовятся вне кадра.
Статический путь и optional-разложение для движения хранятся отдельно.
Числовой формат 3 добавляет разложение и вычитающие слои; decoder продолжает
читать ранее экспортированные форматы 1 и 2.

Явный `to` продолжает текущую фазу либо исходный `rest` при первом вызове.
Без `to` новый или завершённый жест проигрывается с начала, а прерванный
продолжается. Поэтому `effect("draw", to = .5f)` плавно скрывает половину
полного знака; `effect("draw")` рисует его заново при каждом полном повторе.

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
./gradlew -p consumer run --args=--smoke -PiconsVersion=<package-version> -PiconsRepository=<absolute-build-repository> -PexportedIconSource=<absolute-consumer-build-exported>
```

На Windows используется `gradlew.bat`. Consumer — отдельная Gradle-сборка,
которая получает Maven-артефакт, открывает настоящее окно, меняет размер/вес/вариант,
сохраняет `consumer/build/native-icons-consumer.png` и закрывается.
Plus-circle компилируется из отдельно экспортированного Kotlin-файла в пакете
consumer. Это проверяет импорт готового семейства и доставку самостоятельного экспорта.
Consumer также проверяет прерывание Motion, состояния, draw, reduced motion и
освобождение активных controls. Семантические части и эффекты входят в тот же
числовой экспорт; каждая активная часть готовит только собственный Path.
`NegativeDrawTest` сравнивает настоящий Compose paint со статическим путём
на всех девяти опорах, с полупрозрачным tint и тремя фонами. Проверяются также
последний участок направляющей, повтор, обратный ход и сохранение фона.

Основания: [Compose custom drawing](https://developer.android.com/develop/ui/compose/graphics/draw/overview),
[Kotlin Base64](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin.io.encoding/-base64/),
[KMP publication](https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html).
