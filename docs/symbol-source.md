# Источник символа

`symbols/source.json` — редактируемый источник семейств. Ключ семейства связывает
Outline/Filled по provenance Figma. Наличие `fill` в SVG не определяет начертание:
оба варианта состоят из заполненных контуров.

Координаты находятся в неизменяемых SVG masters. `anatomy.parts` хранит селекторы
путей/контуров, paint-порядок и семантическую роль. `unclassified` честно означает,
что смысл частей ещё не задан. `semantic` описывает части без старого runtime law;
`declared` дополнительно воспроизводит существующий compatibility-контракт.

`components.circle-outline` ссылается на авторский контур и общий anchor. Plus,
minus, checkmark и mic в круге используют эту часть; сборка проверяет точное
совпадение path и fill-rule. Внутренний знак сохраняет собственные координаты.
Filled с отрицательным знаком хранит counter-контуры, а не независимые залитые слои.
Микрофон сохраняет свою форму и отдельное сужение capsule.

`pnpm generate:source` выводит `semantics/figma-baseline.json`,
`semantics/author-anatomy.json`, `semantics/author-state-groups.json` и
`semantics/anatomy.json`. Их не редактируют вручную.
`pnpm check:source` обнаруживает расхождение. Census и каталоги продолжают
генерироваться сборкой; старые модели хранятся внутри семейства как
`compatibilityModel`, чтобы не терять подтверждённые эксперименты прежнего IR.

## Статическое подключение

```js
import { plusCircleOutline } from '@labpics/icons';
import plusCircle, { outline } from '@labpics/icons/symbols/plus-circle';

console.log(plusCircle.id, outline === plusCircleOutline);
```

Именованный импорт SVG оставляет в bundle только строку. `symbol` и default export
дают неизменяемую пару `{id, outline, filled}`. Прежние `glyph`,
`glyphCapabilities`, states, variations и gestures сохраняются для существующего
LabUI consumer. Они выводятся из того же источника. Полный `/ir` отдельно использует
private `legacy-static.js`; его геометрия не подменяет обычный SVG.

`loadAuthorBaseline(...).icons[id][variant].rawSvg` в offline authoring возвращает
точные исходные bytes. Статика меняет только разрешённую обвязку экспорта и цвет на
`currentColor`, сохраняя path, winding и fill-rule.

## Обновление экспорта Figma

Figma `LuaiBd4anRi4DMZayKAnY2` строго только читается. Сначала сохраняют полный
экспорт того же набора семейств и manifest с file/node/version,
SHA-256 исходного SVG, нормализованного SVG и fingerprint путей.

```sh
pnpm sync:figma --capture <export-root> --manifest <receipt.json>
pnpm sync:figma --capture <export-root> --manifest <receipt.json> --write
```

Проверка читает весь снимок до записи. Неизменившиеся masters сохраняют прежний путь
и версию; изменённые пишутся под новой версией. Перезапись старого master запрещена.
Изменение геометрии снимает прежнюю семантическую аннотацию. Изменённые общие части
требуют согласования в исходнике; импорт отказывает до записи при нарушении ссылок.
Любое изменение SVG, участвующего в группе состояний, требует отдельной миграции
с пересмотром группы и не принимается через `sync:figma`. Изменение состава публичных семейств
выполняется отдельной явной миграцией. Каталог `svg/` — неизменяемый
compatibility-снимок; legacy-команда `import:figma` не обновляет этот источник.
Полный порядок работы приведён в [процедуре обновления корпуса](agent-workflow.md).

`capture.source.version` обозначает текущий снимок всего корпуса.
`variants[variant].provenance.version` закрепляет исходную версию отдельного
неизменяемого master; при отсутствии этого поля используется версия снимка.
Декларации анатомии и групп состояний относятся к текущему снимку, а каждый
участник сохраняет file identity, версию master и точные хэши геометрии.
Новая версия снимка с прежними bytes не требует копирования masters или
повторного объявления частей. Так локальный источник различает
[версию файла Figma](https://developers.figma.com/docs/rest-api/file-endpoints/)
и версию сохранённого экспорта каждого символа.

## Проверенный срез

На 2026-11-16 сохранённый корпус содержит 330 семейств и 660 вариантов.
[Прямая сверка live Figma](evidence/figma-20261116/live-comparison.json) подтверждает
неизменность компонентов между сохранённой и актуальной версиями при одинаковых
REST-параметрах. Исторические node hashes получены с другими параметрами ответа;
они не сравниваются между схемами.

Это CORPUS-01: источник, provenance, статический корпус, общая анатомия и
совместимость. `axisDesign` хранит выбранные опоры будущих weight/opsz и статус
`planned`; оптические masters всего корпуса, новый runtime `/render`, motion/native
экспорты и публикация 0.4.0 остаются следующими узлами плана.

Принципы: [Node.js subpath exports](https://nodejs.org/api/packages.html#subpath-patterns),
[Apple: общие части и анимация символов](https://developer.apple.com/videos/play/wwdc2023/10257/).
