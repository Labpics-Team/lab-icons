# Переключать авторские состояния

**Diátaxis:** how-to. Эти entrypoints относятся к собранному source-pack;
их наличие в npm проверяйте по [процедуре выпуска](build-release.md).

Микрофон и глаз имеют самостоятельные авторские рисунки включённого и выключенного
состояния. Выключенный рисунок содержит уже вырезанные части, поэтому один slash
поверх исходного символа не воспроизводит его. Закон `source.replace` сохраняет оба
master и меняет их видимость. Контурный morph и неизменная оболочка не объявляются.

| Import | Начертание | Состояния |
|---|---|---|
| `@labpics/icons/states/microphone` | Outline | `unmuted`, `muted` |
| `@labpics/icons/states/microphone-filled` | Filled | `unmuted`, `muted` |
| `@labpics/icons/states/visibility` | Outline | `visible`, `hidden` |
| `@labpics/icons/states/visibility-filled` | Filled | `visible`, `hidden` |

```js
import {
  render, renderStateSvg, compileStateEffect, stateCapabilities,
} from '@labpics/icons/states/microphone';

const still = render('muted');
const mounted = renderStateSvg('unmuted');
const transition = compileStateEffect('muted', {
  duration: 180,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
if (!still.ok || !mounted.ok || !transition.ok) {
  throw new Error('Состояние или параметры не поддержаны');
}
console.log(still.svg, mounted.svg, transition.effect, stateCapabilities());
```

`render` возвращает только выбранный рисунок. `renderStateSvg` оставляет обе группы
в SVG с устойчивыми `data-part` IDs. У эффекта contract
`labpics.symbol-state-effect/1`, kind `source-replacement`, opacity stages и пустой
`unchangedPartIds`. Начальная opacity не записана в эффект: исполнитель считывает
видимую позу перед новым переходом. Используйте тот же публичный Lab Motion
`sequence`, что в [примере status-circle](status-circle.md), и сохраняйте mounted
nodes. Новый control принимает видимую смесь перед остановкой предыдущего;
прерывание и обратный переход не заменяют DOM начальным SVG.

Приложение задаёт доступный смысл кнопки: например, «Выключить микрофон» и
«Включить микрофон», а декоративный SVG получает `aria-hidden="true"`.
Состояние рисунка не включает реальное аудио и не изменяет права доступа.

## Проверить поддержку перед применением

`stateCapabilities()` возвращает states с author provenance, начертание,
`transition: 'source-replacement'`, `morph: 'unavailable'`, `enclosurePartId: null`
и proof конкретной Figma-версии. API одного начертания не выбирает другое.

Геометрическая вариация off-фрагментов пока не доказана. Запрос `variation`,
включая `bodyWidth`, получает `VARIATION_UNSUPPORTED`; ошибочная форма запроса —
`INVALID_REQUEST`. Начертание другой группы получает `VARIANT_UNSUPPORTED`,
необъявленное состояние — `STATE_UNSUPPORTED`. Сохраняйте прежнюю видимую позу
после отказа. Width не сбрасывается незаметно к 1 и не переносится на off-master.

`exportStateTransition(state, { duration, format: 'web-effect' })` выдаёт тот же
эффект. Lottie, dotLottie и SF Symbols получают `FORMAT_UNSUPPORTED` для этих
групп. Статический SVG уже выдаёт `render`; неподдержанный transition adapter
не подменяется статическим кадром.

Outline/Filled принадлежат независимым masters. Статические импорты и прежние
группы с доказанной общей оболочкой сохраняют свои entrypoints и контракты.

## Цена перехода

Компилятор разбирает masters при сборке. Runtime получает готовые SVG-группы и
opacity stages; переход не пересчитывает paths и не создаёт покадровый цикл Lab Icons.
Движение исполняет Lab Motion. Снимок видимой opacity нужен при передаче управления,
а не на каждом кадре.

[Chrome](https://developer.chrome.com/blog/hardware-accelerated-animations)
поддерживает ускоренное SVG-движение через compositor; [разбор rendering pipeline](https://web.dev/articles/animations-overview)
уточняет цену отдельных layers, textures и памяти. Поэтому здесь не добавляется
`will-change` каждому символу. Сам выбор opacity не доказывает низкую стоимость
10000 одновременно видимых переходов: её устанавливает benchmark конкретного
consumer, устройства и браузера.
