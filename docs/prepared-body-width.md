# Плавное изменение ширины микрофона

`gestures/mic` и `gestures/mic-circle` предоставляют подготовленную вариацию
корпуса для Outline и Filled. Она использует тот же `capsule.width`, что
статический `variations/<имя>`. Высота корпуса сохраняется; у полого корпуса
сохраняется разница ширин внешнего и внутреннего контуров. Обрамление и опора
остаются на месте. Каждый вариант начинается со своего авторского рисунка.

```ts
import { prepareBodyWidth } from '@labpics/icons/gestures/mic-circle';

const result = prepareBodyWidth('filled');
if (!result.ok) throw new Error(result.reason.code);
const prepared = result.prepared;

host.innerHTML = prepared.svg;
const path = host.querySelector<SVGPathElement>(prepared.renderTarget.selector);
if (!path) throw new Error('SVG target отсутствует');

let visibleWidth = 1;
function writeWidth(bodyWidth: number) {
  const pose = prepared.sample(bodyWidth);
  if (!pose.ok) throw new Error(pose.reason.code);
  path!.setAttribute(prepared.renderTarget.attribute, pose.d);
  visibleWidth = pose.bodyWidth;
}
writeWidth(0.9);
```

Подготовьте SVG и sampler один раз. Исполнитель движения изменяет число
между `prepared.domain.minimum` и `prepared.domain.maximum` и вызывает
`writeWidth`. При развороте или новом запросе начните следующий интервал
с `visibleWidth`: это значение последней успешно записанной формы. При reduced
motion запишите конечное допустимое значение сразу. Часы, прерывание и очистка
подписки остаются в публичном API исполнителя, например Lab Motion `value()`.

В Filled `mic-circle` корпус является отверстием внутри одного `evenodd` path.
`sample()` возвращает полный физический `d`, включая неизменные контуры круга
и опоры. Применяйте его к указанному `renderTarget`, чтобы сохранить прозрачность.
`unchangedPartIds` перечисляет части, которые программа сохраняет.

При `bodyWidth: 1` sampler возвращает исходный `d` буквально. В текущем
допуске ширина находится в диапазоне `[0.8, 1]`; код читает его из `domain`.
Неконечное либо нечисловое значение получает `INVALID_REQUEST`, выход за
диапазон — `VARIATION_OUTSIDE_DOMAIN`. Автоматического ограничения числа нет.
Неизвестное начертание получает `INVALID_REQUEST`, недоступное —
`VARIANT_UNSUPPORTED`.

`motionCapabilities(variant?)` из того же entrypoint сообщает `capsule.width`,
допуск, author/anatomy receipts и форматы `svg` и `prepared-width`. Metadata
импортируется отдельно от программы формы при tree shaking. Подготовленный
width target не предоставляет rotation-жест или экспорт изменённой формы
в Lottie/SF Symbols. Переход между разными иконками требует отдельного
геометрического соответствия.

В кадре вычисляются координаты из подготовленных operands и строка path.
Разбор исходного SVG, построение GlyphIR и вычисление fingerprint в кадре
не нужны. Для статического потребителя используйте прежний `symbols/<имя>`;
для одноразовой материализации с provenance — `variations/<имя>`.
