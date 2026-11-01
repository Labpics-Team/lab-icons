# Замена внутреннего знака с общей оболочкой

Исследование и source-срез 2026-11-01. Потребность — менять символическое
состояние, разворачивать переход и принимать новое намерение, сохраняя
авторскую геометрию Lab UI v2.1 и видимую непрерывность.

[WWDC25, SF Symbols 7, глава Magic Replace 6:02](https://developer.apple.com/videos/play/wwdc2025/337/)
описывает сохранение совпадающих enclosures при одновременной замене отличающихся
layers. Это подтверждает пригодность композиции без arbitrary contour matching.
Никакие Apple artwork или proprietary assets не используются.

[SVG 2 §3.6](https://www.w3.org/TR/SVG2/render.html#Groups)
определяет group compositing и применение opacity к уже отрисованной группе.
Поэтому внутренние paths question/attention имеют общий opacity target;
изменение каждого path отдельно не было бы эквивалентно при перекрытиях.

## Точный authored domain

Figma file `LuaiBd4anRi4DMZayKAnY2`, snapshot `2416636003859748575`,
Icons page `4045:632`, Outline frame `8513:1000`.

| Значение | Символ | Outline node |
|---|---|---|
| confirmation | checkmark-circle | `6431:4056` |
| dismissal | close-circle | `6431:3870` |
| question | question-circle | `6431:3733` |
| attention | alert-circle | `6431:3740` |
| increase | plus-circle | `6431:3751` |
| decrease | minus-circle | `6431:4069` |

У выбранных masters последняя path содержит одинаковый enclosure `d`:
SHA-256 `e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9`.
Размеры и viewBox — 24; paint — currentColor, fill-rule — evenodd,
transforms отсутствуют. Interior d/rules/order сохраняются буквально.
Paths не перенумеровываются по близости: IDs задаёт versioned semantic spec.

## Точное равенство при другом начале контура

Source-срез 2026-11-02 расширяет проверку только у build-time владельца
`enclosure.replace`. Outline `arrow-back-circle` и `arrow-down-circle` имеют
точно одинаковые восемь кубических рёбер кольца; начало каждого контура и
направление обхода различаются. Независимая проверка raw masters сопоставляет
`(P0,C1,C2,P1)` с `(P1,C2,C1,P0)` и сохраняет каждую десятичную координату.

При сравнении shared parts после прежнего literal сравнения частный ключ
поддерживает абсолютные
`M/L/H/V/C/Z`, включая повторные наборы аргументов. Абсолютные
[H/V](https://www.w3.org/TR/SVG2/paths.html#PathDataLinetoCommands)
задают L-рёбра с сохранением текущего y/x; координаты только копируются.
Этот authored alias также учитывается при проверке повторов prefix.
Числа представляются значащими
десятичными цифрами и целой степенью десяти; округления, epsilon и `Number`
для координат нет. Ключ сохраняет границы, число контуров и повторные обходы.
[SVG 2 closepath](https://www.w3.org/TR/SVG2/paths.html#PathDataClosePathCommand)
задаёт прямое ребро от текущей точки до начала; ключ включает его, когда
точки различаются. Все контуры должны быть явно закрыты `Z`. Циклический
сдвиг выбирает первое ребро без изменения координат; минимальная rotation
находится за линейное число сравнений без хранения всех вариантов.

Нулевые прямые рёбра удаляются из ключа. Последовательные коллинеарные рёбра
одного направления объединяются, включая циклический шов. Углы и обратный
ход сохраняются; авторский `d` не переписывается. Если рёбер не осталось,
ключ сохраняет исходную точку `M` и количество таких контуров.
Это закрывает alias `L11 5` и `L10.5 5L11 5` из точки `(10,5)`.

Коллинеарность вычисляется точным нулём определителя из шести произведений
десятичных коэффициентов. Члены группируются по степени; нули в конце
минимального коэффициента переносятся в степень. Если у минимального члена
осталась ненулевая последняя цифра, старшие степени её погасить не могут.
Промежуточные `10^exponent` не создаются. Порядок координат определяется
знаком, длиной значащих цифр плюс степенью, затем цифрами с дополнением до
длины большего исходного коэффициента. Стоимость зависит от длины входных
коэффициентов и показателей, а не от величины показателя.

[Cubic Bézier](https://www.w3.org/TR/SVG2/paths.html#PathDataCubicBezierCommands)
становится L только при точной коллинеарности контрольных точек и порядке
`P0≤P1≤P2≤P3` вдоль изменяющейся координаты. Производная скалярного cubic
с такими точками является суммой неотрицательных приращений с
неотрицательными коэффициентами базиса Бернштейна: он покрывает тот же
отрезок в том же направлении. Неупорядоченные контрольные точки сохраняют C;
равные концы удаляют C только когда обе контрольные точки совпадают с ними.

Существующий quality-metrics использует `GEOMETRY_EPSILON`, а decimal helper
benchmark adjudication материализует степени десяти для budgets.
Бесплатный [robust-predicates, commit 4b3c7422](https://github.com/mourner/robust-predicates/blob/4b3c7422fd0ba299e0cff05e81374c211a746932/src/orient2d.js)
принимает binary64 coordinates. Эти методы не сохраняют decimal-token контракт
с произвольной степенью; частный exact zero predicate остаётся у build-owner.

[SVG 2 fill-rule](https://www.w3.org/TR/SVG2/painting.html#FillRuleProperty)
позволяет переставлять контуры. Для `evenodd` допустим независимый разворот
каждого; для `nonzero` — только одновременный разворот всех. Контрпример:
`M0 0L10 0L10 10L0 10Z M2 2L8 2L8 8L2 8Z` даёт winding 2 в центре;
разворот только внутреннего квадрата даёт winding 0 и отверстие.
Paint, fill-rule, рамка, размеры, порядок path, semantic IDs и роли
проверяются отдельно. Arcs, `Q/S/T` и relative commands дают «не доказано».
Для shared parts сохраняется literal fast path и прежний тип отказа.
Каждая prefix part обязана иметь установленный exact key; иначе build
возвращает `TOPOLOGY_UNSUPPORTED`, даже когда raw spelling уникально.
Так неподдержанный relative alias не обходится через отдельный literal индекс.

Ключ даёт достаточный признак совпадения цепочек рёбер в этом языке.
Разные ключи не доказывают различие заполненной области: иная сегментация
настоящих кривых, неупорядоченные коллинеарные контрольные точки C и разложение
compound paths этим срезом не сопоставляются.
Допуск не утверждает полного геометрического равенства или уникальности
произвольных SVG paths.

Бесплатный [picosvg svg_reuse.py, commit 933657f](https://github.com/googlefonts/picosvg/blob/933657f783b48e533952ffd3f5cfb8085b8388a5/src/picosvg/svg_reuse.py)
использует tolerance, rounding и affine transforms. Его сравнение не сохраняет
требуемую exact-decimal границу; новый geometry engine здесь не нужен.

Mounted suffix берётся из объявленного `defaultState` и хранится один раз.
Только другое authored spelling добавляет частный `staticSharedSvg` к состоянию:
static render сохраняет оригинальные `d`, rule и порядок. Capabilities это
внутреннее поле не публикует; runtime получает только готовые SVG строки.
Хеши прежних трёх payload, module и proof сохраняются.

Компилятор отвергает доказанное повторение рисунка в любой позиции prefix
хотя бы у двух состояний. Пересечение всех состояний
недостаточно: `A={x,a}`, `B={x,b}`, `C={c}` не имеют общей части втроём,
но `A→B` помещает `x` в две opacity-группы. На непрозрачном `x` при opacity
`1/2` каждой группы source-over даёт alpha `3/4` вместо `1`.
Повтор получает `SHARED_PART_UNDECLARED` по тому же literal/exact сравнению
paint и геометрии. Повторы внутри одного authored prefix сохраняются одной
opacity-группой. Этот закон не переносит первую или среднюю общую часть
в suffix автоматически и не создаёт renderer для частичных подмножеств.

Back/down проверяются test-built декларацией через production compiler и raw
static oracle. Публичная directional группа этим срезом не добавляется.
Outline forward/up имеют реальные decimal различия и сохраняют
`ENCLOSURE_MISMATCH`; каждый из четырёх Filled masters содержит один compound
path и сохраняет `TOPOLOGY_UNSUPPORTED`. Masters остаются неизменными.
Packed consumer, browser/optical admission и performance требуют своих гейтов.

## Альтернативы и различители

| Способ | Проверенное ограничение | Решение |
|---|---|---|
| Morph по числу точек/nearest contour | Знак question содержит dot и stem; check/plus/minus имеют другую топологию. Совпадение внешнего кольца не задаёт correspondence interior | Не объявлять morph |
| Заменить весь SVG | Статический endpoint точен, но shell/DOM identity теряются; interruption начинается заново | Оставить static export; transition сохраняет группы |
| Анимировать каждый interior path | Object opacity и group opacity различны при compositing перекрытий | Применять opacity целой группе |
| Две постоянно создаваемые группы | При третьем намерении нужно сохранить многокомпонентную текущую смесь либо потерять continuity | Один bounded mounted group на каждое объявленное состояние |
| Подключить новый animation engine | Публичный Lab Motion sequence принимает явное начальное значение opacity и последующие scalar stages | Сохранить generic effect contract, без scheduler в Icons |

Состояния называют знаки. В частности, close-circle не назначается ошибкой:
семантическую связь с действиями и доступным текстом задаёт приложение.

Filled checkmark-circle объединяет body и отрицательный mark-hole одной path;
он не имеет отдельной последней оболочки. Forced admission получает
`TOPOLOGY_UNSUPPORTED`. Новый допустимый master с другой enclosure координатой
или fill-rule получает `ENCLOSURE_MISMATCH`, даже с корректными новыми hashes.

## Реализация и границы проверки

Build compiler проверяет raw/normalized/path receipts, production glyph,
ordered paint и одинаковую рамку до выдачи всего payload. Общий SVG serializer
готовит enclosure и interior fragments. Runtime получает только строки,
semantic IDs и receipts; единственная variable state операция создаёт opacity
targets. Все группы остаются mounted. Consumer читает видимую opacity всех
групп до admission и передаёт `[visible, to]` первой стадии каждой группы;
последующие стадии сохраняют scalar targets. Reduced motion задаёт конечные
targets с duration 0.

Self-hosted [Lab UI run 41314071704](https://github.com/Labpics-Team/labui/actions/runs/41314071704)
зафиксировал fallback без native animations: admission менял opacity
`0.005 → 0.0263333`, хотя document timeline оставался тем же. Последний
отрисованный кадр и текущий внутренний clock исполнителя различались.
Source probe публичного Motion 0.5.0 ESM воспроизводит этот RED, а явное
видимое начало сохраняет `0.005`; варианты со сбросом и scalar pickup остаются
RED. Пауза и нулевое продвижение clock служат здоровыми контролями.
Это проверка CSS style host, а не browser paint или native WAAPI parity.
Первая стадия задаёт начальное значение, как в публичной модели
[KeyframeEffect](https://developer.mozilla.org/en-US/docs/Web/API/KeyframeEffect/KeyframeEffect).
Семантические effect data по-прежнему содержат только цель; clock и выполнение
остаются у Motion. Полный browser gate нового consumer ещё требуется.

Static SVG и web effect поддержаны. Group transition в Lottie/dotLottie/native
не экспортируется; format request получает точный отказ. Это не обещание
физической compositor-only реализации SVG opacity: browser raster cost и frame
budgets требуют remote measurements.

Bounded source tests проверяют raw endpoints, группирование, единственный
enclosure, отсутствие from/reset, refusals и adversarial geometry/paint/viewport
и compiler mutations. Existing package gate теперь исполняет тот же conformance
oracle в установленном tarball и strict type consumers. Полный build/install,
browser interruption, optical admission и release не объявляются выполненными
по этим source результатам.
