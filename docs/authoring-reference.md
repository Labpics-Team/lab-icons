# DesignSpec v1: справочник

Публичная точка входа — `@labpics/icons/authoring`. Модуль экспортирует
`compileDesignSpec`, `parseDesignSpec`, `lowerDesignSpec`, `renderGlyphSvg`,
`designSpecContract`, `DesignSpecError` и типы DesignSpec.

## Компиляция

```ts
compileDesignSpec(spec: unknown, options: {
  icon: string;
  variant?: 'outline' | 'filled';
  size?: number;
}): DesignSpecGlyph
```

`icon` — имя вида `focus-beacon`: начинается с латинской строчной буквы,
содержит строчные буквы и цифры, допускает одиночные разделители `.` и `-`
между сегментами. Оно может обозначать новый знак вне встроенного каталога.
`variant` по умолчанию `outline`; автор задаёт геометрию каждого начертания
самостоятельно. `size` — конечное положительное число, по умолчанию 24.
Другие поля options, включая оси, отклоняются.

Результат совместим с `GlyphIR<string>`: `icon`, `variant`, `viewBox`, `parts`,
`d`, `svg`, `composition`, `provenance`. `viewBox` всегда `[0, 0, 1, 1]`;
`size` меняет только SVG width/height. Для показа и экспорта используйте `svg`
или `renderGlyphSvg`: объединённый `d` не содержит правил окраски и маскирования.

`provenance` содержит `kind: 'design-spec'`, `specVersion: 1`,
`specSha256: 'sha256:…'`, `state: 'candidate'`. Digest вычисляется из проверенной
спецификации с явными defaults и упорядоченными ключами объектов. Порядок массивов
сохраняется. Имя знака, начертание и размер в digest не входят.

`designSpec` сохраняет тот же digest, разрешённые `anchors`, исходные
`decorators`, проверенные `negativeSpace.constraints` и `topologyKey`.
Результат глубоко заморожен. У каждой части сохраняются id, role, zIndex,
контур, paint, topologySignature и morphGroup. Её `anchor` — центр bounding box
реального контура, `anchorSource: 'geometry-bbox-center'`; авторские именованные
якоря доступны отдельно в `designSpec.anchors`.

## Корневой объект

Все поля обязательны; массивы `decorators` и `negativeSpace` могут быть пустыми.

| Поле | Значение |
|---|---|
| `version` | Только `1` |
| `anchors` | Непустой массив именованных якорей |
| `parts` | Непустой массив частей в порядке рисования |
| `composition` | Одна из композиций ниже |
| `decorators` | Семантические отношения декораторов |
| `negativeSpace` | Явные измеряемые ограничения |

Неизвестные поля запрещены. Произвольные SVG/path, массивы контрольных точек
и анонимные transform/offset не входят в грамматику. Все ссылки разрешаются
по устойчивым id; дубликаты и циклы якорей отклоняются.

## Якоря

| `kind` | Дополнительные поля | Построение |
|---|---|---|
| `canvas` | `at` | `center`, `north`, `north-east`, `east`, `south-east`, `south`, `south-west`, `west`, `north-west` |
| `midpoint` | `between: [id, id]` | Середина двух якорей |
| `polar` | `from`, `angle`, `distance` | Смещение от якоря; угол −360..360°, расстояние >0..1 |
| `project` | `xFrom`, `yFrom` | x первого якоря и y второго |

Каждый якорь имеет `id`. Ось y направлена вниз, положительный угол идёт по
часовой стрелке. Разрешённые координаты остаются в `0..1`.

## Части

Часть содержит `id`, `role`, `geometry`, `paint`, необязательный `morphGroup`.
Роли: `body`, `content`, `ink`, `counter`, `container`, `control`, `detail`,
`decorator`. Role сообщает смысл; вычитание определяется composition.

| `geometry.kind` | Поля | Ограничения |
|---|---|---|
| `circle` | `center`, `radius` | 0 < radius ≤ 0.5 |
| `ellipse` | `center`, `rx`, `ry`, `rotation?` | 0 < rx, ry ≤ 0.5; rotation −180..180°, default 0 |
| `line` | `from`, `to` | Различимые якоря; только stroke |
| `arc` | `center`, `radius`, `startAngle`, `endAngle`, `direction` | radius >0..0.5; углы −360..360°; `cw` или `ccw`; sweep строго между 0° и 360°; только stroke |
| `capsule` | `from`, `to`, `radius` | Различимые якоря; radius >0..0.5 |
| `rect` | `center`, `width`, `height`, `cornerRadius?` | width/height >0..1; radius 0..min(width,height)/2, default 0 |
| `residual` | `recipe: 'superellipse'`, `center`, `rx`, `ry`, `exponent`, `rotation?` | rx/ry >0..0.5; exponent 2..8; rotation −180..180°, default 0 |

`center`, `from`, `to` ссылаются на якоря. Полная окрашенная часть должна
помещаться на холсте. Сериализация не должна превращать объявленную фигуру
в вырожденный контур. Residual ограничен зарегистрированной рецептурой;
произвольная функция или контур не принимаются.

Paint: `{ kind: 'fill' }` либо
`{ kind: 'stroke', width, linecap?: 'round' | 'butt' }`.
Ширина штриха >0..0.5 в долях холста; default linecap — `round`, linejoin —
`round`. Цвет — `currentColor`.

## Композиции и декораторы

| Композиция | Поля | Окраска |
|---|---|---|
| `layers` | Только `kind` | Отдельные fill/stroke части в порядке массива |
| `compound` | `fillRule: 'nonzero' \| 'evenodd'` | Один общий fill-контур; только fill части |
| `mask-subtract` | `basePartIds`, `subtractPartIds` | Base видны, subtract вычитаются luminance mask; fill и stroke |

В `mask-subtract` каждая часть входит ровно в один список, списки непусты.
У `compound` отдельная часть имеет `fillRule: null`: её нельзя окрашивать
самостоятельно с сохранением общей композиции.

Декоратор: `{ id, kind: 'overlay' | 'knockout' | 'enclosure', partId, targetPartIds }`.
`partId` указывает на часть с role `decorator`; targets — другие существующие
части. `knockout` требует `mask-subtract` и subtract-классификации. В этой
композиции overlay/enclosure относятся к base; targets всегда base.
Отношение не добавляет геометрию, авторазмещение или анимацию.

## Negative space

Ограничение: `{ id, kind, minimum, participants, measurement }`.
`minimum` находится в `0..0.5`; participants — существующие части.

| `kind` | `measurement` | Проверка |
|---|---|---|
| `exterior-margin` | `ink-bounds-to-canvas` | Минимальный отступ объединённых окрашенных bounds от canvas |
| `gap` | `axis-aligned-group-bounds-separation` | Расстояние между bounds ровно двух частей |

Gap измеряет расстояние axis-aligned bounds, а не точное расстояние контуров.
Совпадающие или пересекающиеся bounds дают 0. Повторное ограничение для тех же
participants и измерения отклоняется. Успешный результат хранит requiredMinimum,
measured, measurementMethod и participants; при нарушении результата нет.

## Ошибки

`DesignSpecError` содержит `code`, `at`, `message`.

| Код | Причина |
|---|---|
| `UNSUPPORTED_VERSION` | Версия отличается от 1 |
| `UNKNOWN_FIELD` | Поле отсутствует в закрытом контракте |
| `RAW_PATH_FORBIDDEN` | Передан произвольный SVG/path |
| `ARBITRARY_POINTS_FORBIDDEN` | Переданы произвольные точки или controls |
| `ANONYMOUS_TRANSFORM_FORBIDDEN` | Передан transform/offset |
| `DUPLICATE_ID` | Повторяется id |
| `UNKNOWN_REFERENCE` | Ссылка на отсутствующий якорь или часть |
| `ANCHOR_CYCLE` | Цикл в построении якорей |
| `INVALID_VALUE` | Неверный тип, диапазон или вырожденная геометрия |
| `UNDERDEFINED_CONSTRAINT` | Недостаточно данных для композиции/измерения |
| `CONTRADICTORY_CONSTRAINT` | Несовместимые отношения или классификация |
| `UNBOUNDED_RESIDUAL` | Неизвестная рецептура или параметры вне её области |
| `UNSUPPORTED_COMPOSITION` | Stroke внутри compound |
| `CONSTRAINT_VIOLATION` | Окрашенная геометрия или отступ нарушают требование |

API создаёт авторский candidate. Поддержка осей, morph, motion и других
форматов требует собственных доказанных контрактов; она не выводится из
валидной спецификации или SVG.

Правила fill, stroke и compound path следуют
[SVG 2, Painting](https://www.w3.org/TR/SVG2/painting.html) и
[SVG 2, Paths](https://www.w3.org/TR/SVG2/paths.html).
Публичный subpath использует
[Node.js package exports](https://nodejs.org/api/packages.html#subpath-exports).
Источники проверены 1 ноября 2026 года.
