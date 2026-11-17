# Lab Icons

330 авторских символов Lab UI, два независимых начертания, оптический вес и размер,
состояния и прерываемое движение. Один числовой источник служит SVG, Compose,
Lottie и dotLottie. Исходный макет Figma сохраняется без изменений.

## Начало работы

[Установка, требования к среде и точки входа](docs/package.md) формируются из
контракта поставки. Основной канал установки: публичный npm.

```sh
pnpm add @labpics/icons
```

Для исходного рисунка достаточно одной строки:

```js
import { outline } from '@labpics/icons/symbols/plus-circle';

document.querySelector('#icon').innerHTML = outline;
```

Для оптики используйте тот же символ с renderer:

```js
import plus from '@labpics/icons/symbols/plus-circle';
import { renderIcon } from '@labpics/icons/render';

document.querySelector('#icon').innerHTML = renderIcon(plus, {
  size: 20, weight: 500, opsz: 'auto', variant: 'outline',
});
```

`currentColor` наследует цвет элемента. `weight` — 300…600, `opsz` — 16…48;
`auto` следует логическому размеру и ограничивается оптическим диапазоном.
Исходная форма находится на 400/24. Импорт одного символа не подключает каталог;
сборщик удаляет числовую модель при использовании только `outline` или `filled`.
Декоративный SVG не заменяет доступное название кнопки.

## Состояния и движение

```sh
pnpm add @labpics/motion
```

```js
import * as motion from '@labpics/motion';
import microphone from '@labpics/icons/states/microphone';
import { createSymbolMotion } from '@labpics/icons/motion';

const view = createSymbolMotion(motion).mount(
  document.querySelector('#microphone'), microphone,
  { size: 24, weight: 400, state: 'on' },
);
view.setState('off');
view.set({ state: 'off', weight: 600, opsz: 32 });
// При удалении элемента:
view.dispose();
```

`symbols/<id>` содержит рисунок и жесты выбранного символа; `states/<family>`
добавляет связанные состояния. Совместимые части переходят из текущей видимой
геометрии; разные контуры заменяются с сохранением общей оболочки. В покое
нет таймера или покадровой работы. Публичный Lab Motion управляет часами.

[Показать и настроить символ](docs/render-symbols.md) ·
[Состояния, жесты, дата и прерывание](docs/symbol-motion.md) ·
[Lottie и dotLottie](docs/lottie.md) ·
[Compose](native/compose/README.md) ·
[Каталог](docs/catalog.md)

Ранний [glyph/GlyphIR API](docs/symbol-modules.md) сохранён для совместимости.
Его ограничения относятся к этой поверхности; новый renderer использует `IconSymbol`.

[SymbolSource](docs/symbol-source.md) связывает пару начертаний, masters, части и
общие компоненты. Каталоги и compatibility-аннотации генерируются из этого источника.

[Создать собственный символ](docs/authoring.md): DesignSpec задаёт конструкцию,
анатомию и ограничения; opt-in authoring-компилятор выдаёт GlyphIR и статический SVG.

## Работа с исходниками

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm catalog:build
pnpm catalog:check
```

`pnpm verify` включает сборку. Каталог создаётся в `preview/catalog/`: поиск,
начертания, вес, оптика, состояния, дата, движение и четыре формата скачивания.
Он использует публичные entrypoints пакета; числовые модели загружаются по выбору.
`node scripts/build-source-atlas.mjs` создаёт `preview/source-atlas.html`
с авторскими формами при размерах 16/24/48 px. `pnpm observatory` сохраняется
для сравнения ранних compatibility-моделей.

[Документация](docs/README.md) разделяет рабочие процедуры, точную справку и
объяснения. [Обновление авторского корпуса](docs/agent-workflow.md) описывает
read-only импорт полного снимка Figma через `pnpm sync:figma` и отдельную
миграцию при изменении состава семейств;
сборка и релиз — в [отдельной процедуре](docs/build-release.md), пределы
параметрических возможностей — в [справке](docs/capabilities.md).

## Лицензия

[MIT](LICENSE). Встроенный Geist распространяется по SIL OFL.
