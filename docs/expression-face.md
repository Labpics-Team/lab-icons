# Менять выражение, сохраняя глаза и оболочку

**Diátaxis:** how-to.

`@labpics/icons/states/expression-face` меняет авторский контур рта между
`aloof`, `sad` и `smile`. Два глаза и оболочка остаются отдельными неподвижными
частями. Их контуры, заливка и порядок отрисовки сохранены из авторских Outline
Lab UI v2.1. Начальный рисунок — `aloof`.

Имена обозначают рисунки. Приложение задаёт их связь с состоянием пользователя,
действием и доступным текстом.

## Подключить

Установите подготовленный архив Icons и исполнитель Motion
по [контракту поставки](package.md). Доступность этих точек входа в npm
проверяется отдельно.

```ts
import {
  render, renderStateSvg, compileStateEffect, type State,
} from '@labpics/icons/states/expression-face';

const artwork: State = 'smile';
const staticSvg = render(artwork);
const mountedSvg = renderStateSvg('aloof');
const transition = compileStateEffect(artwork, {
  duration: 240,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
if (!staticSvg.ok || !mountedSvg.ok || !transition.ok) {
  throw new Error('Выражение не принято');
}
```

Подключение SVG и публичный Motion `sequence` используют
[общий порядок подключения](status-circle.md#подключить-переход).
Приложение читает видимую opacity изменяемых групп перед новым намерением;
начальные пары `[visible, to]` сохраняют смесь при прерывании. Общие глаза
и оболочка не входят в stages.
Статический `render()` не требует Motion.

Задайте размер SVG в приложении; цвет наследуется через `currentColor`.
Задайте элементу управления доступное имя и область нажатия; декоративному
SVG — `aria-hidden="true"`.

Поддержанные состояния, IDs частей, варианты и коды отказов перечислены в
[справке expression-face](expression-face-reference.md).
