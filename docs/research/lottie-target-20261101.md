# Точный векторный экспорт Lottie

Исследование от 2026-11-01 для baseline
`b005801e40edbd19b5288d8a2b9fb609b3142bc0`. Вопрос: как получить
самостоятельную векторную анимацию из авторских частей и принятого жеста,
сохранив форму, countershape, порядок и конечное состояние, без разбора SVG
в установленном приложении.

Выбран отдельный build-time compiler кубических контуров и необязательные
модули `lottie/<icon>`. Геометрия берётся из того же проверенного автора;
траектория — из `compileSymbolEffect`. Конвертер не назначает смысл похожим
контурам. Первое подтверждение совместимости должно относиться к конкретному
`lottie-web` SVG renderer; Canvas и native получают собственную проверку.

## Источники и применимость

- [Lottie specification 1.0.1: shapes](https://lottie.github.io/lottie-spec/1.0.1/specs/shapes/):
  cubic polybezier, порядок, область fill, atomic group opacity.
- [Properties 1.0.1](https://lottie.github.io/lottie-spec/1.0.1/specs/properties/):
  относительные tangents, linear easing и упорядоченные keyframes.
- [Composition 1.0.1](https://lottie.github.io/lottie-spec/1.0.1/specs/composition/)
  и [layers](https://lottie.github.io/lottie-spec/1.0.1/specs/layers/):
  `fr`, `ip`, `op`, integer canvas dimensions, layer transforms.
- [`lottie-web` v5.13.0](https://github.com/airbnb/lottie-web/tree/bede03d25d232826e0c9dca1733d542d8a7754fb):
  GitHub tag прочитан 2026-11-01, commit
  `bede03d25d232826e0c9dca1733d542d8a7754fb`,
  [MIT](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/LICENSE.md).
  Это бесплатный самостоятельный player; аккаунт LottieFiles для него не нужен.
- [dotLottie 2.0](https://dotlottie.io/spec/2.0/): ZIP с manifest и хотя бы одной
  настоящей Lottie animation в `a/`, optional assets, themes и state machines.

Specification описывает формат; runtime admission опирается также на исходники
и действительный render. Страница `latest` меняется, поэтому выводы ниже
ссылаются на датированную specification и pinned player.

## Что допускает авторский корпус

Короткий source census на baseline `b005801` прочитал raw `master` каждого
элемента `semantics/figma-baseline.json` и применил существующий
`parsePathData` только к его `d`. На 2026-11-01 все 660 закреплённых авторских
мастеров используют после нормализации только `M/L/C/Z`: 2075 контуров,
21863 cubic и 12627 line segments. В raw SVG не обнаружены `A`, primitives,
`transform`, `mask`, `clipPath`, `use`, images или text.

Отдельно проверены все 10 аннотированных вариантов baseline `b005801`:
reload/refresh Outline/Filled, ellipsis-horizontal Outline/Filled,
chatbubble-ellipses Outline, volume-high Outline/Filled,
volume-middle Filled. Все используют тот же `M/L/C/Z` domain. Несколько
частей bubble и volume содержат несколько subpaths. Их нельзя независимо
закрашивать: единый SVG path может одновременно задавать тело и отверстие.

Этот census подтверждает возможность точного преобразования текущих path
commands. Он не удостоверяет оптическую приёмку всех мастеров, валидацию
публичного target или семантическое движение source-only вариантов.

## Контуры, заливка и порядок

Lottie path задаётся `v` — vertices, `i/o` — tangents относительно vertex,
`c` — closure. Для исходного cubic `P0,C1,C2,P1` сохраняются
`o(P0)=C1−P0`, `i(P1)=C2−P1`. Line имеет нулевые tangents; её геометрическая
линия сохраняется. Quadratic допускает algebraic degree elevation:
`C1=P0+2/3(Q−P0)`, `C2=P1+2/3(Q−P1)`, если будущий источник её использует.
Winding, направление, начало и набор subpaths сохраняются. `Z` сохраняет
последний closing segment, в том числе cubic, заканчивающийся в начале.

Каждая исходная part становится отдельным shape layer. Все subpaths этой
part находятся в одной области с одним fill: `r=1` для nonzero, `r=2`
для evenodd. [SVGShapeElement](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/elements/svgElements/SVGShapeElement.js#L137)
у pinned player непосредственно устанавливает `fill-rule="evenodd"`.
Массив Lottie layers/shape elements рисуется от конца к началу; исходный
SVG z-order переводится в обратный array order, а semantic part IDs
сохраняются в именах layers.

Сильный контрпример: внешний и внутренний контур с одним evenodd fill
образуют отверстие. Две независимые fills закрасят его. Поэтому export
не строится как «каждый contour — отдельная окрашенная layer». Другой
контрпример — два overlapping paths с alpha 0.5: отдельная opacity и
opacity их composited group дают разный overlap. Семантический contract
должен явно различать part и group. Текущий отказ volume-middle Outline
сохраняется; наличие Lottie group само по себе не расширяет admission
исходного жеста.

Невырожденная elliptical `A` не имеет точного конечного polynomial cubic
представления. Specification предлагает approximation ellipse, но это
не разрешение изменять авторскую кривую. Такой запрос получает явный отказ.
То же касается непроверенных stroke, mask-subtract, gradients, expressions
и неподдержанной композиции. Export не использует image asset для обхода.

## Transform без повторного пересчёта кривых

Layer anchor/position/rotation получает уже объявленный смысл; пути
сохраняют исходные coordinates. Anchor в долях viewBox переводится в
его координатную систему с учётом ненулевого начала.

Это также избегает известной потери точности pinned SVG renderer.
[SVGElementsRenderer:65–85](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/elements/helpers/shapes/SVGElementsRenderer.js#L65)
передаёт identity matrix в path builder, когда path и fill находятся на
одном scope level. Если fill находится вне transformed subgroup, player
встраивает matrix в каждый control point;
[applyToPointStringified](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/3rd_party/transformation-matrix.js#L362)
округляет такой результат до 0.01 units. Отдельная part layer с shapes
и fill на одном level обходит этот путь;
[SVGBaseElement:73–78](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/elements/svgElements/SVGBaseElement.js#L73)
применяет layer matrix и opacity к `<g>`.

Это не обещание bit-exact raster. Player хранит points в
[Float32 point pool](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/utils/pooling/point_pool.js#L8)
и matrices в Float32. JSON conversion сохраняет авторскую кривую algebraically;
runtime precision и antialiasing требуют differential и оптического просмотра.

## Canvas и конечный кадр

Pinned renderer ставит собственный
[composition clipPath](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/renderers/SVGRendererBase.js#L88)
размером `w×h`. CSS `overflow:visible` этот clip не снимает. Для reload/refresh
target canvas должен включать весь путь вращения. Общая консервативная граница
вычисляется из control hull: максимальное расстояние его points от declared
anchor ограничивает всю cubic, а полный rotation — соответствующий диск.
Перевод/размер canvas фиксируются в export metadata; original viewBox и
geometry остаются доступными. Это target viewport adaptation, без подгонки
отдельных glyph coordinates. Fractional canvas bounds округляются наружу
до integer dimensions.

[AnimationItem:299](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/animation/AnimationItem.js#L299)
вычисляет `totalFrames=floor(op−ip)`;
[advanceTime:498–504](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/animation/AnimationItem.js#L498)
останавливает nonloop animation на `totalFrames−1`. Endpoint keyframe
на `t=op` не попадает в естественное завершение. Проверка `goToAndStop(op)`
такой дефект не обнаруживает.

Применяется явная frame convention: motion duration должен точно попадать
на выбранную frame grid, terminal keyframe имеет `t=N`, `op=N+1` содержит
один terminal hold frame. Metadata различает motion duration `N/fr` и
container duration `(N+1)/fr`. Непопавшая на grid длительность получает
отказ вместо молчаливого округления. Для reduced motion материализуется
terminal state без animated properties. Export clip не обещает lifecycle
live state machine или interruptible retarget внутри standalone player.

## Владение данными и стоимость

`compileSymbolEffect` остаётся owner admission, прогресса, reduced motion и
trajectory. Export переводит его rotation targets или opacity stages в
упорядоченные linear keyframes. Он не содержит новую таблицу жестов и
не импортирует Lab Motion executor. Runtime symbol module хранит только
precompiled target contours и свой semantic input. Static `symbols/*`
и root SVG imports не получают Lottie geometry/parser/player.

Geometry compilation выполняется на build; installed consumer не разбирает
`d`, не угадывает parts и не читает полный IR catalog. `lottie-web` остаётся
необязательным dependency приложения или проверочного harness. Измерение
shipping bytes должно выполняться на реальном one-icon consumer после pack.

Player имеет значимую mutability boundary:
[DataManager:159–166](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/utils/DataManager.js#L159)
меняет supplied `i/o` arrays, прибавляя `v` для absolute tangents. Fallback
worker proxy не делает structured clone. Поэтому factory возвращает свежие
mutable JSON arrays для каждого создания. Compiled template не отдаётся
player напрямую; freeze/clone проверяется с повторным load и export.

## Альтернативы и проверка перед admission

SVG с существующим Lab Motion остаётся более простым live consumer:
currentColor, accessibility и interruption уже имеют владельцев. Lottie
добавляет portable animation asset для дизайна/других исполнителей;
поэтому optional export имеет отдельный модуль. Общий SVG→Lottie importer
несёт более широкий CSS/filter/stroke contract и риск hidden approximation.
Для нашего versioned source domain собственный маленький converter покрывает
остаток без такого importer. dotLottie packaging рассматривается после
реального Lottie JSON; самостоятельный ZIP со SVG не принимается.

ThorVG — сильная бесплатная альтернатива для native/Canvas, а не эквивалентное
доказательство. Его [current support matrix](https://github.com/thorvg/thorvg/wiki/Lottie-Support)
заявляет paths, nonzero/evenodd, transforms и opacity. Исторический
[maintainer counterexample #2061](https://github.com/thorvg/thorvg/issues/2061)
показывает, как одинаковый JSON потерял отверстие из-за неверного scope fill;
ошибка исправлена в 0.12.10. Это доказательство необходимости renderer/version
qualification, не утверждение о текущей неисправности.

До admission требуется настоящий pinned-player test на self-hosted runner:

1. Installed one-icon export создаёт Lottie JSON, load проходит без private
   source imports. Independent oracle читает raw Figma master и annotation;
   target contour arrays не используются как собственный oracle.
2. Static и кадры 0/interior/terminal сравниваются с авторским SVG и
   semantic pose на 16/24/48, с отдельным просмотром countershape, speaker,
   shell, веса и recognizability. Subframe interiors проверяют actual pivot.
3. Natural nonloop completion, reverse interval, reduced motion, terminal
   hold и canvas clipping проверяются отдельно. Оба RGB цвета разрешаются
   явно; standalone JSON не наследует CSS currentColor автоматически.
4. Negative controls: неверный source/capability receipt, unsupported
   composition/arc/gesture/duration; sabotage winding/fill/z-order/anchor,
   endpoint `op`, canvas bounds и mutable template должен обнаруживаться.
5. Repeated create/load/export не меняет исходные templates; игрок после
   destroy освобождает свой DOM. Pack/bundle проверяет закрытость imports и
   отсутствие parser/catalog/player в static path.

В этом исследовании не выполнялись full build, нагрузочный benchmark или
player differential test. Рекомендация проверена первичными sources и
source census; экспортная capability остаётся закрытой до consumer proof.
