# Менять знак, сохраняя оболочку

`@labpics/icons/states/status-circle` заменяет внутренний знак внутри одной
неподвижной круглой оболочки. Все контуры происходят из независимых Outline
masters Lab UI v2.1; построение проверяет их точное равенство и порядок paint.
Промежуточная поза — смесь целых знаков. Morph не объявлен.

| Состояние | Авторский символ |
|---|---|
| `confirmation` | `checkmark-circle` |
| `dismissal` | `close-circle` |
| `question` | `question-circle` |
| `attention` | `alert-circle` |
| `increase` | `plus-circle` |
| `decrease` | `minus-circle` |

Это значения знаков. Приложение задаёт их связь с успехом, ошибкой, действием
и доступным текстом. Начальная поза — `question`. Filled пока получает
`VARIANT_UNSUPPORTED`: отдельная одинаковая оболочка там не принята.

## Подключить переход

Установите Icons и отдельный исполнитель Motion:

```sh
pnpm add @labpics/icons @labpics/motion@^0.5.0
```

```ts
import {
  renderStateSvg, compileStateEffect, type State,
} from '@labpics/icons/states/status-circle';
import { sequence } from '@labpics/motion';

const initial = renderStateSvg('question');
if (!initial.ok) throw new Error(initial.reason.code);
const host = document.createElement('span');
host.innerHTML = initial.svg;
host.querySelector('svg')!.setAttribute('aria-hidden', 'true');
const targets = new Map([...host.querySelectorAll<SVGElement>('g[data-state][data-part]')]
  .map(part => [part.dataset.part!, part] as const));
document.body.append(host);

let control: ReturnType<typeof sequence> | undefined;
function changeState(state: State) {
  const result = compileStateEffect(state, {
    duration: 240,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  if (!result.ok) throw new Error(result.reason.code);
  const effect = result.effect;
  const next = sequence(effect.stages.map(stage => [
    targets.get(stage.partId)!, { opacity: stage.to },
    { at: stage.at, duration: stage.duration, ease: effect.options.easing },
  ]), { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' });
  control?.stop();
  control = next;
}

changeState('confirmation');
// Новое намерение можно передать в любой момент на тех же DOM-группах.
changeState('attention');

// При удалении компонента:
// control?.stop();
// host.remove();
```

`renderStateSvg()` устанавливает начальную opacity до mount. Все группы
остаются в DOM; новая sequence подхватывает их фактическую видимую opacity.
Создайте новый control до остановки прежнего. Повторный mount или установка
начальной opacity во время перехода вернули бы символ к исходной позе.
Оболочка не входит в stages. Для reduced motion конечная поза имеет duration 0.

Question и attention содержат несколько paths. Opacity применяется к группе
знака после её отрисовки, сохраняя compositing внутренних контуров. Во время
анимации библиотека передаёт только scalar targets; geometry не разбирается.
Доступное имя, live status, hit target и RTL действий принадлежат приложению.

## Получить вектор или данные эффекта

```ts
import { render, exportStateTransition } from '@labpics/icons/states/status-circle';

const svg = render('confirmation');
if (svg.ok) console.log(svg.svg);

const motion = exportStateTransition('dismissal', {
  format: 'web-effect', duration: 240,
});
if (!motion.ok) throw new Error(motion.reason.code);
const effectData = motion.effect;
```

`render()` выдаёт только выбранный знак и оболочку. Для одного статического
символа также доступны прежние `@labpics/icons/symbols/<name>` string exports.
State module подключается отдельно и содержит ровно свою группу.

`stateCapabilities()` перечисляет состояния, стабильные group/part IDs,
Figma receipts и поддержанные форматы. Экспорт перехода в `lottie`, `dotlottie`
или `sf-symbols` возвращает `FORMAT_UNSUPPORTED`. Запрос неизвестного состояния
даёт `STATE_UNSUPPORTED`; лишние параметры — `INVALID_REQUEST`.

## Добавить связанное состояние

[Semantic spec](../semantics/author-state-groups.json) закрепляет имена,
независимые master hashes и IDs внутренних частей. Координаты в нём отсутствуют.
Build compiler сравнивает последние enclosure paths, fill-rule, paint,
viewBox, размеры и положение после interior; несовпадение получает точный отказ.
Runtime хранит готовые fragments и одну оболочку, не восстанавливает анатомию.

Новый master проходит своё авторское и визуальное принятие. Самостоятельный
Filled body с отрицательным знаком, похожий bbox или имя с `-circle` не доказывают
общую оболочку. Источники и контрпримеры:
[исследование enclosure replacement](research/enclosure-replacement-20261101.md).

Source/contract проверки не подтверждают опубликованный пакет или browser
interruption. Packed install/types/geometry проверяет штатный package gate;
реальный executor, Observatory, pixel comparison и delivery требуют отдельных
exact-artifact результатов.
