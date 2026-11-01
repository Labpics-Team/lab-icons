# Менять выражение, сохраняя глаза и оболочку

`@labpics/icons/states/expression-face` меняет авторский mouth path между
`aloof`, `sad` и `smile`. Два глаза и оболочка остаются отдельными неподвижными
частями. Их контуры, заливка и исходный paint order сохранены из Outline
masters Lab UI v2.1. Начальный artwork — `aloof`.

Имена обозначают рисунки. Приложение задаёт их связь с состоянием пользователя,
действием и доступным текстом.

## Подключить

Для source-кандидата установите подготовленный архив Icons и исполнитель Motion
по [контракту поставки](package.md). Доступность новой поверхности в npm
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

Mount и публичный Motion sequence используют
[общий порядок подключения](status-circle.md#подключить-переход).
Consumer читает видимую opacity изменяемых групп перед новым намерением;
начальные пары `[visible, to]` сохраняют смесь при прерывании. Общие глаза
и оболочка не входят в stages. Внешняя система не знает их координат.
Статический `render()` не требует Motion.

`stateCapabilities().sharedPartIds` перечисляет `face-left-eye`,
`face-right-eye`, `face-enclosure`. Эти IDs также входят в
`effect.unchangedPartIds`. Цвет наследуется через `currentColor`; размер
задаётся размером SVG в приложении. Доступное имя и hit target принадлежат
элементу управления; декоративному SVG задайте `aria-hidden="true"`.

## Отказы и авторская основа

Группа поддерживает только Outline. Filled masters содержат одну compound
evenodd path и сохраняются как независимые статические exports, например
`filled` из `@labpics/icons/symbols/smile`. Запрос Filled-перехода получает
`VARIANT_UNSUPPORTED`. Неизвестное состояние получает `STATE_UNSUPPORTED`,
Lottie/dotLottie/SF Symbols transition — `FORMAT_UNSUPPORTED`. Morph
correspondence для mouth paths не доказан.

[Semantic spec](../semantics/author-state-groups.json) закрепляет master hashes,
version и полный ordered prefix/suffix. Компилятор проверяет равенство всех
shared parts; забытый общий глаз также получает отказ до выдачи module.
[Исследование](research/shared-parts-20261101.md) содержит source evidence,
альтернативы и точные границы проверки. Source runtime/admission не заменяют
remote installed/browser/raster проверки или live unsaved Figma parity.
