# Основания платформы символов

**Diátaxis:** explanation. Проверено 2026-11-01. Этот файл хранит источники и решения для текущего среза; состояние задач находится в agents-config/plans/product-lab-icons.

Цель сравнения — сохранить авторскую форму и сделать части, оптику и движение пригодными для разных consumers. Количество общих recipes, формат файла и зелёная геометрическая проверка не доказывают качество системы.

## Авторская форма и оптика

Текущий master — Figma `🧪Lab UI (v2.1)`, key `LuaiBd4anRi4DMZayKAnY2`, version `2416636003859748575`, lastModified `2026-11-01T01:18:02Z`. Страница Icons `4045:632` содержит 330 семейств/660 вариантов; репозиторий baseline `03a4ca3ac1bf7978f9e8f554106c132a69668afb` — 238 семейств, 85 modeled/153 source-only. Metadata/census подтверждают область; они ещё не подтверждают fidelity полного экспорта.

[Apple SF Symbols](https://developer.apple.com/sf-symbols/) на дату чтения описывает более 7000 символов, 9 весов, 3 масштаба и новые designs для OS 27. [WWDC25, SF Symbols 7](https://developer.apple.com/videos/play/wwdc2025/337/) — другой датированный источник: он показывает Draw, Variable Draw и matching enclosures. Его версия не считается названием текущего downloadable release автоматически.

Apple подчёркивает точную outlined форму вместо общего stroke: это сохраняет пропорции, negative space и локальную оптику. Поэтому uniform dilation, общий stroke-width и automatic trace старого SVG не принимаются как способ восстановить latest author drawing. Полезный общий закон проверяется на настоящих участниках и на false-unification counterexample; особенности master остаются у владельца формы.

[OpenType 1.9.1, opsz](https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxistag_opsz) определяет optical size как изменение дизайна для размера текста: пропорции, stem weights и детали зависят от рисунка, script, устройства и расстояния. Это не масштабирование итоговых координат. [FreeType glyph metrics](https://freetype.org/freetype2/docs/glyphs/glyphs-3.html) отдельно определяет baseline, bearings, advance и bbox: одинаковый bounding box не даёт одинаковый оптический центр или выравнивание с текстом.

Решение: preserve exact independent Outline/Filled masters; оси меняют только доказанные конструктивные законы и получают явные domains/refusal. Default и экстремумы смотрятся как изображения на 16/24/48 и целевых размерах. Numeric occupancy/boundary metrics помогают обнаружить изменение, но не компенсируют ухудшение формы.

Сильная альтернатива — variable font. [OpenType variations](https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview) даёт компактные axes/interpolation, но сам font не выражает весь semantic state/part graph и format-specific animation. Font остаётся возможным target compiler, а не новым geometry owner. Выбор пересматривается, если конкретный native/text consumer воспроизводимо выигрывает с сохранённой анатомией и поддержанными состояниями.

## Топология и correspondence

[fontTools varLib.interpolatable](https://fonttools.readthedocs.io/en/latest/varLib/interpolatable.html) проверяет неверный порядок контуров и другие проблемы между masters. Его existence опровергает допущение «одинаковое количество точек означает корректную интерполяцию». Закрытость, winding, start point/order, countershape и семантическое соответствие — разные свойства.

[SVG 2 painting](https://www.w3.org/TR/SVG2/painting.html) различает fill и stroke. При композиции `mask-subtract` контракт Lab Icons остаётся `union(base) − union(subtractors)`, а не попарный XOR. Исполнителю не требуется заново угадывать hand/counter из готового path: stable part/contour IDs и параметры передаются компилятором.

Решение: morph разрешается только после явного correspondence/topology proof. Resampling arbitrary paths, bbox matching и автоматическое соединение nearest contours отвергнуты как default. Когда topology различается, honest composition/replacement сохраняет unchanged enclosure и заменяет только изменившиеся части. Проверяемый пересмотр: новый declared mapping сохраняет negative space и identity на полном trajectory, включая interruption.

## Семантика движения

WWDC25 объясняет, почему Draw не эквивалентен `stroke-dashoffset`: variable-width outlined формы требуют собственных guide points, направлений, corner points, attachments и end-cap поведения. Минимум два guide points задают начало и конец; attachment требует отдельно нарисованного элемента. Некоторые multi-subpath формы не поддерживают bidirectional Draw. Guide-point order должен совпадать между template weights. Только явно участвующие layers получают Variable Draw.

Решение: generic spin/fade не назначается всему каталогу. Clock использует реальные anchors рук; draw/progress получают authored annotations; state replacement сохраняет доказанную общую оболочку. Наличие частей не равно поддержанному gesture или morph. До полной аннотации возвращается точный отказ.

Реализация выявила отдельную достаточную границу: source geometry может иметь
принятую семантическую анатомию до параметрической реконструкции. У актуальных
`reload` и `refresh` оба начертания содержат по одному замкнутому целому контуру.
Закон `cycle.clockwise` с явно объявленным центром canvas сохраняет каждый `d`
без splitting или trace. Аннотация связывается с file/version/master/path hashes;
конструктор компилирует её в существующие source parts и motion capabilities.
Оси остаются неподдержанными. Это не разрешение вращать все одноконтурные SVG:
смысл цикла задаётся конкретной декларацией и проходит отдельное review.

Контрпример — новая `time`: Outline имеет сваренный L и отдельный круг; Filled
имеет диск и L-вырез. Ригидное вращение L не воспроизводит независимые руки
360°/30°. Этот случай отвергнут тем же intake, а не скрытым исключением имени.
Для циклического силуэта также проверяется
[SVG overflow](https://www.w3.org/TR/SVG2/render.html#OverflowAndClipProperties):
поворот может выходить за исходный viewBox. Выход эффекта явно требует visible
overflow вместо изменения авторской формы или размера. Compositor-only claim
без runtime trace по-прежнему не делается.

[CSS transform-box](https://developer.mozilla.org/en-US/docs/Web/CSS/transform-box) связывает transform-origin с chosen reference box. Для viewBox anchor применяется `view-box` и origin в той же системе координат; `fill-box` около центра bounding box руки даёт другой физический pivot. [WAAPI reverse](https://developer.mozilla.org/en-US/docs/Web/API/Animation/reverse) сохраняет current playhead, но запускает paused animation обратно. [commitStyles](https://developer.mozilla.org/en-US/docs/Web/API/Animation/commitStyles) записывает текущие вычисленные стили перед освобождением effect; бесконечно filling effects удерживают приоритет над дальнейшим styling.

Lab Icons владеет эффектом как данными. Consumer связывает part ID с DOM/target и публичным Lab Motion execution. Новый scalar state берётся от текущей позы; новый authored `[from,to]` occurrence имеет другую семантику и не выдаётся за непрерывный retarget. Порядок cleanup и successor admission проверяется на interruption/new state, а не на одном завершённом проигрывании.

## Реальный контракт Lab Motion и Lab UI

Source Lab Motion `fab88e626c12a4028126e64df3c0e7d1391495cb` объявляет 0.6.0. На дату чтения npm latest — 0.5.0. [Проверенный tarball](https://registry.npmjs.org/@labpics/motion/-/motion-0.5.0.tgz) имеет integrity `sha512-HtZceGmhBc4ldefBRpW6mg0cTLSINsyH1fXGKm9TXn57btjTnA3LPwq41Rdkd+cWWd2dA3qXGulPnJo+EcRFlQ==`; downloaded SHA-512 совпал.

Его root экспортирует `animate`, `sequence`, `scope`, `layout`, `value`; `animate(hand, {rotate: degrees}, {duration: milliseconds, ease: 'linear', reducedMotion: 'user'})` принадлежит public contract. Property `transform` явно отказана packaged validator; `rotate` — числовой transform channel. Controls 0.5.0: `pause/play/seek/stop/finish`, `finished` и `state`. `reverse/time/timeScale` из main 0.6.0 не обещаются consumer версии 0.5.0. Возврат к предыдущему state выполняется новым scalar target, а не вызовом отсутствующего метода.

[Motion composition contract](https://github.com/Labpics-Team/lab-motion/blob/fab88e626c12a4028126e64df3c0e7d1391495cb/docs/motion-contract.md) различает state/event/geometry и закрепляет одного renderer owner всей transform-поверхности. State можно дедуплицировать по принятой цели; event occurrence повторяется при прежнем конечном state. Cancel не означает revert application state. Scalar handoff не является автоматической гарантией rendered-pixel C¹ при нелинейной геометрии или authored jump.

[Lab UI](https://github.com/Labpics-Team/labui/tree/1cc4d062ecacc826b47d635ff2b5cb90a70c449f) владеет core Web Components и адаптерами. Icons поставляет geometry/semantics через public artifact; компоненты и motion execution не копируются в эту библиотеку. Установленный пакет и пройденный реальный UI journey проверяются отдельно от source declaration.

## Форматы и физическая стоимость

[Lottie shape model](https://github.com/lottie/lottie-spec/blob/main/docs/specs/shapes.md) задаёт собственные ordering/style/group/transform semantics; [animated properties](https://github.com/lottie/lottie-spec/blob/main/docs/specs/properties.md) имеют упорядоченные frame-keyframes. [dotLottie 2.0](https://dotlottie.io/spec/2.0/) — ZIP-контейнер с manifest, Lottie JSON, optional themes/state machines/assets. ZIP-упаковка SVG или effect JSON сама по себе не становится Lottie animation.

[lottie-web feature matrix](https://github.com/airbnb/lottie-web/wiki/Features) объявляет различия renderer support: additive masks поддержаны, другие masks лишь partial, track matte не одинаково доступен в SVG/Canvas/HTML. Filled clock с mask-subtract поэтому требует target-specific render proof; универсальный export flag был бы ложным обещанием. Native SF custom annotations аналогично не выводятся только из SVG path.

Решение: каждый adapter потребляет ту же анатомию/trajectory, сообщает supported domain и точно отказывает неполному преобразованию. Transform-only эффект не доказывает GPU/compositor-only: animated mask может требовать raster recomposition. Это различает real browser trace на runner.

Для default static import сильнее всего исключить целый класс работы: one-symbol generated module не включает eager catalog, повторное authoring parsing и motion execution. Shared pure compiler отделяется от registry; existing dynamic catalog API сохраняется для полного explorer. Packed typed geometry, laziness, font/GPU/WASM и свой scheduler не получают default status без измеренного consumer преимущества.

Benchmark ещё не выполнен в этом исследовании. Claim заказчика ~798 KB raw/~121 KB gzip проверяется against exact baseline/head. Protocol включает 1/100/10000 symbols, raw/gzip/brotli, cold/warm import/compile/render, DOM/memory, transition latency/frame/interruptions и cleanup; повторы и разброс сохраняются. Heavy work выполняется на штатной self-hosted ёмкости, не на рабочей машине.

[Организационный testing contract](https://github.com/Labpics-Team/.github/blob/main/docs/testing.md) сохраняет полный применимый набор и exact-version results; skipped/cancelled/timeout не являются PASS. Executor принадлежит [ARC](https://github.com/Labpics-Team/labpics-infra/blob/main/services/github-runners/arc/README.md). Linux не выдаётся за native Windows/macOS. [Delivery contract](https://github.com/Labpics-Team/.github/blob/main/docs/delivery.md) отделяет проверенный source, artifact и работающую версию; отсутствие Zuul merge reporter не назначает ему доставку.

## Скалярная шкала loading и typing

В источниках `ellipsis-horizontal` обе формы содержат три самостоятельных пути.
У Outline `chatbubble-ellipses` paths 0–2 — точки, path 3 — оболочка. У Filled
того же семейства один evenodd path совмещает четыре контура; слепое разбиение
изменило бы смысл countershape. Вертикальное троеточие имеет ту же триаду путей,
но используется как меню. Геометрическая похожесть не назначает activity.

Закон `activity.triad` сохраняет `d` и z-order. В нормализованном цикле точки
сначала снижают opacity с 1 до 0.35 к фазе 1/12, затем по очереди достигают 1
на фазах 2/12, 5/12, 8/12 и возвращаются к полной непрозрачности к фазе 1.
Loading и typing потребляют одну шкалу; координатных исключений у иконок нет.
Opacity не требует фиктивного якоря. Idle выражается отдельным semantic state
той же анатомии и восстанавливает все точки до opacity 1.

[Runtime опубликованной версии 0.5.0](https://github.com/Labpics-Team/lab-motion/blob/68825562824353bca377e00a3107895796229ff4/src/motion/runtime.ts)
и [публичные типы](https://github.com/Labpics-Team/lab-motion/blob/68825562824353bca377e00a3107895796229ff4/src/motion/types.ts)
подтверждают `sequence` с миллисекундами `at/duration`. Первый scalar использует
текущую Surface pose, дальнейшие этапы — финал предыдущего. Массив значений
записывает явное начало синхронно и может вызвать скачок при interruption;
`null` как placeholder отвергается. Выбран scalar-stage эффект v2, который
потребитель передаёт штатному sequence. Lab Icons не добавляет scheduler.

`from/to` обрезают и при необходимости разворачивают semantic phase interval.
Начало нового sequence подхватывает текущую непрозрачность; reduced motion
материализует terminal targets. Это C0 pickup текущей позы, без обещания C1 или
точного обращения playhead. Публичный root Playback 0.5.0 не имеет `reverse()`.
Native `./waapi` остаётся альтернативой, но добавил бы собственный lifecycle и
reduced-motion handling. Multipoint root sequence использует scheduler;
compositor-only claim поэтому не делается.

## Ограничения исследования

Primary Apple HIG/annotation страницам clean-text fetch вернул только оболочку. Конкретные Draw/annotation/enclosure assertions выше взяты из полного официального WWDC25 transcript и current SF Symbols overview. Полный экспорт закреплённой Figma-версии сохранён в [авторской основе](../evidence/figma-20261101.md). Полная оптическая приёмка, runtime performance и target fidelity остаются открытыми; внешние источники не подменяют их проверку.
