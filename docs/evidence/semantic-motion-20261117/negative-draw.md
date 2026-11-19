# Filled draw: изолированное вычитание

17 ноября 2026. Срез продолжает `c91dc75` в PR #122. Геометрия принятых masters
не изменялась. Добавлена открытая draw-направляющая для отрицательной галочки
`checkmark-circle/filled` и общий перенос compound contours в отдельные части.

Web использует SVG luminance mask, Compose — DstOut внутри saveLayer. Маска
принадлежит композиции конкретного исходного пути: несовпадающие вычитающие
рисунки не делят общий слой. Opacity при crossfade применяется к положительному
рисунку; отрицательная часть сохраняет геометрию отверстия. Static data остаются
исходными; части выбирают целые контуры по `pathIndex`/`contourIndices`.
Координаты и sparse terms представлены один раз.
Вход `/symbols/<id>` содержит собственный символ; семьи подключаются через `/states/*`.

Native binary v3 добавляет layer/negative. Новые экспорты ссылаются на общие
static paths; decoder также сохраняет чтение ранних v3 motion paths.
Регрессия читает реальные fixtures, произведённые encoder v1
(`4dee2c0`) и v2 (`c91dc75`). Path, PathMeasure, Stroke, Rect и слой готовятся
до кадровых обновлений. Geometry вне движения не разбирается заново.

После независимого ревью исправлены две причины:

- `selected → draw(.25) → unselected(.5) → selected.finish()` сохранял
  частичную маску. Web сбрасывал фазу, но возвращал только alpha. Теперь
  возвращаются все каналы исходной позы, без скачка; новый эффект забирает
  только свои каналы у продолжающейся смены состояния. Native также
  возвращает rotation. Браузер и native проверяют полный конечный рисунок.
- `semantics.paths` дублировал compound geometry. После замены индексами
  checkmark-circle уменьшился **54 509 → 37 550 B**, status —
  **225 575 → 208 616 B**. Оба на **360 B** больше базового c91dc75:
  направляющая и ссылки частей. Motion: **26 758 B**; render: **3 748 B**;
  render declarations: **2 506 B**. Это сырые размеры production dist;
  baselines на этом этапе не обновлялись. Внутри одного native Icon части
  пути также используют общий sampled buffer.

Проверено после исправлений:

- `pnpm exec tsc --noEmit` и production `pnpm build:ir`.
- 81 адресный JS/TS test: оптические коэффициенты на 25 комбинациях axes,
  семантические фазы, импорт, controls, render и public types.
- `node scripts/verify-negative-draw.mjs`: 54 растровых сравнения — девять опор,
  прозрачный/белый/тёмный фон, tint alpha .55, progress .99999/1. Ни одного
  различия вне однопиксельной границы. Максимальная средняя разница
  premultiplied 8-bit канала: **0.43584 / 255**. Chrome выбирает разное
  сглаживание для выпуклого пути и compound fill; тест не объявляет их
  побитово равными. Проверены draw 0/.5/1, повтор, реверс, прерванная смена
  Outline/Filled и dispose.
  Сценарий ревью проверяет отсутствие скачка при обеих сменах, остаток маски
  .75 → .375 → 0 и побитовое равенство исходной полной позе после возврата.
- `node scripts/verify-semantic-motion.mjs`: все ранее принятые midframes PASS,
  **live = 0** после stop/finish/dispose.
- `./gradlew.bat desktopTest`: **13 tests PASS**, реальные Canvas raster comparisons, старые
  binary fixtures, фазы и disposal. Skia runtime включён только в desktop tests.
- До этих исправлений отдельный Compose consumer установлен из локального Maven-артефакта
  **Icons 0.4.0-semantic.4**, с публичным **Motion 0.1.0** и отдельно
  экспортированным PlusCircle. Окно отрисовано, controls прерваны и завершены,
  сделан снимок, приложение закрыто. Это локальная проверка, не публичный выпуск.
  Она предшествовала уточнению пользователя о запрете видимых окон и звуков на
  рабочем компьютере; дальнейшая проверка выполняется headless либо в изоляции.

Снимки: [браузер](negative-draw.png), [native consumer](negative-native.png).
Receipt браузера: [negative-receipt.json](negative-receipt.json).

Оставшийся объём r1: time/calendar, доказанные morph-переходы, Lottie/dotLottie,
каталог и 0.4.0. Clock solver исходной authored-elbow позы проходит четыре
варианта на 400/24, но отказывается на остальных optical masters; нельзя
исправлять принятую оптику ради его предположений. Следующий опыт — перенос
доказанного source correspondence и проверка скрытых closures на всех опорах.
Calendar kernel уже имеет rounded digits и явные Date/IANA zone; его Filled
цифры могут использовать эту общую вычитающую композицию. Это направления
следующей работы, а не утверждение об их готовности.

Источники: [Apple Draw](https://developer.apple.com/videos/play/wwdc2025/337/),
[Compose BlendMode](https://developer.android.com/reference/kotlin/androidx/compose/ui/graphics/BlendMode),
[Compose graphics isolation](https://developer.android.com/develop/ui/compose/graphics/draw/modifiers),
[SVG 2 compound paths](https://www.w3.org/TR/SVG/paths.html).
