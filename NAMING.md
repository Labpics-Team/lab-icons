# Имена Lab Icons

## Идентификатор и производные имена

Имя глифа — kebab-case ID, например `alert-circle`. Исходные имена берутся
из ключей `symbols` в [SymbolSource](symbols/source.json); парность вариантов проверяется отдельно, а производный
каталог не редактируется как второй независимый список.

| Представление | Форма | Пример |
|---|---|---|
| ID | kebab-case | `alert-circle` |
| Outline-master | `masters/figma/<version>/Outline/<id>.svg` | Путь из `variants.outline.provenance.master` |
| Filled-master | `masters/figma/<version>/Filled/<id>.svg` | Путь из `variants.filled.provenance.master` |
| Статический экспорт | lowerCamel ID + вариант | `alertCircleOutline`, `alertCircleFilled` |
| Тип | PascalCase | `IconName` |
| Ключ декларации анатомии | Исходный ID | `alert-circle` |

Трансформацию статических имён выполняет [сборка](scripts/build.js).
Текущую поверхность контролирует [снимок экспортов](release/export-surface.json).
Имена в машинном контракте не переводятся вместе с поясняющим текстом.

## Совместимость путей

Версия и вариант входят в путь неизменяемого master. Прежние
`svg/Outline/<id>.svg` и `svg/Filled/<id>_filled.svg` сохраняются как
compatibility-снимок и не редактируются для обновления корпуса. При переименовании
учтите потребителей и [класс совместимости](docs/semver-policy.md).
Производные имена вычисляются из ID сборкой.

## Цвет

SVG наследуют `currentColor`. Команда `check:colors` проверяет цвет в
поставляемых файлах. Описывайте использование цвета через этот контракт.

## Рабочие записи

Открытые задачи обсуждаются в Issues и PR. Результаты исследований сохраняются
вместе с входными данными и методом воспроизведения, отдельно от инструкций
по использованию библиотеки.
