# Показывать состояние подтверждения

Жест `<name>.presence` показывает или скрывает отдельную авторскую отметку.
`0` означает отсутствие отметки, `1` — подтверждение. Неподвижный мастер
соответствует `1`; промежуточное значение меняет только opacity отметки.
Оболочка остаётся на месте, её контуры и просветы сохраняются.

Это внутренние состояния выбранного символа. Пустая оболочка
`cloud-checkmark` не объявляется эквивалентной самостоятельному мастеру
`cloud`. Для изменения статуса в приложении задайте также доступный текст
или состояние управляющего элемента: анимация сама их не меняет.

## Поддержанные варианты

| Символ | Начертание | Отметка | Оболочка |
|---|---|---|---|
| `checkmark` | Outline и Filled | `confirmation-mark` | Нет |
| `checkmark-circle` | Outline | `confirmation-mark` | `confirmation-enclosure` |
| `cloud-checkmark` | Outline | `confirmation-mark` | `confirmation-enclosure` |
| `shield-checkmark` | Outline | `confirmation-mark` | `confirmation-enclosure` |

У трёх форм с оболочкой Filled-мастер содержит один `evenodd` path:
галочка является отверстием в теле. Для него отдельная отметка отсутствует.
`compileSymbolEffect()` возвращает `SEMANTIC_MOTION_UNAVAILABLE`, а запрос
движения в Lottie — `MOTION_UNAVAILABLE`. Статический вариант доступен.
Запрос несуществующего `<name>.draw` у поддержанного presence-варианта
возвращает `GESTURE_UNSUPPORTED`.

## Передать подтверждение исполнителю

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/checkmark-circle';
import { renderGlyphSvg } from '@labpics/icons/ir/render';
import { compileSymbolEffect } from '@labpics/icons/motion';
import { sequence } from '@labpics/motion';

const symbol = glyph({ variant: 'outline' });
const capabilities = glyphCapabilities('outline');
const svg = renderGlyphSvg(symbol, { instanceId: 'save-confirmation' });
const confirmed = true;
const result = compileSymbolEffect(symbol, capabilities, 'checkmark-circle.presence', {
  duration: 300,
  from: 0,
  to: confirmed ? 1 : 0,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
const effect = result.effect;
if (effect.version !== 2) throw new Error('Нужен opacity-эффект');

const host = document.createElement('span');
host.innerHTML = svg;
host.querySelector('svg')!.setAttribute('aria-hidden', 'true');
const byPart = new Map([...host.querySelectorAll<SVGElement>('[data-part]')]
  .map(part => [part.dataset.part!, part] as const));
for (const target of effect.targets) {
  const part = byPart.get(target.partId);
  if (!part) throw new Error(`Потеряна часть ${target.partId}`);
  part.style.opacity = String(target.from);
}
document.body.append(host);
const control = sequence(effect.stages.map(stage => [
  byPart.get(stage.partId)!, { opacity: stage.to },
  { at: stage.at, duration: stage.duration, ease: effect.options.easing },
]), { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' });
```

`svg` содержит адресуемые `data-part` группы. Эффект версии 2 передаёт
opacity-стадии публичному `sequence()` Lab Motion. Исполнитель подхватывает
текущую видимую opacity; при новом намерении сохраняйте ту же DOM-группу.
Исходное состояние устанавливается до первого движения. Для скрытой отметки
оно равно `0`, для авторского мастера — `1`.

Обратный переход использует `from: 1, to: 0`. После прерывания передайте
текущий прогресс и новое конечное состояние; часы, пауза и освобождение
остаются у исполнителя. `reducedMotion: true` даёт нулевую длительность
и конечную opacity. Observatory использует этот же контракт и показывает
ползунок «Состояние»; начальное значение берётся из `restProgress: 1`.

При новом намерении создайте следующий `sequence` до `control.stop()` прежнего:
[публичный рецепт прерывания](symbol-modules.md) сохраняет видимую позу.
Повторная установка начальной opacity нужна только при создании DOM, иначе
она вернула бы прерванный переход к началу. Снимите control при удалении host.

## Экспортировать переход

```ts
import { exportLottie } from '@labpics/icons/lottie/checkmark-circle';

const result = exportLottie({
  variant: 'outline', gesture: 'checkmark-circle.presence',
  duration: 1000, from: 0, to: 1, color: '#19191e',
});
if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
const animationData = result.animation;
```

Lottie получает opacity отметки из того же закона. Его contour geometry
готовится при сборке; TrimPath не добавляется. Возможности и ограничения
целевого renderer описаны в [справке Lottie](lottie.md).

## Расширить набор

Аннотация в [author-anatomy.json](../semantics/author-anatomy.json) ссылается
на хэш точного Figma-мастера и порядок исходных paths. Закон требует одну
отдельную замкнутую `nonzero` content-часть; остальные части имеют роль
`container`. Смысл задаётся явно через `purpose: 'confirmation'`.
Неподходящая топология получает `LAW_TOPOLOGY_UNSUPPORTED`.

Новый мастер проходит собственное визуальное принятие. Совпадение имени,
числа контуров или суффикса не назначает жест автоматически. Координаты,
вес, направления обхода и независимый Filled-мастер не выводятся заново.

Источники выбора, точные Figma-узлы и область проверок:
[исследование presence](research/confirmation-presence-20261101.md).
