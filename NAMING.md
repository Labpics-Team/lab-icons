# NAMING — канон имён @labpics/icons

Роль: канон (SSOT нейминга; машинную сверку держат `check:parity` и `check:docs-drift`).

## Канонический ID

Единственный источник имени глифа — **kebab-case ID** (`alert-circle`).
Реестр — отсортированные имена `svg/Outline/*.svg`; `check:parity` требует
ровно один парный Filled-файл, а catalog строится из этого множества. Новое имя
= новый Outline/Filled master; отдельный ручной список имён запрещён.

## Таблица производных (механические трансформации)

| Домен | Форма | Пример для `alert-circle` |
|---|---|---|
| ID (SSOT) | kebab | `alert-circle` |
| Outline-файл | `svg/Outline/<id>.svg` | `svg/Outline/alert-circle.svg` |
| Filled-файл | `svg/Filled/<id>_filled.svg` | `svg/Filled/alert-circle_filled.svg` |
| ESM-экспорты | `camel(id) + Вес` | `alertCircleOutline`, `alertCircleFilled` |
| Тип | union `IconName` из имён экспортов | — |
| Ключи semantics/anatomy | `<id>` как есть | `"alert-circle": { … }` |

`camel(id)`: kebab → lowerCamel (`alert-circle` → `alertCircle`).
Реализация трансформации живёт в `scripts/build.js` — SSOT кода, не копируется.

## Асимметрия файлов весов — замороженный контракт v0.x

`Outline/<id>.svg` без суффикса, `Filled/<id>_filled.svg` с суффиксом.
Это исторический контракт потребителей dist-тегов. Переименование сотен файлов =
breaking-change без выгоды: инвариант — не «симметрия», а **выводимость из ID**,
и её держит `check:parity`. Симметризация допустима только мажорным релизом
вместе с потребителями (labui `packages/icons`).

## Домены конвенций

- **kebab-case** — ID глифов, имена файлов, ключи JSON-реестров семантики;
- **lowerCamel** — JS-идентификаторы и параметры деклараций анатомии
  (`rTip`, `wRootDeg` — это параметры кода, не имена глифов);
- **snake** — нигде, кроме исторического суффикса `_filled`;
- **SCREAMING / Pascal** — нигде в публичных контрактах.

Смешение доменов (kebab-ID внутри camel-контекста и наоборот) — не дрейф,
а границы слоёв: имя глифа всегда kebab, код всегда camel, стык — только
через механическую трансформацию из таблицы выше.

## Чернила

Источники `svg/**` и артефакты `dist/svg/**` не несут цветовых атрибутов:
цвет наследуется от контекста потребителя (currentColor-паттерн).
Hex в dist запрещает `check:colors`; докам запрещено обещать конкретный hex
(`check:docs-drift`).

## Хендоффы

Эфемерные передачи — только в `handoffs/*.md`, обязательная строка `Статус:`.
`*-HANDOFF.md` в корне запрещены (`check:docs-drift`): хендофф, переживший
мерж своей волны, — это док, который «описывает не то».
