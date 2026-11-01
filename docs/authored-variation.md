# Авторские точки: размер и расстояние

`symbols/ellipsis-horizontal` и `symbols/ellipsis-vertical` сохраняют независимые
Outline/Filled masters Figma `2416636003859748575`. Два множителя меняют настоящие
кубические контуры каждой точки:

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/ellipsis-horizontal';
import { renderGlyphSvg } from '@labpics/icons/ir/render';

const symbol = glyph({
  variant: 'filled',
  variation: { dotScale: 1.1, spacingScale: 0.9 },
});
const svg = renderGlyphSvg(symbol, { instanceId: 'loading' });
const domain = glyphCapabilities('filled').variation.domain;
```

`dotScale` меняет размер каждой точки относительно её собственного авторского
центра. `spacingScale` меняет продольное расстояние между центрами, сохраняя среднюю
точку. Оба default равны 1. Запрос без variation, пустая variation и пара 1/1
возвращают тот же неизменяемый авторский объект; исходные `d` не пересериализуются.
В `source-only` любое отличное от default значение отвергается.

Build compiler получает смысл частей из `semantics/author-anatomy.json`, сверяет
raw master и path receipts и компилирует только три самостоятельных положительных
контура `MCCCCZ`. Он сохраняет все исходные operands, включая разные экстремумы
Filled dots. Runtime получает готовые точки, pivots и коэффициенты; он не разбирает
`d` и не ищет предполагаемые части. Потребитель задаёт только размер и расстояние.

Область `domain` — пересечение линейных неравенств по двум положительным
множителям. Каждое имеет вид
`dotScaleCoefficient*dotScale + spacingScaleCoefficient*spacingScale >= minimum`:
коэффициенты названы `dotScale` и `spacingScale` в `constraints`. Minimum gap и
поля берутся из `semantics/grid.json`; receipt содержит версию и SHA-256 этой
policy. Control hull даёт достаточную границу для cubic curve. Это геометрическая
охранная область; авторская визуальная приёмка всего её диапазона не заявлена.
Runtime дополнительно проверяет материализованные Number controls, чтобы
округление или схлопывание слишком малой формы не стало успешным результатом.

Nondefault имеет `provenance.kind = 'authored-variation'`: исходный master,
анатомия, версия закона, digest скомпилированной геометрии и эффективные значения
сохранены. Это вариация авторских частей; конструктивные модели, StyleProfile и
optical sizing остаются отдельными возможностями.

| Запрос | Машинный отказ |
|---|---|
| Неположительный, бесконечный или неизвестный параметр | `INVALID_VARIATION` |
| Gap либо canvas margin нарушен | `VARIATION_OUTSIDE_DOMAIN` |
| Number-представление схлопнуло точку | `VARIATION_UNREPRESENTABLE` |
| Скомпилированные части и master не соответствуют друг другу | `VARIATION_SOURCE_MISMATCH` |
| Необъявленное семейство, включая ellipse/chatbubble | `AUTHOR_VARIATION_UNSUPPORTED` |
| Nondefault в `source-only` или запрос model axes | `AUTHOR_PARITY_REQUIRED` |
| Передача variation существующему Lottie target | `VARIATION_UNSUPPORTED` |

Horizontal сохраняет stable part IDs и существующие opacity-жесты activity/idle;
изменение формы не меняет эти цели движения. Vertical имеет только семантические
части геометрии, без loading-жеста. Outline/Filled не объявлены совместимыми
морфинг-мастерами. Прерывания и исполнение принадлежат потребителю движения.
SVG и GlyphIR содержат изменённую геометрию. Lottie/SF Symbols target для неё
не допущен; Lottie явно отказывает, сохраняя существующий export точного default.

Контракт проверяют `test/authored-variation.test.js` и installed positive/negative
controls в `scripts/check-package-artifact.js`. Они не удостоверяют визуальное
качество 16/24/48 или browser-производительность. Математическое основание и
исключённые circle replacements: [исследование](research/authored-cubic-family-20261102.md).
