# Составная авторская заливка в Lottie

**Diátaxis:** explanation. Источники прочитаны 2026-11-03.

Filled `mic-circle` содержит один авторский `evenodd` path. Анатомия называет
обрамление, стойку и корпус отдельно; стойка и корпус здесь являются отверстиями.
Эти ID нужны модели, но не назначают три независимые положительные заливки.

В [CI исходного `d703b7b`](https://github.com/Labpics-Team/lab-icons/actions/runs/41641484315)
настоящий packed consumer остановился на `COMPOSITION_UNSUPPORTED` для статического
Filled `mic-circle`. Текущий adapter принимал только `layers`, а consumer требовал
успешного экспорта всех аннотированных вариантов. Запрос не содержал ширины или
жеста. Это ограничение target, а не невозможность формата.

## Почему используется общий fill

[Lottie specification 1.0.1, shapes](https://lottie.github.io/lottie-spec/1.0.1/specs/shapes/)
назначает style предшествующим shapes в одном scope; [constants](https://lottie.github.io/lottie-spec/1.0.1/specs/constants/)
задаёт `r=2` для even-odd. В закреплённом `lottie-web` 5.13.0,
commit `bede03d25d232826e0c9dca1733d542d8a7754fb`,
[SVGElementsRenderer](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/elements/helpers/shapes/SVGElementsRenderer.js#L86)
собирает subpaths в общий `styles[l].d`, а
[SVGShapeElement](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/elements/svgElements/SVGShapeElement.js#L137)
задаёт этому SVG path `fill-rule=evenodd`.

Существующий adapter получает composition из IR при сборке. Он сохраняет
ID, anchors, порядок и все контуры; целый compound выпускается с одним fill.
Обычные `layers` сохраняют прежнюю независимую заливку каждой части. Runtime
не разбирает SVG и не вычисляет принадлежность отверстий по координатам.

Раздельная заливка counters закрасила бы отверстия. Перенос в subtract-mask
тоже неверен: пересечение двух отверстий в even-odd снова даёт краску.
Новый renderer не устраняет ошибку владения заливкой и требует отдельной
квалификации; текущий SVG player уже имеет нужную операцию.

## Граница точности и проверки

Player материализует control points в
[Float32Array](https://github.com/airbnb/lottie-web/blob/bede03d25d232826e0c9dca1733d542d8a7754fb/player/js/utils/pooling/point_pool.js#L8).
Сохранение исходных cubic contours не обещает побайтной binary64 точности
после загрузки player. Существующий raster gate сравнивает каноническую
binary32 cubic-проекцию при 16/24/48 px; отдельные `nativeRaster` наблюдения
сохраняют сравнение с исходным SVG. Их численный PASS не входит в этот gate.
Оптическая приёмка авторского рисунка остаётся самостоятельным результатом.

Новые отрицательные browser controls сохраняют цвет и остальные контуры,
но удаляют объявленный counter либо разделяют общий fill на положительные
слои. Оба должны получить предметный raster failure после успешного
положительного контроля целого compound. До завершения удалённой проверки
поддержка представления не объявляется проверенной поставкой.

Статический export не разрешает независимое движение отрицательной части.
Жесты проверяет существующий motion owner; изменённая геометрия и
непредставимые SVG arcs сохраняют явный отказ. Контуры, anchors и пределы
сравнения ради прохождения проверки не изменяются.
