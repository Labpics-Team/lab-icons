# Движение авторских стрелок

`gestures/time` и `gestures/history` предоставляют `prepareClockHands()`.
Параметр `elapsedHours` задаёт ход времени от исходной авторской позы:
минутная стрелка делает оборот за час, часовая — за двенадцать часов.
Это относительное движение; календарное время приложение переводит в этот
параметр самостоятельно.

```ts
import { prepareClockHands } from '@labpics/icons/gestures/time';

const result = prepareClockHands('outline');
if (!result.ok) throw new Error(result.reason.code);
const prepared = result.prepared;

host.innerHTML = prepared.svg;
host.querySelector('svg')!.setAttribute('aria-hidden', 'true');
const path = host.querySelector<SVGPathElement>(prepared.renderTarget.selector);
if (!path) throw new Error('SVG target отсутствует');

let visibleHours = 0;
function writeHours(elapsedHours: number) {
  const pose = prepared.sample(elapsedHours);
  if (!pose.ok) throw new Error(pose.reason.code);
  path!.setAttribute(prepared.renderTarget.attribute, pose.d);
  visibleHours = pose.elapsedHours;
}
writeHours(0.5);
```

Подготовьте SVG и sampler один раз. Исполнитель движения изменяет числовой
канал и вызывает `writeHours`. При новом запросе начните интервал с
`visibleHours`, последнего успешно записанного значения. Сначала снимите
подписку предыдущего движения, затем остановите его; устаревший исполнитель
не должен записать форму после нового. При reduced motion запишите конечное
значение сразу. Планирование, pause, seek и cleanup выполняются через публичный
API исполнителя, например Lab Motion `value()`.

Нулевое значение и целое число двенадцатичасовых оборотов возвращают исходный
`d` буквально. Отрицательные значения задают обратный ход. Неконечный или
нечисловой параметр получает `INVALID_REQUEST`. Sampler возвращает переданное
число в `elapsedHours`; периодичность геометрии не меняет состояние приложения.

Обе стрелки рисуются одной положительной `nonzero` path. `renderTarget`
адресует физическую path, а `partIds` сохраняет смысл двух стрелок.
`unchangedPartIds` перечисляет неподвижные части. Применяйте полный `pose.d`
к указанному target: отдельная запись стрелок меняет композицию заливки.
Координаты и точка вращения подготовлены в единицах `viewBox`; приложение
не выбирает центр по bbox и не разбирает исходный SVG.

| Символ | Outline | Filled |
|---|---|---|
| `time` | Подготовленные стрелки | `COMPOSITION_UNSUPPORTED` |
| `history` | Подготовленные стрелки | Подготовленные стрелки |

В Filled `time` стрелки являются отверстиями внутри общего тела. Их
пересечение требует вычитания объединения отверстий; этот target пока
отказывает. Статический Filled master остаётся доступен через `symbols/time`.
Неизвестное начертание получает `INVALID_REQUEST`, отсутствующее подготовленное
начертание — `VARIANT_UNSUPPORTED`.

`motionCapabilities(variant?)` сообщает author receipt, `geometrySha256`,
форматы `svg` и `prepared-clock-hands`, а также жест `clock.advance-hour`
с интервалом `0 → 1` в `elapsed-hours`. Импорт capabilities при tree shaking
не удерживает operands и sampler. Для экспорта видимого состояния сохраните
SVG с последним записанным `d`. Эти entrypoints не предоставляют Lottie,
SF Symbols или morph между разными символами.

Иконка внутри подписанной кнопки скрывается от accessibility tree; смысл
действия и доступное имя принадлежат кнопке. Если само показание времени
важно, приложение предоставляет его текстом и определяет уместную частоту
обновления. SVG не создаёт отдельный hit target.

Сборка выводит анатомию по закону `joint.authored-elbow` из каждого независимого
master. В кадре преобразуются готовые числовые operands и собирается строка
path; разбор SVG, Boolean clipping и построение IR не выполняются. Статический
импорт `symbols/<имя>` сохраняет свой отдельный путь.
