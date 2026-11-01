# Подключить отдельный символ

`@labpics/icons/symbols/<имя>` содержит Outline, Filled и предварительно собранные
части одного текущего авторского символа. Исходники закреплены в
[Figma manifest](../semantics/figma-baseline.json): Lab UI v2.1,
версия `2416636003859748575`, 330 семейств и 660 независимых вариантов.
Примеры относятся к собранному checkout; номер и публикация выпуска проверяются
по [процедуре поставки](build-release.md).

```sh
pnpm add ./labpics-icons-<version>.tgz
```

## Показать авторский SVG

```js
import { outline } from '@labpics/icons/symbols/align-bottom';

const button = document.querySelector('button');
button.setAttribute('aria-label', 'Выровнять по нижнему краю');
button.innerHTML = outline;
button.querySelector('svg').setAttribute('aria-hidden', 'true');
```

Для Filled импортируйте `filled`. Строки сохраняют авторские `d`, порядок путей
и fill-rule, а цвет наследуют через `currentColor`. Импорт одной строки удаляет
неиспользуемый IR и runtime символа. Размер, цвет, доступность и область нажатия
задаёт компонент приложения.

## Получить части и источник

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/time';

const symbol = glyph({ variant: 'outline' });
const capabilities = glyphCapabilities('outline');
console.log(symbol.parts, symbol.provenance.author, capabilities);
```

Default и `glyph({ modelMode: 'source-only' })` возвращают один неизменяемый результат.
Filled строится из собственного master. Разбор path, fingerprints, topology и
геометрические anchors выполняются при сборке; вызов `glyph()` возвращает готовые данные.

`provenance.author` содержит Figma fileKey, version, nodeId, nodeSha256,
masterSha256, normalizedSha256 и pathFingerprintSha256. Сборка проверяет raw bytes,
нормализованный SVG и fingerprint порядка/fill-rule перед выдачей модулей.
Неаннотированные части имеют `role: 'unclassified'` и geometry-derived identity.
Их bbox anchors не объявляют смысл или correspondence для morph. У `reload` и
`refresh` в обоих начертаниях анатомия закреплена отдельно: `cycle-body`, роль
`control` и объявленный canvas anchor. Receipt `anatomy` связывает её с конкретными
master/path хешами. Исходные контуры остаются прежними.

## Проверить допустимое изменение

Текущая авторская поверхность возвращает `modelState: null` и пустые `supportedAxes`.
Без принятой анатомии движение имеет состояние `source-only`; проверенная
анатомия `reload`/`refresh` объявляет `gesture-ready`. Запрос любой известной оси, включая её прежнее
default-значение, или `modelMode: 'allow-candidate'` вызывает ошибку с кодом
`AUTHOR_PARITY_REQUIRED`. Ошибочная форма запроса, неизвестная ось и нечисловое
значение вызывают `TypeError`. Значения не зажимаются и не заменяют master.

```js
try {
  glyph({ axes: { opsz: 32 } });
} catch (error) {
  if (error.code !== 'AUTHOR_PARITY_REQUIRED') throw error;
}
```

Совпадение имени со старой моделью не переносит её admission на новый рисунок.
Например, текущий `time` имеет другую внешнюю окружность и два самостоятельных
fill scopes. Записанные модели, оси и candidate-регистрация продолжают работать
через полный `@labpics/icons/ir`, а прежние именованные SVG — через корневой импорт.
Оба пути сохраняют свой записанный baseline.

## Получить семантический эффект

`compileSymbolEffect` принимает GlyphIR и capabilities без каталога или parser.
Неаннотированный master получает `SEMANTIC_MOTION_UNAVAILABLE`. Текущие
авторские `reload` и `refresh` поддерживают соответственно `reload.cycle` и
`refresh.cycle`: один оборот по часовой стрелке с обратным ходом и прерыванием.
Тип жеста `cycle` означает, что завершённый оборот можно повторить как новое
событие. Scalar retarget из текущей позы сохраняет прерванный оборот; новый
explicit `[from,to]` используется только для новой occurrence или scrub.

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/reload';
import { compileSymbolEffect } from '@labpics/icons/motion';

const result = compileSymbolEffect(glyph(), glyphCapabilities(), 'reload.cycle', {
  duration: 900, from: 0, to: 1,
});
if (!result.ok) throw new Error(result.reason.message);
```

`effect.viewport` задаёт `overflow: 'visible'`: вращаемый силуэт может выйти за
статический viewBox, который сохраняет авторский размер. Приложение учитывает
эту область при размещении и не обрезает её родительским clip. `targets` содержат
стабильные `partId`, normalized anchor, градусы и стандартные keyframes.
Публичный Lab Motion исполняет числовой канал `rotate`; пример связки находится
в [Observatory consumer](../observatory/motion-execution.js).

У эффекта версия 1 содержит вращение; версия 2 содержит скалярные opacity-стадии.
Перед чтением полей канала проверьте `effect.version`.
`ellipsis-horizontal` в обоих начертаниях и `chatbubble-ellipses` в Outline
поддерживают `<имя>.activity` и `<имя>.idle`. Один закон `activity.triad`
выделяет три точных авторских пути. При typing оболочка `bubble` остаётся
неподвижной; Filled chatbubble с единым evenodd-контуром пока отказывает.
Вертикальное троеточие сохраняет смысл меню и автоматически loading не получает.

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/chatbubble-ellipses';
import { compileSymbolEffect } from '@labpics/icons/motion';
import { renderGlyphSvg } from '@labpics/icons/ir/render';
import { sequence } from '@labpics/motion';

const host = document.createElement('span');
host.innerHTML = renderGlyphSvg(glyph(), { instanceId: 'typing' });
host.querySelector('svg').setAttribute('aria-hidden', 'true');
document.body.append(host);
const svg = host.querySelector('svg');
const byPart = new Map([...svg.querySelectorAll('[data-part]')].map(part => [part.dataset.part, part]));
let previous;
function setMotion(gesture, from, to) {
  const result = compileSymbolEffect(glyph(), glyphCapabilities(), gesture, { duration: 900, from, to });
  if (!result.ok) throw new Error(result.reason.message);
  if (result.effect.version !== 2) throw new Error('Нужен opacity-эффект');
  if (result.effect.targets.some(target => !byPart.has(target.partId))) throw new Error('Потеряна часть символа');
  const next = sequence(result.effect.stages.map(stage => [
    byPart.get(stage.partId), { opacity: stage.to },
    { at: stage.at, duration: stage.duration, ease: result.effect.options.easing },
  ]), { reducedMotion: result.effect.options.duration === 0 ? 'always' : 'user' });
  previous?.stop();
  previous = next;
  return next;
}
setMotion('chatbubble-ellipses.activity', 0.3, 1);
```

`at` и `duration` заданы в миллисекундах. Первый скалярный
этап подхватывает текущую позу Lab Motion; остальные продолжают объявленную шкалу.
Новый effect принимается до освобождения прежнего control. Обратные `from/to`
компилируют путь к более ранней фазе; это новое намерение, а не вызов отсутствующего
`reverse()` в root API 0.5.0. Idle восстанавливает opacity 1, reduced motion сразу
принимает конечную позу, повтор завершённого activity создаёт новую occurrence.

Принятый `time.advance` доступен у записанной модели:

```js
import { glyph as recordedGlyph, glyphCapabilities as recordedCapabilities } from '@labpics/icons/ir';
import { compileSymbolEffect } from '@labpics/icons/motion';

const result = compileSymbolEffect(
  recordedGlyph({ icon: 'time' }), recordedCapabilities('time'), 'time.advance',
  { duration: 400, from: 0.35, to: 1, reducedMotion: false },
);
if (!result.ok) throw new Error(result.reason.code);
console.log(result.effect.targets, result.effect.options);
```

Lab Icons задаёт части, anchors и ключевые кадры. Исполнение и отмена находятся
у [Lab Motion](https://github.com/Labpics-Team/lab-motion). `from` продолжает
видимый прогресс после прерывания; reduced motion материализует конечное состояние
с нулевой длительностью. Lottie и SF Symbols сохраняют статус `not-exported`.

SVG с локальными mask/clip получает уникальный `instanceId` при одновременном монтаже:

```js
import { renderGlyphSvg } from '@labpics/icons/ir/render';

const svg = renderGlyphSvg(recordedGlyph({ icon: 'time', variant: 'filled' }), {
  instanceId: 'main-clock',
});
```

`instanceId` уникален в документе, начинается с латинской буквы и содержит
до 64 букв, цифр, `-` или `_`. Renderer сохраняет `data-part` и переименовывает ресурсы.
При отсутствии ресурсов он возвращает готовую SVG-строку.

## Изменить уровень громкости

`volume-high` в обоих начертаниях и `volume-middle/filled` имеют состояние
`*.level`. Волны включаются от ближней к дальней; динамик сохраняет форму
и положение. Это прозрачность авторских слоёв, а не рисование контура или
переход к отдельному мастеру `volume-low`.

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/volume-high';
import { compileSymbolEffect } from '@labpics/icons/motion';

const caps = glyphCapabilities();
const gesture = caps.motion.gestures.find(item => item.id === 'volume-high.level');
const result = compileSymbolEffect(glyph(), caps, 'volume-high.level', {
  duration: 180,
  from: gesture?.restProgress ?? 0,
  to: 0.5,
});
if (!result.ok) throw new Error(result.reason.code);
const effect = result.effect;
```

`restProgress` описывает неподвижный master: у этой шкалы он равен `1`.
После первого изменения передавайте принятый уровень в `from`; исполнитель
подхватывает текущую видимую позу. Стадии `effect` передаются публичному `sequence`
по примеру выше. `from` по умолчанию сохраняет прежнее значение `0`; metadata
не меняет существующий контракт запроса.

`volume-middle/outline` пока отказывает этому состоянию: внешняя волна состоит
из раздельных путей, для которых нужна проверенная групповая прозрачность.
Прозрачность отдельных путей не выдаётся за её эквивалент. Подробнее —
[наблюдения и границы среза](evidence/author-signal-20261101.md).

## Добавить и проверить символ

Авторский snapshot проходит [общий приём мастеров](agent-workflow.md).
`node scripts/generate-symbol-surface.mjs` выводит конечные имена, declarations
и release allowlist из Figma manifest. `pnpm build` проверяет весь snapshot,
передаёт источники существующему source compiler и создаёт отдельные модули.
Осевые и semantic admissions принимаются отдельно после доказательства паритета.

`pnpm check:package-artifact` устанавливает чистый tarball, проверяет каждый текущий
master и его parts/provenance, добавленные типизированные имена, прежние статические
интеграции и точные отказы. Тяжёлые проверки и
[измерения пакета](../scripts/measure-platform-artifacts.mjs) выполняются на runner.
Отчёт сохраняет SHA, среду, байты и включённые модули; policy обновляется только
явным `--update` после проверки измерений.

Путь следует [SVG 2 path semantics](https://www.w3.org/TR/SVG2/paths.html)
и [правилам заливки](https://www.w3.org/TR/SVG2/painting.html): compound contour
и порядок fill scopes сохраняются. Для статического потребления выбран обычный
подход [Lucide icon data](https://lucide.dev/guide/icons) — отдельные данные без
обязательного renderer. [Node subpath patterns](https://nodejs.org/api/packages.html#subpath-patterns)
сохраняют конечную проверяемую поверхность без ручного export map на каждое имя.
