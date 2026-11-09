# Артикуляция авторских Time и History

Исследование 2026-11-03 относится к четырём независимым masters Time/History
закреплённого Figma-снимка. Выбор — подготовленная анатомия двух стрелок и
одна физическая path для положительной заливки. Браузерное качество траектории
и стоимость нового потребителя ещё требуют remote проверки.

## Семантика заливки

[SVG2 §13.4.2](https://www.w3.org/TR/SVG2/painting.html#FillRuleProperty) и
[SVG1.1 §11.3](https://www.w3.org/TR/SVG11/painting.html#FillRuleProperty)
определяют `nonzero`: две простые положительно ориентированные области
внутри одной path дают объединение, включая пересечение. Вращение сохраняет
ориентацию. Compiler проверяет исходную простоту контуров; runtime поворачивает
готовые operands. Boolean union в кадре для этого представления не нужен.
Это вывод из нормативного fill rule, а не измерение raster fidelity.

Для отрицательных стрелок этот же способ неверен. Winding тела `+1` и двух
отверстий `-1/-1` в пересечении даёт `-1`, снова закрашиваемую область.
`evenodd` также превращает два отверстия в XOR. Поэтому Filled Time получает
`COMPOSITION_UNSUPPORTED`. Наличие корректного positive target не переносит
его admission на negative master.

Полярность отверстия при `evenodd` доказывается вложенностью, а не направлением
обхода. Разворот только внутреннего Time Filled контура сохранил все 576
проверенных occupancy результатов, но первоначальный compiler отказал с
`SOURCE_WINDING_UNSUPPORTED`. Исправление принимает все четыре комбинации
outer/counter winding, сохраняя проверки ненулевой площади, простоты и
вложенности. [RED/GREEN receipt](clock-joint-evenodd-regression.json) содержит
точные source digests и область выполненных тестов.

## Анатомия и точка вращения

Прямой разрез сваренного L сохраняет rest, но открывает внутренний острый угол
при повороте отдельной стрелки. `joint.authored-elbow` сохраняет внешние сегменты
master и достраивает скрытые окончания из его собственного elbow. Проверяются
замкнутость, простота, скрытость добавленных сегментов в rest и общая положительная
область вокруг bearing. Координаты bearing выводятся отдельно из каждого
master. Таблицы координат по имени символа нет.

Сертификат относится к сохранению внешней границы rest и соединению стрелок.
Он не утверждает оптическую пригодность всей траектории и C1-гладкость:
микроизломы authored tangent остаются в исходной форме. Малые реальные renders
rest, совпадающих и разошедшихся стрелок, обратного и прерванного движения
являются отдельной проверкой.

[Apple: custom symbol annotations](https://developer.apple.com/documentation/technologyoverviews/annotating-sf-symbols)
позволяет выбрать вращаемые layers и отдельно поставить anchor;
[WWDC25/337](https://developer.apple.com/videos/play/wwdc2025/337/)
объясняет authored attachments и самостоятельные paths. Ни один из прочитанных
источников не обещает автоматическую декомпозицию сваренного L. Доступный
[DocC JSON](https://developer.apple.com/tutorials/data/documentation/technologyoverviews/annotating-sf-symbols.json)
позволил прочитать статью без копирования proprietary artwork.
[CSS Transforms §5–6](https://www.w3.org/TR/css-transforms-1/#transform-box)
различает reference boxes; bbox центр не становится семантическим шарниром.

## Альтернативы и следующий различитель

Повторный path parsing и Boolean clipping на каждый кадр добавляют работу,
которая не нужна для положительного объединения подготовленных limbs.
Независимые SVG paths меняют границу композиции и antialiasing; их визуальная
эквивалентность одной заливке не доказана.

Для отрицательного Filled target применима одна union-силуэтная luminance mask:
чёрные объединённые стрелки вычитаются из белой маски тела. Непрозрачный чёрный
при `mask-type: alpha` не вычитает. Эти правила подтверждают
[CSS Masking §7.10.1, §9](https://www.w3.org/TR/css-masking-1/) и
[SVG1.1 §14.4](https://www.w3.org/TR/SVG11/masking.html#Masking).
Такой target ещё не реализован и не принят. Его различитель — actual master
versus mask render на прозрачном и непрозрачном фоне, rest и пересечениях;
offscreen compositing отдельно измеряется. Переписать отверстия как два
`nonzero` contours недостаточно.

Исполнитель получает числовой канал `elapsed-hours`; Icons задаёт анатомию
и sampler, публичный Motion — время и lifecycle. Изменение геометрического
представления не требует знания внутренних contours от приложения. Само
наличие этого стыка не доказывает native/packed/browser qualification.

[Источник и fingerprints](authored-clock-joint-sources-20261103.json) фиксируют
прочитанные первичные документы. Исходники реализации и bounded тесты находятся
в `scripts/lib/author-clock-joint.js` и `test/author-clock-joint.test.js`.
