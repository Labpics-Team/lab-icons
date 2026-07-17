# Геометрическая конституция Lab Icons

Этот документ задаёт инварианты канонического Glyph IR. Он не описывает вкус
отдельной иконки: он ограничивает пространство допустимых решений так, чтобы
новый глиф нельзя было «дорисовать примерно».

## 1. Канон и выходные форматы

Канон — параметрическая анатомия: recipes → semantic parts → contours. SVG,
icon font, canvas, Lottie и нативные path API — компиляторные цели.

Icon font не может быть SSOT: он не хранит независимые motion anchors и роли
частей, неудобен для декораторов и динамической даты, а совместимый morph в
OpenType требует стабильного набора и порядка точек. Font target разрешён
только после lowering в совместимые outlines.

Каждый вариант имеет один из статусов:

- `source-only` — точный SVG существует, конструктивный закон не доказан;
- `candidate` — закон строится, но ещё не заменяет исходник;
- `accepted` — отгружаемая форма выводится законом и защищена drift-гейтом.

`generated` в anatomy означает только, что закон материализуется; это не
синоним `accepted`. Если Observatory даёт `REVIEW` или `FAIL`, мастер остаётся
в явном карантине и `accepted-only` возвращает точный source fallback. Ратчеты
раздельно считают построенные законы, принятые мастера и карантинный долг.

«Точный source fallback» имеет закрытый язык: корневой `svg` и монохромные
fill-paths с локальным fill rule. Viewport-identity clip разрешено понизить как
доказанный no-op; mask, transform, частичный clip и иная render-семантика
запрещены, пока не представлены явно в IR composition и fingerprint.

Отсутствие модели никогда не превращается в нулевое отклонение или поддержку
оси. Неподдержанная ось — ошибка, а не no-op.

## 2. Координаты, keylines и пиксельная дисциплина

Декларации используют доли канвы; перевод в target units происходит один раз
на границе компилятора. Круглая, квадратная, широкая и высокая формы имеют
разные keylines: один общий bounding box оптически неверен.

Разница размеров keyline-семейств не называется типографским overshoot.
Overshoot — локальный выход круглой/острой формы за alignment zone ради
оптического равенства; `circle 22 / square 20` здесь является отдельным
продуктовым keyline-решением. Оно сохраняется только пока corpus/raster review
его подтверждает, а не как универсальная пропорция иконографии.

Дробная координата не является дефектом сама по себе. Дефект — необъяснимый
дрейф целевой грани после rasterization на заявленных size × DPR. Поэтому
контрольные точки кривых могут быть дробными, а ключевые прямые, терминалы и
просветы проверяются на 16/20/24/32/48 px и целевых DPR.

Overshoot, optical centering и raster nudges допустимы только как именованные
`opticalDelta` с источником, областью действия и тестом. Анонимная поправка
координаты запрещена.

## 3. Негативное пространство

Counter, aperture, gap, knockout и exterior clearance — геометрия первого
класса, а не остаток после рисования чернил. Recipe обязан задавать:

- минимальный clearance и способ его измерения;
- связь внутреннего радиуса с внешним и весом;
- поведение просвета на концах осей;
- правило схлопывания детали на малом `opsz`;
- winding/fill rule, если counter материализуется контуром.

Публичный recipe возвращает это доказательство в единственном
`negativeSpace.constraints`: каждый элемент называет `kind`, normalized-canvas
`unit`, обязательный минимум, фактически измеренное значение, метод измерения и
участников. Поля `pass` нет: если геометрия не сохраняет минимум, recipe бросает
ошибку и недопустимый результат невозможно получить.

Вес не может расти, если это опускает охранный просвет ниже токена. В таком
случае master меняет пропорции или явно удаляет вторичную деталь.

## 4. Примитивы и кривые

Точная окружность, эллипс, линия, дуга, capsule и аналитическое касание
сохраняются как primitives до lowering. Произвольный path допустим только для
остаточной формы с зафиксированной причиной.

Для видимого стыка минимум — G1; для безье-сегментов предпочтителен C1. На
крупных силуэтах контролируется изменение кривизны, а не только отсутствие
излома. Касание, socket и offset строятся формулой; анонимное перекрытие частей
«на глаз» запрещено, потому что оно меняет результат `evenodd`/`nonzero` и
ломает morph. Намеренный overlap обязан быть именованной операцией с явно
заданным lowering (`union`, `subtract` или compositor OR).

## 5. DRY — это алгебра, не совпадение типа path

Переиспользуются:

- recipes: chevron, arrow, note, calendar body, cloud hull;
- operators: rotate, mirror, repeat-radial, offset, socket, trim;
- decorators: enclosure, strike, badge, notification, status mark;
- token relations: `innerRadius = outerRadius − weight`, а не две константы.

Два произвольных `stroke-path` с разными массивами точек не считаются DRY.
Направления одной стрелки выводятся поворотом одного head recipe; shaft имеет
явную длину и socket. `musical-notes` собирается из того же note recipe, что
`musical-note`. Circle enclosure и strike не копируются внутрь каждого глифа.

## 6. Semantic parts и готовность к motion

У каждой моделируемой части обязательны стабильные `id`, `role`, `zIndex`,
anchor policy и topology signature. Порядок SVG path не является identity.

Topology signature — необходимое, но недостаточное условие morph. Для прямой
интерполяции также совпадают соответствие контуров, направление обхода,
стартовые точки и число on/off-curve points. Несовместимые состояния получают
явный remap или дискретный transition; компилятор не угадывает соответствие.

Motion позже управляет смысловыми частями: reload вращает `orbit+terminal`,
earth — sphere/grid/terrain, brush — handle/bristles/paint trace. Статическая
анатомия не содержит generic opacity/scale как замену смысловому движению.

Текущее socket-разбиение стрелок `time` является только статическим lowering:
форма одной стрелки зависит от положения другой. До объявления motion-
capability обе стрелки должны стать самостоятельными capsules вокруг общего
bearing; outline понижается через `union(hands)`, filled — через
`base − union(hands)` (`mask-subtract`). Пока этот закон не реализован и не
проверен на всём диапазоне поворотов, библиотека не обещает независимую
анимацию стрелок.

## 7. Оси

Ось меняет конструкцию, а не масштаб готовой картинки.

- `weight`: толщина чернил с охраной counters и apertures;
- `corner`: профиль только объявленных скруглений, не post-process;
- `opsz`: пропорции, просветы, вес, aperture и уровень деталей для реального
  целевого размера;
- `fill`: дискретные masters до появления доказанного совместимого morph;
- grade/contrast/client axes добавляются только после отдельного закона.

Нелинейное отображение пользовательской координаты задаётся явно (аналог
OpenType `avar`). Дискретное изменение topology разрешено только на именованном
breakpoint: например, удаление микродетали между optical-size masters. Внутри
master interval topology остаётся стабильной.

Слово `continuous` описывает числовой вход генератора, но не является само по
себе доказательством читаемости. Public capability появляется только после
sampled optical proof по диапазону, нескольким raster phases и целевым размерам.
Это честно остаётся конечным испытанием, не аналитической теоремой для всех
вещественных координат; найденный drift блокирует ось и получает явную debt-
запись, а не скрытую автоматическую фильтрацию.

## 8. Calendar number

Дата — IO. Functional core принимает `Date` и IANA time zone явно; скрытый
`Date.now()` и неявная локальная зона запрещены. Цифры 0–9 принадлежат проекту,
имеют tabular advance и стабильные слоты `tens/ones`. Календарная оболочка и
цифры — разные semantic parts.

Центральная линия цифры может быть удобным master для редактирования, но font
и filled-SVG targets получают expanded outline. Наличие SVG `stroke` не
считается завершённым font-compatible контуром.

## 9. Доказательство сходства

Одного процента недостаточно. Observatory показывает исходник, модель и:

- binary centre-sampled occupancy symmetric difference / union — основной
  «deviation %» с явно указанным `analysisStep` (это не alpha coverage);
- boundary distance p95 и max;
- binary occupancy error на целевых размерах 16/20/24/32/48;
- площадь и смещение centroid;
- topology/counter mismatch как отдельный adaptive vector-guided multiphase
  oracle. Он публикует шаг/фазы/confidence; фазовая нестабильность или лимит
  разрешения дают `UNCERTAIN` и fail closed, а не ложный match. Machine-поля
  разделяют доказанный `difference` и незнание `uncertain`; `mismatch` не является
  их объединением.

Default topology floor не является epsilon «на глаз»: на канонической канве
24 units сетка 960×960 даёт шаг 0.025, а feature 0.1×0.1 получает 4×4 samples
и площадь 0.01. Нулевые exporter-loops и subpaths ниже этого заявленного пола
не участвуют в topology signature, но их raw counts остаются в отчёте. Изменить
960, четыре samples или floor — значит изменить публичный quality contract.
Одна площадь не доказывает разрешимость: узкая внутренняя петля того же subpath
извлекается как traversal cycle; если её minor span требует сетку плотнее
бюджета, verdict становится `UNCERTAIN`, даже когда сам растр случайно увидел
counter. Так grid budget не превращается в ложное геометрическое доказательство.

Пересечения разных subpath проверяются как bounded arrangement, а не как
«несколько больших bbox». Монотонный weld допустим лишь в ациклическом графе
доказанно связных пересечений. Одномерный seam внутри одного `nonzero` compound
с одинаковым winding разрешён только как связная exact source-boundary:
реверсивная линия/кривая либо аналитически совпадающий участок дуги. Цикл
weld-ов, `evenodd`/противоположный winding, несколько возможных components
одной пары, недоказанное касание точкой и butt-joint разных compositor layers
дают `UNCERTAIN`: именно между такими крупными частями может возникнуть тонкий
counter выше area floor. Внутри одного subpath zero-area collinear retrace и
implicit-close spur сначала канонически сокращаются; остаточное самокасание,
способное ограничить positive-area face, также даёт `UNCERTAIN`.
Нулевая signed area всего traversal не доказывает пустой контур: у bow-tie
положительные faces могут взаимно уничтожиться алгебраически. Для `L` degenerate-
решение использует translation-invariant fan upper bound площади traversal. Для
`Q/C/A` sampled polygon не является верхней границей: только exact bounding box
может доказать, что весь subpath меньше floor. Если sampled area ниже floor, но
exact box ещё допускает feature не меньше floor, subpath сохраняется, а verdict
закрывается в `UNCERTAIN`.

Target-size binary deviation, boundary и centroid пока диагностические: один
centre sample на пиксель не моделирует alpha coverage и способен преувеличить
ошибку на малом числе клеток. В acceptance участвует target-size topology;
процент станет HARD только после появления детерминированного alpha-coverage
renderer и отдельного калибровочного решения. Публиковать диагностический
процент как доказательство PASS запрещено.

Отклонение выше 3% требует конкретного геометрического аргумента. Автоматически
сочинённый fallback не является аргументом и обязан покрасить гейт.

Исторический корпус ещё несёт отдельно измеренный migration debt. Report не
означает «мягкий»: ceiling и SHA-256 полного множества находок заморожены в
quality snapshot. Рост количества или замена старой находки новой при том же
count — HARD; уменьшение долга обновляет proof в том же ревьюируемом изменении.

## Нормативные источники

- [Material icon keylines and 24 dp grid](https://m1.material.io/style/icons.html)
- [SF Symbols: Draw for animation](https://developer.apple.com/videos/play/wwdc2025/337/)
- [SF Symbols: custom symbols and components](https://developer.apple.com/videos/play/wwdc2023/10257/)
- [OpenType registered design-variation axes](https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxisreg)
- [OpenType optical size axis](https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxistag_opsz)
- [OpenType nonlinear axis mapping (`avar`)](https://learn.microsoft.com/en-us/typography/opentype/spec/avar)
- [OpenType glyph variations and stable point numbers](https://learn.microsoft.com/en-us/typography/opentype/spec/gvar)
- [SVG paths and compatible interpolation](https://www.w3.org/TR/SVG/paths.html)
- [TrueType hinting](https://learn.microsoft.com/en-us/typography/truetype/hinting)
- [Google Fonts variable-font outline QA](https://googlefonts.github.io/how-to-hint-variable-fonts/)
