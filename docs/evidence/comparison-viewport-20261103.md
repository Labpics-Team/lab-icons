# Экранный viewport авторского сравнения

CI [41572424283](https://github.com/Labpics-Team/lab-icons/actions/runs/41572424283)
проверял head `6d025d6f25d3b847b988d7300794ba7aba70e46a` через merge source
`acb47dd2161be4ebb79abd24c7118f4773b29795`, Chromium `156.0.8078.4`.
`explorer-journey.json` отказал на
`ellipsis-horizontal/outline/variation/overlay/authored-viewport-scaling`.
Оба вложенных SVG имели `width="24"`, `height="24"`, `viewBox="0 0 24 24"`
и одинаковую экранную матрицу
`[4.666666666666667, 0, 0, 4.666666666666667, 1194.5, 269.5]`.
Computed width/height были `auto`; прежний `parseFloat()` давал `NaN`.
Архив отказа: artifact `13202840030`, SHA-256
`80ec00181db90d7c65eff016f58a9fc3ca3b34529095dbf290b6c6aa48058c23`.

Это подтверждённая ошибка oracle, а не основание изменять рисунок или CSS.
В Chromium [facfdaa6](https://github.com/chromium/chromium/commit/facfdaa6ef8631887757836f560bd5b3c9970899)
от 2026-04-10 CSS width/height перестали применяться к вложенному SVG.
Изменение следует из [решения SVG WG](https://github.com/w3c/svgwg/issues/1057)
и [правки спецификации](https://github.com/w3c/svgwg/pull/1059).
[CSSOM](https://drafts.csswg.org/cssom/#resolved-values) возвращает computed value,
когда свойство не применяется к элементу. [SVG viewport](https://www.w3.org/TR/SVG2/coords.html)
при этом сохраняет собственные dimensions, viewBox и преобразование координат.
Источники прочитаны 2026-11-03.

Исправленный journey читает intrinsic dimensions и `getScreenCTM()`.
Он сравнивает четыре угла всех вложенных viewport с внешним SVG в CSS pixels,
проверяет исходный production viewBox и отвергает отсутствующую, вырожденную
или неконечную матрицу. Допуск `0.001 CSS px` относится к измерению браузера;
он не разрешает изменение геометрии. CSSOM width/height сохраняются в diagnostics.
Исходные пути, цвета, маски и численные бюджеты не меняются.

Девять адресных source tests прошли: реальный `auto` контрпример, изменение всех
шести коэффициентов, неверные dimensions/viewBox, отсутствующие observations,
смещённая система координат и внешний поворот. Это проверка oracle;
полный новый browser journey остаётся обязательным удалённым гейтом.

Независимое ревью обнаружило дополнительный пробел: DOM `getScreenCTM()` внутри
mask не наблюдает преобразование `maskContentUnits="objectBoundingBox"` при
painting. [CSS Masking §9.1](https://drafts.csswg.org/css-masking-1/#the-mask-element)
и [Chromium SVGMaskPainter](https://raw.githubusercontent.com/chromium/chromium/facfdaa6ef8631887757836f560bd5b3c9970899/third_party/blink/renderer/core/paint/svg_mask_painter.cc)
определяют этот отдельный instance context. Например, bbox `[5,11,14,2]`
превращает точку `[12,12]` в `[173,35]` при прежней DOM-матрице.
Renderer теперь явно задаёт userSpaceOnUse для области и содержимого обеих масок.
Journey проверяет оба basis, luminance и полные границы области; regression
отвергает смену content units при неизменных viewport snapshots. Default painting
сохраняется. Дополнительные source controls и новый remote journey проверяются
после этой правки; прежний viewport review FAIL не объявляется PASS.
