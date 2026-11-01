# Подключить отдельный символ

Модуль `@labpics/icons/symbols/<имя>` содержит SVG, предварительно собранные части
и возможности одного символа. Установка использует tarball проверяемого выпуска;
публикация и номер версии подтверждаются отдельно в [процедуре выпуска](build-release.md).

```sh
pnpm add ./labpics-icons-<version>.tgz
```

Для статической иконки достаточно строки SVG:

```js
import { timeOutline } from '@labpics/icons';

const button = document.querySelector('button');
button.setAttribute('aria-label', 'Показать время');
button.innerHTML = timeOutline;
button.querySelector('svg').setAttribute('aria-hidden', 'true');
```

Размер, цвет и доступная область нажатия задаются компонентом приложения.
Оптическая ось `opsz` задаётся отдельно, когда вариант её поддерживает.

## Получить части и возможности

```js
import { glyph, glyphCapabilities, outline, filled } from '@labpics/icons/symbols/time';

const symbol = glyph({ variant: 'outline' });
const capabilities = glyphCapabilities('outline');
console.log(symbol.parts, capabilities.motion.gestures);
```

`glyph()` возвращает неизменяемый, повторно используемый результат для Outline.
Запрос `glyph({ variant: 'filled' })` выбирает самостоятельный Filled-вариант.
`glyph({ modelMode: 'source-only' })` выбирает точный статический источник.
Параметры частей, topology, anchors и fingerprint этого источника проверяются при сборке.

При запросе оси сначала проверьте `modelState === 'accepted'`, `supportedAxes`
и опубликованный интервал `axes`. Например, принятый `chevron-forward` поддерживает
оптический размер:

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/chevron-forward';

const capabilities = glyphCapabilities('outline');
if (capabilities.modelState !== 'accepted' || !capabilities.supportedAxes.includes('opsz')) {
  throw new Error('Этот вариант не поддерживает оптическую ось');
}
const symbol = glyph({ axes: { opsz: 32 } });
```

Неподдержанная ось и значение вне интервала вызывают `RangeError`; неправильное
имя или форма запроса — `TypeError`. Исследовательские candidate-модели подключаются
через `@labpics/icons/ir/candidates` и полный `@labpics/icons/ir`.
Модуль отдельного символа отказывает в таком допуске кодом `CANDIDATES_REQUIRED`.

## Смонтировать независимые экземпляры

Filled-композиция может использовать SVG mask. Каждый одновременно смонтированный
экземпляр получает собственный `instanceId`, чтобы его движение сохраняло независимость.

```js
import { glyph } from '@labpics/icons/symbols/time';
import { renderGlyphSvg } from '@labpics/icons/ir/render';

document.querySelector('#main-clock').innerHTML = renderGlyphSvg(
  glyph({ variant: 'filled' }),
  { instanceId: 'main-clock' },
);
document.querySelector('#small-clock').innerHTML = renderGlyphSvg(
  glyph({ variant: 'filled' }),
  { instanceId: 'small-clock' },
);
```

`renderGlyphSvg` переименовывает локальные resource ID и их ссылки.
Семантические `data-part` сохраняются. `instanceId` уникален в документе, начинается
с латинской буквы и содержит до 64 букв, цифр, `-` или `_`.

## Получить семантический эффект

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/time';
import { compileSymbolEffect } from '@labpics/icons/motion';

const result = compileSymbolEffect(
  glyph(), glyphCapabilities(), 'time.advance',
  { duration: 400, from: 0.35, to: 1, reducedMotion: false },
);
if (!result.ok) throw new Error(result.reason.code);
console.log(result.effect.targets, result.effect.options);
```

Эффект задаёт семантические цели, ключевые кадры и длительность. Исполнение,
время и отмена находятся у motion-исполнителя. `from` принимает уже видимый прогресс
для продолжения после прерывания; `reducedMotion: true` материализует конечное состояние
с нулевой длительностью. Публичное исполнение и отмена описаны в документации
[Lab Motion](https://github.com/Labpics-Team/lab-motion).

Поддержка SVG, gesture, Lottie и SF Symbols читается из соответствующего контракта.
Каждый неподдержанный эффект получает машинный код отказа. Для форматов Lottie
и SF Symbols текущий контракт сохраняет `not-exported`.

## Добавить символ

Авторский master и его декларация остаются в общем authoring-пути. После обновления
каталога `node scripts/generate-symbol-surface.mjs` выводит release allowlist и
package exports из настоящих имён. `pnpm build` создаёт модули всех имён тем же compiler.
Собственный SVG parser или отдельный набор геометрии у потребителя не нужен.

`pnpm check:package-artifact` устанавливает чистый tarball и сравнивает источники,
default-части, возможности и поддержанные крайние значения осей с production IR.
Размеры и время выполнения измеряются на runner; [скрипт измерения](../scripts/measure-platform-artifacts.mjs)
сохраняет точный source SHA, среду, байты и реально включённые модули.
