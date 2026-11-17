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

`effect(name, {to, duration, reducedMotion})` исполняет объявленный жест. `to` —
конечная доля 0…1, `duration` — миллисекунды. Возвращённые controls поддерживают
`pause`, `play`, `seek`, `finish`, `stop` и `finished`. Повторный эффект продолжает
последнюю показанную позу; старое завершение не переписывает новый результат.
Reduced motion сразу применяет конец, `dispose` освобождает controls и SVG.
При неподвижном символе Icons не создаёт часов, rAF или observer.

| Импорт | Состояния / жесты |
| --- | --- |
| `symbols/reload`, `symbols/refresh` | `cycle` |
| `symbols/checkmark` | `presence`, `draw` |
| `symbols/notifications` | `ring` |
| `symbols/volume-high` | `level` |
| `states/direction`, `states/chevron` | left, right, up, down; `nudge` |
| `states/notification` | normal, unread, off |
| `states/volume` | high, middle, low, quiet, mute, off |
| `states/microphone`, `states/visibility` | on, off |
| `states/status` | confirmed, dismissed, question, attention, increase, decrease |
| `states/playback` | play, pause, stop |
| `states/calendar` | date, today, clear, grid |

Группы и адресуемые части выводятся из `symbols/source.json`. Общая часть
сохраняется только при одинаковых координатах и коэффициентах всех оптических
опор. Остальные части заменяются коротким crossfade. Контроллер не сопоставляет
контуры и не разбирает SVG во время исполнения.

Draw использует авторскую открытую направляющую и маску: она постепенно открывает
исходную залитую фигуру. Граница заполненного контура не выдаётся за штрих.
Полностью скрытый и полностью показанный концы точны при любом весе.

Проверка реального браузера: `node scripts/verify-semantic-motion.mjs` использует
публичные package entrypoints и `@labpics/motion`. Native-проекция описана в
[Compose README](../native/compose/README.md).

Основание модели частей и рисования:
[Apple, SF Symbols 7](https://developer.apple.com/videos/play/wwdc2025/337/).
