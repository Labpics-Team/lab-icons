# Expression-face: состояния, части и отказы

**Diátaxis:** reference.

Точка входа: `@labpics/icons/states/expression-face`.
Состояния: `aloof`, `sad`, `smile`; начальное — `aloof`.
Порядок подключения приведён в [инструкции](expression-face.md).

## Части

`stateCapabilities().sharedPartIds` и `effect.unchangedPartIds` содержат
`face-left-eye`, `face-right-eye`, `face-enclosure` в этом порядке.
Два глаза и оболочка сохраняются один раз и не входят в `effect.stages`.
Переход меняет прозрачность групп с контурами рта.

## Варианты и отказы

Группа поддерживает только Outline. Авторские Filled содержат один составной
контур с правилом `evenodd` и доступны как независимые статические экспорты,
например `filled` из `@labpics/icons/symbols/smile`.

`compileStateEffect(state, request)` принимает объект только с `duration`,
`reducedMotion` и `variant`. `exportStateTransition(state, request)` принимает
те же параметры и обязательный `format`. Поддержанный формат — `web-effect`.
`duration` — конечное число ≥0; `reducedMotion` — необязательный boolean.
`variant` — необязательный `outline` или `filled`, по умолчанию `outline`.

При остальных корректных параметрах:

| Метод и запрос | Код отказа |
|---|---|
| `render`, `renderStateSvg`, `compileStateEffect` или `exportStateTransition`: `variant: 'filled'` | `VARIANT_UNSUPPORTED` |
| Любой из этих методов: неизвестное состояние | `STATE_UNSUPPORTED` |
| `exportStateTransition`: `format: 'lottie'`, `'dotlottie'` или `'sf-symbols'` | `FORMAT_UNSUPPORTED` |
| `compileStateEffect`: поле `format`, включая `format: 'lottie'` | `INVALID_REQUEST` |
| Любой из этих методов: лишнее поле или `variant` вне `outline`/`filled` | `INVALID_REQUEST` |
| `compileStateEffect` или `exportStateTransition`: некорректные `duration`/`reducedMotion`; для экспорта также отсутствующий или нестроковый `format` | `INVALID_REQUEST` |

Геометрическое соответствие контуров рта для морфинга не доказано.

## Авторская основа

[Семантическая спецификация](../semantics/author-state-groups.json) закрепляет
хеши авторских SVG, версию Figma и полный порядок изменяемых и общих частей.
Компилятор проверяет равенство всех общих частей; пропущенный общий глаз
получает отказ до выдачи модуля.

[Объяснение общей анатомии](research/shared-parts-20261101.md) содержит
источники, альтернативы и границы проверки. Проверки исходников не подтверждают
установку, браузерные переходы, растровое сравнение или совпадение с несохранёнными
правками живого файла Figma.
