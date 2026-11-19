# Состояния и движение символов

Неподвижный символ подключается через `symbols/<id>`. Он содержит только свои
оптические данные, части и жесты. Переключение между разными символами подключается
отдельно через `states/<family>`: обычный импорт `volume-high` не загружает остальные
уровни громкости. Оба объекта принимают одинаковые `size`, `weight`, `opsz`, `variant`.

```js
import * as motion from '@labpics/motion';
import reload from '@labpics/icons/symbols/reload';
import microphone from '@labpics/icons/states/microphone';
import { createSymbolMotion } from '@labpics/icons/motion';

const icons = createSymbolMotion(motion);
const refresh = icons.mount(refreshButton, reload, { size: 20, weight: 500 });
const mic = icons.mount(micButton, microphone, { size: 20, state: 'on' });

refresh.effect('cycle');
mic.setState('off');
// При удалении соответствующей кнопки:
refresh.dispose();
mic.dispose();
```

`mount` добавляет один декоративный SVG. Название действия принадлежит кнопке.
`set(options, transition)` заменяет свойства, `setState(state, transition)` сохраняет
остальные свойства. `selected`/`unselected` выбирают авторские Filled/Outline;
явный `variant` имеет приоритет. Произвольные названия состояний отвергаются.

Смена `weight`/`opsz` интерполирует совместимые координаты, pivot, ширину
цифрового штриха и размещение. Прерывание начинает следующий переход с последней
видимой геометрии. В кадре переиспользуются подготовленные координатные массивы;
неподвижная геометрия повторно не записывается. Тот же sampler используется
[экспортом Lottie](lottie.md) для соответствующих path-keyframes.

`effect(name, {to, duration, reducedMotion})` исполняет объявленный жест. `to` —
конечная доля 0…1, кроме `advance`, где это часы; `duration` — миллисекунды.
Возвращённые controls поддерживают
`pause`, `play`, `seek`, `finish`, `stop` и `finished`. Повторный эффект продолжает
последнюю показанную позу; старое завершение не переписывает новый результат.
Reduced motion сразу применяет конец, `dispose` освобождает controls и SVG.
При неподвижном символе Icons не создаёт часов, rAF или observer.
Смена состояния возвращает opacity, translation, rotation и draw к исходной
позе, начиная с последнего видимого значения. Новый эффект получает управление
своими каналами; продолжающаяся смена состояния не переписывает их значения.

Явный `to` продолжает текущую фазу; до первого эффекта это объявленный `rest`.
Например, у полной громкости `rest = 1`, поэтому `level({to: .8})` плавно уменьшает
дальний сигнал. Вызов без `to` запускает полный жест с нуля и повторяет его после
завершения; прерванный жест продолжает текущую фазу. Это различие позволяет
`draw({to: .5})` скрыть половину полного знака, а `draw()` — нарисовать его заново.

| Импорт | Состояния / жесты |
| --- | --- |
| `symbols/reload`, `symbols/refresh` | `cycle` |
| `symbols/checkmark` | `presence`, `draw` |
| `symbols/checkmark-circle` | `draw`, включая вычитаемую галочку Filled |
| `symbols/notifications` | `ring` |
| `symbols/time`, `symbols/history` | `advance` в часах |
| `symbols/volume-high` | `level` |
| `states/direction`, `states/chevron` | left, right, up, down; `nudge` |
| `states/notification` | normal, unread, off |
| `states/volume` | high, middle, low, quiet, mute, off |
| `states/microphone`, `states/visibility` | on, off |
| `states/status` | confirmed, dismissed, question, attention, increase, decrease |
| `states/playback` | play, pause, stop |
| `states/calendar` | date, today, clear, grid |

`advance` поворачивает минутную стрелку на 360°, часовую — на 30° за час.
Явный `to` задаёт прошедшие часы от авторской позы, включая отрицательные значения.
Без `to` эффект прибавляет один час к текущей видимой фазе. Прерывание сохраняет
направление и положение; `set`/`setState` возвращает авторскую позу. Системных часов
и скрытого таймера у символа нет.
Новый `advance()` во время этого возврата также прибавляет час к видимому углу,
включая промежуточные положения.

```js
import time from '@labpics/icons/symbols/time';

const clock = icons.mount(clockButton, time, { variant: 'filled', weight: 500 });
clock.effect('advance', { to: 2, duration: 1000 });
clock.effect('advance', { to: -1 }); // Назад от текущей видимой фазы.
clock.effect('advance');           // Ещё один час от текущей фазы.
```

`calendar-number` получает день из явных `date: Date` и `timeZone: string`.
Оба свойства обязательны вместе. `Date` задаёт instant, IANA zone — календарный
день в этой зоне: `2026-01-01T00:30:00Z` показывает 1 в UTC и 31 в
`America/Los_Angeles`. Числовой offset вместо именованной зоны не принимается.
Без даты сохраняется исходный авторский знак. Статика использует тот же запрос
через `renderIcon(calendarNumber, options)`.

```js
import calendarNumber from '@labpics/icons/symbols/calendar-number';

const calendar = icons.mount(dateButton, calendarNumber, {
  date: new Date('2026-01-01T00:30:00Z'),
  timeZone: 'America/Los_Angeles',
  size: 24, weight: 500, state: 'selected',
});
calendar.setDate(new Date('2026-01-02T12:00:00Z'), 'America/Los_Angeles');
```

`setDate(date, timeZone, transition)` сохраняет остальные свойства и состояние;
`setState` сохраняет дату. Контроллер запоминает instant при вызове: последующая
мутация переданного `Date` не меняет знак. Семейство `states/calendar` сохраняет
дату и в состояниях clear/today/grid, показывая число при возврате в date.
Другая иконка, неполная пара даты/зоны и неверный ввод отвергаются до изменения
видимой позы. Смена цифр использует crossfade внутри неизменной оболочки;
совпадение позиции цифры не означает соответствие её точек. Обновление дня
планирует приложение, библиотека не заводит таймер.

Группы и адресуемые части выводятся из `symbols/source.json`. Общая часть
сохраняется только при одинаковых координатах и коэффициентах всех оптических
опор. Остальные части заменяются коротким crossfade. Контроллер не сопоставляет
контуры и не разбирает SVG во время исполнения.

Draw использует авторскую открытую направляющую и маску: она постепенно открывает
исходную залитую фигуру. Граница заполненного контура не выдаётся за штрих.
Полностью скрытый и полностью показанный концы точны при любом весе.
В Filled отрицательная часть вычитается из собственного изолированного слоя.
Поэтому отверстие показывает фон потребителя, в том числе при полупрозрачном
цвете символа; заменять отверстие цветной заливкой не требуется. При смене
состояния прозрачность применяется к объединённому рисунку, сохраняя отверстие.
Цвет с alpha окрашивает слой один раз: пересечения частей, в том числе стрелок
часов между собой и с оболочкой, не становятся темнее.
Части ссылаются на целые контуры одного числового пути через `pathIndex` и
`contourIndices`. Координаты и коэффициенты weight/opsz хранятся один раз;
статический путь не меняется. Ключ общей части включает вычитающую
композицию, поэтому разные отверстия не разделяют одну маску.

У стрелок часов отдельные контуры ссылаются на точки исходного пути. Скрытые
окончания и общая опора — выпуклые комбинации этих точек. Проекция пересчитывается
при изменении weight/opsz; кадр меняет только подготовленные transforms. Числовая
оптика не дублируется в данных частей, авторский статический путь сохраняется.

Проверка реального браузера: `node scripts/verify-semantic-motion.mjs` использует
публичные package entrypoints и `@labpics/motion`. Native-проекция описана в
[Compose README](../native/compose/README.md).
`node scripts/verify-negative-draw.mjs` дополнительно сравнивает Filled с исходным
силуэтом на девяти опорах и проверяет draw на прозрачном, светлом и тёмном фоне.
`node scripts/verify-clock-motion.mjs` сравнивает обе пары часов со статическим
рисунком на девяти опорах и проверяет единицы, прерывание, обратный ход и disposal.
`node scripts/verify-calendar-motion.mjs` сравнивает 31 день на девяти опорах в
обоих начертаниях, включая смену даты, прерывание, IANA zone и сохранение состояния.

Основание модели частей и рисования:
[Apple, SF Symbols 7](https://developer.apple.com/videos/play/wwdc2025/337/).
