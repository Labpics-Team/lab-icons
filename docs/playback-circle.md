# Менять знак команды воспроизведения

`@labpics/icons/states/playback-circle` заменяет `play-circle` на `pause-circle`
внутри неподвижной оболочки. Исходные Outline paths, их порядок и обе pause bars
сохранены из закреплённой версии Lab UI v2.1. Начальный знак — `play`.

`play` означает команду «Воспроизвести», `pause` — «Приостановить».
Приложение связывает знак с состоянием своего плеера: воспроизводящий плеер
обычно предлагает pause, приостановленный — play. Значение `State` описывает
выбранный artwork. Оно не назначает состояние медиаресурса.

## Подключить

Для source-кандидата 0.3.0 установите подготовленный архив Icons и Motion:

```sh
pnpm add ./labpics-icons-0.3.0.tgz @labpics/motion@^0.5.0
```

Доступность версии в npm проверяется отдельно по [контракту поставки](package.md).

```ts
import {
  render, renderStateSvg, compileStateEffect, type State,
} from '@labpics/icons/states/playback-circle';

const command: State = 'pause';
const staticSvg = render(command);
const mountedSvg = renderStateSvg('play');
const replacement = compileStateEffect(command, {
  duration: 240,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
});
if (!staticSvg.ok || !mountedSvg.ok || !replacement.ok) {
  throw new Error('Запрос знака команды не принят');
}
```

Mount и подключение public Motion sequence используют
[тот же порядок](status-circle.md#подключить-переход): постоянные
`g[data-state][data-part]`, targets из effect и снимок видимой opacity всех
групп до новой sequence, новый control перед остановкой прежнего. При смене
намерения группы сохраняют текущую видимую
opacity. Оболочка не входит в stages. Reduced motion задаёт конечную позу
с duration 0. Статическому `render()` Motion не нужен.

Доступное имя кнопки задаёт приложение. Для кнопки с меняющейся командой
обновляйте имя «Воспроизвести»/«Приостановить»; для выбора artwork в Explorer
каждая кнопка имеет постоянное имя и свой `aria-pressed`. Playback artwork
не зеркалится автоматически в RTL.

## Отказы и источник

Группа принимает только `play` и `pause`. `stop` и состояния status-circle
дают `STATE_UNSUPPORTED`. Filled получает `VARIANT_UNSUPPORTED`.
Morph не объявлен; transition export в Lottie, dotLottie и SF Symbols
получает `FORMAT_UNSUPPORTED`. Static SVG и `web-effect` поддержаны.

[Semantic spec](../semantics/author-state-groups.json) закрепляет независимые
master hashes и stable part IDs. Оболочки play/pause буквально одинаковы
и находятся последними. У `stop-circle` та же оболочка расположена первой;
текущий закон отвергает такую topology и сохраняет authored paint order.
Координатных исключений и другого runtime для playback нет.

[Исследование и saved-version evidence](research/playback-circle-20261101.md)
фиксируют provenance и контрпримеры. Точность source checks не удостоверяет
live unsaved Figma parity, полный optical verdict, installed tarball или
браузерную непрерывность; эти проверки выполняются отдельно на точном артефакте.
