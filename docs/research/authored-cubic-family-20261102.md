# Исследование авторских кубических форм

Метод: разведка, узкий выбор механизма. Проверено 2026-11-02. Read-only исследование source `75c67fc32a3f6b037df091f1383adfae754f21f8`; Figma saved version `2416636003859748575`. Это исследование не меняет Git и не утверждает визуальную приёмку. Graphiti group=research прочитан; применимого ответа на узкий геометрический вопрос не найдено. Firecrawl search вернул HTTP 402; первичные документы прочитаны через Exa. Память не изменялась.

## Рекомендация

Для многоточий сильнее и проще общий закон изменения **положительных авторских частей**: одинаковый множитель размера точки и отдельный множитель расстояния между точками. Точные исходные C-операнды принадлежат build compiler; consumer получает семантические параметры. Не вводить публичный arbitrary path, массив controls, скрытые исправления по имени или замену кубических форм аналитическими окружностями.

Этот закон закрывает полезную вариативность геометрии при точном default. Он не закрывает конструктивное authoring новых типов формы, optical sizing, полное покрытие каталога или native motion export. Рекомендация: Medium до конкретной продуктовой и визуальной приёмки; точность identity и геометрические контрпримеры: High.

## Что показывают masters

`masters/figma/2416636003859748575/{Outline,Filled}`:

| Master | Проверенный факт |
|---|---|
| ellipsis-horizontal / ellipsis-vertical, Outline | Три отдельные заполненные `MCCCCZ` части; номинальный радиус 1.6; handles/r находятся между 0.55225 и 0.5523125 |
| ellipsis-horizontal / ellipsis-vertical, Filled | Три отдельные заполненные `MCCCCZ` части; номинальный радиус 1.8; одинаковые точки имеют различные C-операнды |
| ellipsis-horizontal, Filled, третья точка | North/South x=19.0002; середина East/West x=19.00015; половины bbox: rx=1.79995, ry=1.8. Точная общая окружность с одним центром и радиусом не описывает эти operands |
| ellipse, Filled | Один `MCCCCZ`; cardinal radius 10.5. Для первого cubic при t=1/4 квадрат радиуса превышает 10.5² на **23392881/409600000 > 0**; численный радиус 10.502719244361382 |
| ellipse, Outline | Один path с двумя `MCCCCZ`; первый inner start `(20.7002,12)` и control `(20.7,7.1953)` дают ненулевую радиальную составляющую касательной −0.0002. Максимальное отклонение controls от axis-tangent: 0.00021 |
| chatbubble-ellipses, Filled | Один evenodd compound path: оболочка и три отрицательных выреза. Это не три положительные dot parts; triad admission должен отказать |

Десятичные различия не названы ошибками Figma или шумом: происхождение не установлено. Точное сохранение master требует сохранять их. Raw SHA-256: Outline horizontal `2d809cc6e544a60ea8d97da5c3159b780263fd9637dba833a009a85c3cc6c681`; Outline vertical `c488b01da737ddf19adf1336b05a14c0c246d69d3456aea7e1c9dfe25e3ef9ed`; Outline ellipse `098d6ba432d8be5317572aed971ed0f4f8f9123717a212e2200490c897632860`.

Следствие: 4 labelled cardinal extrema + 8 tangent handle lengths без radial deviations не сохраняют все masters точно. Добавление четырёх радиусов, отдельных tangential handles и radial residuals создаёт возможное конечное представление, но оно уже сохраняет значительную часть произвольной authored geometry. Само наличие имён у этих чисел не доказывает новый конструктивный закон. Отсутствие простого общего коэффициента не доказывает невозможность любого конечного семейства.

## Общий закон и область

Для точного исходного operand `p` части i:

`p' = p + (s−1)(p−a_i) + (g−1)q_i e`.

Здесь `s>0` — dot scale, `g>0` — spacing scale; `a_i` — одинаково вычисляемый центр bounding/control box своей authored части; `e` — выведенная горизонтальная/вертикальная ось triad; `q_i` — исходное продольное расстояние от среднего dot pivot. Важно сохранять исходные q_i, включая последние десятичные разряды, а не делать интервалы принудительно одинаковыми. Публичные координаты и произвольные transform не нужны.

Identity s=g=1 сохраняет каждое исходное число. Сериализатор обязан сохранить default без округляющего round-trip. Положительное s сохраняет замкнутость, winding и normalized authored curvature; изменения gap не следуют из uniform whole-glyph scaling. Affine manipulation существующих cubic operands — штатная операция в SVG и FontTools [1,2], High. Это основание механизма, а не доказательство optical quality.

Для продольных source центров u_i, половин source bounds r_i, поперечных v_i/h_i и canvas width W domain выводится из:

- `g(u_(i+1)−u_i) − s(r_i+r_(i+1)) >= minimumGap`;
- `minimumMargin <= u_mid+g*q_i−s*r_i`;
- `u_mid+g*q_i+s*r_i <= W−minimumMargin`;
- соответствующих transverse условий `minimumMargin <= v_i±s*h_i <= W−minimumMargin`.

Это линейные условия по s/g; их пересечение даёт convex geometric domain. Control-hull bounds — достаточная безопасная оценка, не объявленная точным curve bbox. Для cubic Bernstein weights неотрицательны и суммируются в 1, поэтому весь curve лежит в control hull. Product minimumGap/minimumMargin должны происходить из существующего владельца требований. Domain не является автоматически author-approved диапазоном.

Admission: exact source/version/hash и declared stable parts; ровно три независимые положительные fill части с одним замкнутым четырёхкубическим контуром каждая; согласованные paint/winding; обоснованная dot identity и axis alignment; сохранение порядка и authored variant. При неподдержанном compound/polarity/correspondence или выходе за domain — типизированный отказ. Один geometry shape check не удостоверяет semantic dot role: авторская декларация остаётся необходимой. Не извлекать произвольные subpaths из Filled chatbubble.

Outline/Filled имеют независимые authored operands и не интерполируются друг в друга по умолчанию. ellipse имеет отдельный nested-contour invariant; triad law к нему неприменим. Отдельное масштабирование counter/outer ring требует containment и minimum wall proof, отсутствующих у triad.

Provenance для изменённой геометрии должно показывать exact master dependency, law/version и effective s/g; нельзя выдавать nondefault за неизменённый source или конструктивный DesignSpec candidate. Build-derived pivots не равны доказанным optical centers. Стабильные part IDs сохраняются; это ещё не подтверждает разрешение жестов, retarget continuity или форматную анимацию.

## Сравнение альтернатив

| Подход | Результат и ограничение |
|---|---|
| Analytic A/circle replacement | Исключён точным rational radial counterexample; старый genRing ещё использует другую authored radius policy |
| Общий circular cubic r+kappa | Недостаточен: handles и cardinal symmetry отличаются; exact fitted profile с отдельными handles потребует дополнительных чисел |
| Полный labelled cardinal/handle/residual schema | Возможен, но сложнее source-owned semantic deformation и пока не даёт доказанного потребительского преимущества; нельзя считать его невозможным |
| Variable contour masters / font | Штатная сильная альтернатива при дополнительных авторских masters. OpenType/Apple требуют совместимых paths/points [3,4]; совпадение количества не удостоверяет семантическое correspondence, start order и качество промежуточных форм [5,6]. Текущие Outline/Filled не являются small/display optical masters |
| TrueType gvar | Работает с glyf; quadratic outlines подтверждают независимые Apple/FreeType [7,8]. Прямого сохранения исходных cubic C не даёт; conversion должен иметь собственное fidelity proof |
| CFF2 target | Поддерживает native cubic outlines и blends [3,9; также cubic distinction 8]. Подходящий будущий font target, но сам выбор формата не создаёт anatomy/part/motion consumer contract. Численные представления и реальный target fidelity отдельно проверяются; невозможность exact font conversion здесь не доказана |
| Exact source + semantic part deformation | Минимум нового geometry state, identity default, реальные независимые size/gap changes; выигрывает для текущего узкого invariants, сохраняет source ownership |
| Не объединять | Правильный отказ для неподходящих shapes и безопасный static fallback; не закрывает намерение полезной вариативности положительного triad |

Optical sizing меняет size-specific proportions/weights/details/spacing и зависит от устройства и расстояния [10,6], High для общего принципа. Это не эмпирическое доказательство улучшения конкретного Lab Icons triad. Штатные compatible masters могут выразить такую политику; таблица opsz→s/g без авторской калибровки остаётся гипотезой.

## Выполненные probes

Dependency-free Python, Decimal/Fraction; без сборок, браузера, benchmark и Git mutations. Первый геометрический parse probe остановился на L в chatbubble; второй корректно отделил compound counterexample и завершился exit 0. Rational deformation probe исполнил все C operands четырёх ellipsis masters:

| s / g | Exact default operands | Минимум достаточного canvas margin среди 4 masters | Минимум adjacent control-hull gap |
|---|---|---|---|
| 1 / 1 | Да, все | 3.1998 px | 3.4 px |
| 1.1 / 0.9 | Изменены; max change 0.860001/0.88 px | 3.7198 px | 2.34 px |
| 0.9 / 1.1 | Изменены; max change 0.860001/0.88 px | 2.6798 px | 4.45999 px |

Эти значения — математические measurements от сохранённых controls, не растеризация или perceptual study. Визуальная приёмка, packed consumer, runtime/interruptions и независимое review реализации не выполнялись.

## Falsifiers

- Default string/fingerprint/paint/parts отличаются хотя бы для одного variant.
- Новая точка, изменение winding/paint или compound holes принимаются как положительный triad без declared semantic correspondence.
- Один knob меняет s/g, но SVG geometry остаётся default, или изменение является только whole-glyph transform.
- Controls выходят за безопасные bounds, adjacent gap нарушен, glyph обрезается; domain принимается без доказанного отказа на нарушении.
- IDs/порядок частей меняются при запросе size/gap, либо unchanged variant подменяется другой authored form.
- Source scalar values или optical centers замаскированы как globally constructive coefficients.
- Непрошедшие визуальные формы объявлены optical improvement по одним numeric bounds.
- Более простой exact master+semantic compiler даёт тот же consumer transition: тогда полный finite calibration schema не имеет основания.

## Первичные источники

Все источники прочитаны 2026-11-02; непоказанная дата публикации не выдумана.

| # | Источник | Версия/дата и область |
|---|---|---|
| 1 | https://www.w3.org/TR/SVG2/coords.html и https://www.w3.org/TR/SVG2/paths.html | SVG 2 TR snapshot; transforms/cubic operands/path interpolation |
| 2 | https://fonttools.readthedocs.io/en/latest/pens/transformPen.html | latest docs; affine transformation всех точек/controls |
| 3 | https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview | OpenType 1.9.1; compatible masters/default+deltas |
| 4 | https://developer.apple.com/videos/play/wwdc2021/10250/ и https://developer.apple.com/documentation/technologyoverviews/custom-sf-symbols.md | WWDC21, SF Symbols 3.0; current custom-symbol docs; compatible source/path/point design |
| 5 | https://fonttools.readthedocs.io/en/latest/varLib/interpolatable.html | latest docs; contour-order/interpolatability checks |
| 6 | https://adobe-type-tools.github.io/font-tech-notes/pdfs/5091.Design_MM_Fonts.pdf | Adobe Technical Note 5091, 1997; pp.12–20 correspondence, kinking/crawling, optical masters |
| 7 | https://developer.apple.com/fonts/TrueType-Reference-Manual/RM01/Chap1.html | TrueType Reference Manual; quadratic splines/winding |
| 8 | https://freetype.org/freetype2/docs/glyphs/glyphs-6.html | Last update 2022-10-23; TrueType quadratic/CFF2 cubic and cbox vs bbox |
| 9 | https://learn.microsoft.com/en-us/typography/opentype/spec/cff2 и https://learn.microsoft.com/en-us/typography/opentype/spec/gvar | OpenType 1.9.1; CFF2 cubic/blend, gvar/glyf deltas |
| 10 | https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxistag_opsz | OpenType 1.9.1; size-specific design and viewing conditions |

Границы исследования: нет новых small/display авторских masters; неизвестно происхождение малых decimal deviations; полезность выбранных nondefault визуально не установлена; consumer-native font cost не измерена. Эти пробелы не мешают exact identity и проверке геометрического закона, но мешают claims optical admission или полного product completion.

## Горизонтальное ↔ вертикальное многоточие

Дополнение проверено 2026-11-02 на тех же четырёх ellipsis masters. Все контуры
начинаются на South и проходят East, North, West с одинаковым порядком `MCCCCZ`.
У каждой четверти control coordinates монотонны по обеим осям. Выпуклая
интерполяция соответствующих координат сохраняет четверти в их квадрантах,
ненулевые cardinal spans, замкнутость и winding. Точное соответствие чисел
допускает прямое изменение `d`; Outline и Filled остаются независимыми.

SVG 2 требует одинаковые число, типы и порядок path commands для плавной
интерполяции и задаёт интерполяцию их численных параметров [1]. Это условие
синтаксической совместимости. CSSWG issue [11] показывает неблагоприятный
случай дуг даже при совместимой структуре. Здесь arcs исключены, а отсутствие
самопересечения следует из монотонных cardinal quarters. Поддержка WebKit [12]
сама по себе не доказывает совместимость всех браузеров или качество формы.

Для пары центров разность имеет вид `((1-p)dx, p*dy)`. Минимум квадрата
расстояния по всему интервалу равен `dx²*dy²/(dx²+dy²)`. Кубическая кривая
лежит в выпуклой оболочке controls; эту оболочку ограничивает диск с центром
в cardinal cross и радиусом до самого дальнего control. Интерполяция двух
оболочек остаётся в диске с большим из исходных радиусов. Compiler проверяет
все пары точек, margin каждого control и минимальный зазор из `semantics/grid.json`.
Дроби вычисляются точно из двоичного представления исходных Number.
Начальный `sqrt` корректируется вверх, пока квадрат двоичной границы не
покрывает точную дробь.

Для вычисления `(1-p)*a+p*b` покоординатная ошибка ограничена
`4*Number.EPSILON*maxAbsOperand` при конечных исходных координатах в принятом
canvas. Для дисков используется верхняя двоичная граница `√2` этой ошибки;
к требуемому расстоянию добавляется ошибка обеих частей. Margin проверяется
покоординатно, каждый радиус South/East/North/West от cardinal center отделён
от двойного бюджета ошибки. Для промежуточных координат используется одна
арифметическая формула; её монотонность сохраняет порядок controls и при
округлении. При 0/1
runtime сохраняет исходные строки без пересериализации. Численный certificate
содержит округление и обе стороны каждого сравнения.

Достаточный зазор дисков у default Filled близок к policy minimum. Пара
`dotScale=1.1, spacingScale=0.9` удовлетворяет endpoint gaps, но при p=0.5
расстояние между точками двух реальных Bézier quarters меньше требуемого
зазора. Исполняемый контрпример закреплён в `test/authored-contour-states.test.js`.
Поэтому первый переход принимает только 1/1. Это явный отказ до отдельного
доказательства области `(dotScale, spacingScale, p)`, а не перенос endpoint domain
на весь путь.

Установленный бесплатный MIT-пакет `@labpics/motion` 0.5.0 предоставляет
`value().animate()/subscribe()/get()/dispose()` для шкалы p. Его opt-in
`svg-morph` включает разбор и resampling произвольных paths и форматирование
промежуточных координат до четырёх знаков. Для уже доказанного соответствия
достаточен prepared sampler: разовая структурная проверка и копия numeric packet,
затем прямое смешение и сериализация. Новый scheduler, DOM parser и
identity registry не нужны. Structural sampler не делает author-admission claim
для внешнего JSON; авторскую семантику проверяет `compileAuthorStateGroups`.

Общий source reader нормализует начальное `m`, а path parser разворачивает
неявные команды. Для точных endpoints compiler дополнительно сверяет строки
с raw path tags и принимает только буквальные абсолютные `MCCCCZ` длиной до
4096 символов. Иначе он возвращает `CORRESPONDENCE_UNAVAILABLE` до выдачи
скомпилированного пакета. Вход, проходящий `dots.affine`, но требующий такой
нормализации, закреплён как отдельный RED.

Renderer, effects и capabilities получают отдельные build projections; код
вызова только одной операции не удерживает две другие. Packet допускает JSON
и дублированную установку пакета. Lottie/SF transition пока явно отвергаются.
Геометрический proof и узкие тесты не устанавливают browser interruption,
оптическое качество или готовность всего продукта.

| # | Прочитанный первичный источник | Область |
|---|---|---|
| 11 | https://github.com/w3c/csswg-drafts/issues/10195 | Обсуждение проблем arc interpolation; контрпример против достаточности одной структуры |
| 12 | https://github.com/WebKit/WebKit/pull/27077 | Web Animations path `d`, merge 2024-04; implementation scope и blend limitations |

Источник Motion API и сравнения с `svg-morph`: установленный
`node_modules/@labpics/motion` 0.5.0, публичные `motion/value.d.ts`, export map
и implementation opt-in adapter, прочитаны 2026-11-02.
