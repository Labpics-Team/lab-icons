# Авторские точки: размер и расстояние

`variations/ellipsis-horizontal` и `variations/ellipsis-vertical` сохраняют независимые
Outline/Filled masters Figma `2416636003859748575`. Два множителя меняют настоящие
кубические контуры каждой точки:

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/variations/ellipsis-horizontal';
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

Обычный `symbols/<id>` возвращает точный source glyph и source capabilities.
Он не загружает variation domain или геометрический runtime; запрос `variation`
возвращает `AUTHOR_VARIATION_UNSUPPORTED`. Вариативность выбирается явным
синхронным импортом `variations/<id>`. Default в обоих путях — один frozen
source объект, с теми же author/anatomy receipts. Общие данные компилируются
в закрытый модуль одного символа; потребитель использует только публичные пути.

Возможности проверяются для запрошенного начертания через
`glyphCapabilities('outline' | 'filled')`. Наличие family entrypoint само по
себе не является обещанием поддержки всех начертаний или осей. Текущие dots
имеют доказанные независимые формы обоих начертаний; это условие их закона,
не универсальное правило для будущих семейств.

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

## Поворот многоточия

`states/ellipsis-orientation-outline` и `states/ellipsis-orientation-filled`
соединяют горизонтальное и вертикальное многоточия внутри одного начертания.
Каждая исходная команда и её численные параметры имеют явное соответствие;
переход меняет `d` крайних точек. Средняя точка сохраняется буквально.

```ts
import { compileStateEffect, renderStateSvg } from '@labpics/icons/states/ellipsis-orientation-filled';
import { prepareContourStateEffect } from '@labpics/icons/motion';
import { value } from '@labpics/motion';

// SVG содержит data-part для адресации существующих paths.
const initial = renderStateSvg('horizontal');
if (!initial.ok) throw new Error(initial.reason.code);
container.innerHTML = initial.svg;

const result = compileStateEffect('vertical', { duration: 300, from: 0 });
if (!result.ok) throw new Error(result.reason.code);
const prepared = prepareContourStateEffect(result.effect);
if (!prepared.ok) throw new Error(prepared.reason.code);
const paths = new Map([...container.querySelectorAll<SVGPathElement>('path[data-part]')]
  .map(path => [path.dataset.part!, path]));
const progress = value(result.effect.from);
const unsubscribe = progress.subscribe(p => {
  const pose = prepared.sample(p);
  if (!pose.ok) throw new Error(pose.reason.code);
  for (const part of pose.parts) paths.get(part.partId)!.setAttribute('d', part.d);
});
progress.animate(result.effect.to, {
  duration: result.effect.options.duration,
  ease: 'linear',
});
// При удалении компонента: unsubscribe(); progress.dispose();
```

`from` и аргумент `sample()` — положение в общем семействе: 0 соответствует
горизонтальному состоянию, 1 вертикальному. Для разворота исполнитель читает
`progress.get()`, составляет новый эффект с этим `from` и анимирует ту же шкалу
к новому `to`. Готовый sampler остаётся тем же для всего интервала. Прерывание,
часы и освобождение подписки принадлежат публичному Motion API.

`prepareContourStateEffect()` один раз копирует и проверяет переносимый пакет:
фиксированные `MCCCCZ`, конечные пары чисел, замкнутость и численное совпадение
точных строк концов с векторами. JSON-перенос и отдельная установленная копия
пакета поддержаны. Проверка представления не удостоверяет авторство внешних
данных; авторские receipts и геометрическое доказательство проверяет build compiler.
Он требует буквальные абсолютные `MCCCCZ`, совпадение строки с raw master и
длину до 4096 символов. Начальное relative `m`, неявные повторения `C` и более
длинные строки возвращают `CORRESPONDENCE_UNAVAILABLE` при сборке.
В кадре sampler только интерполирует числа и записывает строку. При 0/1 он
возвращает исходные `d` без форматирования.

Для перехода принят exact default: variation отсутствует, пуста либо содержит
множители 1. Отличные от 1 положительные множители возвращают
`VARIATION_UNSUPPORTED`; ошибочные параметры — `INVALID_REQUEST`.
Безопасность отдельных конечных форм не доказывает зазор при их сближении.
`stateCapabilities().proof` содержит точные рациональные границы для всех пар
точек и бюджета округления. Lottie, dotLottie и SF Symbols transition возвращают
`FORMAT_UNSUPPORTED`. Горизонтальные activity/idle и отсутствие loading у
вертикального меню сохраняются.

Тест `test/authored-contour-states.test.js` проверяет исходные строки, перенос,
обратный ход, отказы и опасную промежуточную форму. Приёмка браузерного
исполнения, размеров 16/24/48 и оптического качества проводится отдельно.
