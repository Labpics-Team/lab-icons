# Lab Icons

Авторские SVG и геометрическое представление символов Labpics.
Модули отдельных символов используют закреплённые masters Lab UI v2.1 и
наследуют `currentColor`. Возможности модели, осей и жестов читаются из контракта варианта.

## Начало работы

[Установка, требования к среде и точки входа](docs/package.md) формируются из
контракта поставки. Основной канал установки: публичный npm.

Примеры описывают собранный checkout; публикация выпуска проверяется отдельно.
Текущий авторский символ подключается одной SVG-строкой:

```js
import { outline } from '@labpics/icons/symbols/accessibility';

console.log(outline);
```

Части и возможности символа подключают через его собственный модуль:

```js
import { glyph, glyphCapabilities } from '@labpics/icons/symbols/time';

const source = glyph({
  variant: 'outline',
  modelMode: 'source-only',
});
const capabilities = glyphCapabilities('outline');
console.log(source, capabilities);
```

Default и `source-only` возвращают один неизменяемый авторский результат.
`source.provenance.author` связывает его с Figma file/node/version и хешами master.
До доказательства паритета текущей авторской формы запрос оси или candidate-модели
получает `AUTHOR_PARITY_REQUIRED`.

[Отдельные символы, части, оси и эффекты](docs/symbol-modules.md) показывают полный
путь подключения. Корневой `@labpics/icons` и полный `@labpics/icons/ir` сохраняют
записанный ранее корпус для совместимости; его модели и жесты относятся к тому baseline.

## Работа с исходниками

```sh
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` включает сборку. Для геометрического сравнения выполните
`pnpm observatory` и откройте созданную локальную страницу. На ней можно сравнить
исходную геометрию с моделью перед визуальным ревью.

[Документация](docs/README.md) разделяет рабочие процедуры, точную справку и
объяснения. Добавление иконки описано в [процедуре приёма](docs/agent-workflow.md),
сборка и релиз — в [отдельной процедуре](docs/build-release.md), пределы
параметрических возможностей — в [справке](docs/capabilities.md).

## Лицензия

[MIT](LICENSE).
