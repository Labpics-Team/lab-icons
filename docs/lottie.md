# Экспорт символа в Lottie и dotLottie

`exportLottie` принимает тот же `IconSymbol` и свойства, что и `renderIcon`.
В файл попадают выбранная оптика, дата, состояние или объявленный жест.

```ts
import time from '@labpics/icons/symbols/time';
import { exportLottie, lottieCapabilities, packDotLottie } from '@labpics/icons/lottie';

const result = exportLottie(time, {
  variant: 'outline', weight: 500, opsz: 20,
  gesture: 'advance', from: 0, to: 2, duration: 1000,
  color: '#123456', frameRate: 60,
});
if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
const animationData = result.animation;
const archive = packDotLottie(animationData); // Uint8Array для файла .lottie
```

Без `gesture` и `transition` экспортируется неподвижная поза. Доступные жесты
возвращает `lottieCapabilities(symbol, options).gestures`; вместо options можно
передать `'outline'` или `'filled'`. Пути `/lottie/<имя>` сохраняются как короткие
обёртки общего exporter: у них первым аргументом остаются options.

`from` и `to` задают сегмент жеста, включая обратное направление. Обычно это
диапазон 0…1; у `time.advance` и `history.advance` — прошедшие часы, включая
отрицательные и несколько оборотов. `duration` задаётся в миллисекундах.
`reducedMotion: true` сразу материализует конечную позу.

## Дата, состояние и оптика

```ts
import calendar from '@labpics/icons/states/calendar';

const result = exportLottie(calendar, {
  date: new Date('2026-11-17T12:00:00Z'), timeZone: 'Europe/Moscow',
  transition: {
    from: { state: 'date', weight: 300, opsz: 48 },
    to: { state: 'grid', weight: 600, opsz: 16 },
  },
  duration: 300,
});
```

Свойства `from`/`to` внутри `transition` дополняют общие свойства запроса.
Совместимые части меняют координаты, pivot, толщину штриха и размещение;
разные части заменяются crossfade. Ключ части задаёт correspondence.
`gesture` и `transition` выбираются раздельно. Интерактивное прерывание
принадлежит живому [Motion API](symbol-motion.md), а не записанному файлу.

Дата требует явного `Date` и именованной IANA zone. Часы и календарь не
обращаются к текущему времени. `size` разрешает `opsz: 'auto'`, как у SVG;
логические координаты анимации сохраняют исходный viewBox.

## Геометрия и воспроизведение

Exporter читает числовые M/L/C/Z и семантические tracks символа напрямую.
Пути SVG не разбираются во время исполнения. Только явно объявленный
`part.layer` объединяет покрытие и вычитание через luminance matte;
остальные части сохраняют самостоятельные paints и порядок. Цвет применяется
после маски покрытия, opacity слоя — после окрашивания. `draw` использует
числовой guide, stroke и trim-path matte, включая отрицательные штрихи Filled.

`color` — `#rrggbb` или `#rrggbbaa`; JSON не наследует CSS `currentColor`.
Профиль `lottie-web-svg-5.13` проверяется настоящим SVG renderer `lottie-web`
5.13.0. Прямая в Lottie записывается кубической кривой с тем же геометрическим
следом; сглаживание отдельных граничных пикселей может отличаться от SVG `L`.
Геометрия, отверстия, порядок paints и конечные позы сохраняются.

`terminalFrame = duration * frameRate / 1000` может быть дробным.
`op = ceil(terminalFrame) + 1` оставляет конечную позу доступной player.
Например, 317 ms при 60 fps дают terminalFrame 19.02 и op 21.
Эта конвенция записана в `animation.meta.labIcons`.
Canvas охватывает контрольные точки и траекторию движения;
`logicalViewBox` и `offset` позволяют разместить анимацию относительно
исходных 24 единиц без уменьшения значка из-за добавленных полей.

Каждый вызов возвращает свежий изменяемый JSON, включая независимые объекты
keyframes: `lottie-web` нормализует tangents на месте. Упакуйте JSON до передачи
в player; после использования освободите player через `destroy()`.
Архив dotLottie содержит [тот же JSON](dotlottie.md). Отдельная проверка
dotLottie Web сравнивает загрузку архива и JSON в его WASM renderer;
она не обещает пиксельного равенства между разными движками.

Неверный запрос возвращает `INVALID_REQUEST`; отсутствующий жест —
`MOTION_UNAVAILABLE`, неподдержанный track — `MOTION_UNSUPPORTED`.
Некомпилированный символ даёт `SYMBOL_DATA_REQUIRED`, несовместимые пути —
`TOPOLOGY_UNSUPPORTED`, непредставимая область — `CANVAS_UNSUPPORTED`.
Открытая заливка, неизвестный paint и неверный числовой путь имеют отдельные
коды отказа. Прежние operands `variation` получают `VARIATION_UNSUPPORTED`.

Основание: [Lottie layers](https://lottie.github.io/lottie-spec/1.0/specs/layers/),
[Lottie shapes](https://lottie.github.io/lottie-spec/1.0/specs/shapes/),
[dotLottie v2](https://dotlottie.io/spec/2.0/).
