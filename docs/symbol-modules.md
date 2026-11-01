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
Части имеют `role: 'unclassified'` и geometry-derived identity. Их bbox anchors
не объявляют смысл или correspondence для morph.

## Проверить допустимое изменение

Текущая авторская поверхность возвращает `modelState: null`, пустые `supportedAxes`
и `motion.state: 'source-only'`. Запрос любой известной оси, включая её прежнее
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
Для текущего source-only master он возвращает `SEMANTIC_MOTION_UNAVAILABLE`.
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
