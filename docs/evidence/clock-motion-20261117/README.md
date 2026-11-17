# Time и History · 17 ноября 2026

`symbols/time` и `symbols/history` получили общий web/Compose жест `advance`.
`to` задаёт часы от авторской позы; minute вращается на 360°, hour — на 30° за час.
Без `to` прибавляется час к текущей фазе. Проверены отрицательные значения,
прерывание, возвращение исходной позы через selection и освобождение controls.
`renderIcon` продолжает использовать исходный статический путь.

Оптика 660 принятых вариантов не менялась. Контуры стрелок ссылаются на исходные
координаты и коэффициенты. Скрытые окончания — выпуклые комбинации локальных
треугольников исходного joint; общая опора переносится через source contacts.
При смене осей проекция готовится заново, кадр меняет transforms. Цвет применяется
один раз к объединённому слою, включая полупрозрачный tint и отрицательные части.

## Проверки

- `pnpm build:ir`, `pnpm exec tsc --noEmit` — пройдены.
- 83 теста в семи адресных JS/TS-файлах: optical-clock, negative-draw,
  semantic-motion-phase, semantic-symbol, motion-execution, render-icon,
  motion-public-types — пройдены.
- `optical-clock.test.js`: 25 пар weight/opsz × четыре варианта. Независимые
  Paper boolean-операции не обнаружили разницы между объединением стрелок и
  исходным путём; ошибка площади от округления не больше `4.7e-14`.
  Общая опора находится внутри обеих стрелок с расстоянием до контура > 0.25.
  Эти 100 наблюдений не являются самостоятельным доказательством всей
  непрерывной области интерполяции.
- `node scripts/verify-clock-motion.mjs`: **216 сравнений** в настоящем headless
  Chrome: четыре варианта, девять опор, 0/12 часов, три фона. За пределами
  однопиксельной границы расхождений нет; максимальная средняя разница
  premultiplied channel — **0.304918130446623 / 255**. Публичный Motion,
  единицы времени, обратный ход, прерывание, +1 час, reset/dispose: **live = 0**.
- `node scripts/verify-negative-draw.mjs`: 54 сравнения прежней отрицательной
  композиции — пройдены; максимальная средняя разница **0.4354123051130172 / 255**.
- `node scripts/verify-semantic-motion.mjs` — пройден, **live = 0**.
- `native/compose/gradlew desktopTest`: **15 тестов**. Включает 36 сравнений
  статического и динамического clock paint на девяти опорах с alpha 0.45,
  обратный ход, прерывание и продолжение. Новый decoder читает v1…v4.
- Отдельный Compose consumer установил **локальный** артефакт Icons
  `0.4.0-semantic.5` и публичный `pics.lab:motion-compose:0.1.0`.
  `--headless` отрисовал 48 контроллеров через `ImageComposeScene`, проверил
  controls и закрыл сцену. Видимое окно не создавалось, рабочий стол не читался.
  Самостоятельный ранее экспортированный PlusCircle v3 скомпилирован новым
  decoder. Это проверка артефакта, не публичная публикация Icons.

[Web](web.png), [Compose](compose.png) и [receipt Chrome](receipt.json).
Оба изображения просмотрены: Static рядом с 0/¼/½/1 h, обе пары начертаний,
300/16, 400/24, 600/48. Web дополнительно показывает светлую и тёмную темы.

## Цена относительно 191f9ea

После сборки; gzip — `fflate@0.8.3`, level 9, mtime 0. Числа — размер файлов,
не обещание скорости. Лимиты пакета этим срезом не расширены.

| Файл | Было bytes / gzip | Стало bytes / gzip |
| --- | ---: | ---: |
| `dist/motion/index.js` | 26758 / 9463 | 27542 / 9782 |
| `dist/render/index.d.ts` | 2506 / 894 | 3082 / 1049 |
| `dist/symbols/time.js` | 35419 / 10812 | 41112 / 13524 |
| `dist/symbols/history.js` | 72933 / 23391 | 79962 / 26556 |
| `dist/symbols/checkmark-circle.js` | 37550 / 13051 | 37550 / 13051 |

## Решение и оставшаяся работа

Общий affine-перенос скрытых окончаний через три joint contacts давал небольшой
лишний фрагмент, особенно у history/outline (`~2.08e-5` площади). Локальные
source-side треугольники устранили его без изменения source и оптических masters.
Старый solver, принимающий joint только в 400/24, не ослаблялся.

Дальше по r1: calendar-number с явными Date/IANA, общие SVG/native/Lottie экспорты,
каталог, независимое ревью и выпуск 0.4.0. Этот срез их не завершает.

Источники: [Apple SF Symbols Draw](https://developer.apple.com/videos/play/wwdc2025/337/),
[SVG compound paths](https://www.w3.org/TR/SVG/paths.html),
[Compose BlendMode](https://developer.android.com/reference/kotlin/androidx/compose/ui/graphics/BlendMode),
[ImageComposeScene и offscreen rendering](https://github.com/JetBrains/compose-multiplatform/issues/1395).
