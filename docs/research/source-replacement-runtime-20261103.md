# Цена и граница авторской замены

**Diátaxis:** explanation. Исследование 2026-11-03; исходный срез
`c2d0f557784922ee8fe0e8b9bcc76e5eed7933f9`, интеграция `2bf18f9`.
Полная упаковка, browser acceptance и comparative benchmark этого среза
ещё не установлены.

## Решение

`source.replace` сохраняет самостоятельные on/off masters микрофона и видимости.
Разбор и сопоставление геометрии остаются в author compiler. Runtime получает
готовые SVG-строки и opacity stages; исполнитель Lab Motion получает прежний
общий effect contract. Общая оболочка и контурный morph отсутствуют в обещании.

Отдельный source entry проверяет только специфичный допуск: несовместимое
начертание и неподдержанную вариацию. Общий runtime создаёт SVG, проверяет целевое
состояние и длительность запроса, формирует описание эффекта. Исполнение и управление
непрерывностью при прерывании остаются у Lab Motion. Вид эффекта задаётся
author compiler через один string `define`; каталог и shape parser в runtime
не добавляются. Source entry без правильного build profile явно отказывает при
импорте. Прямой consumer не обязан знать этот build flag.

[esbuild, Define](https://esbuild.github.io/api/#define), прочитан 2026-11-03,
подтверждает inline substitution и constant folding для scalar literals.
Объекты и массивы имеют другую семантику и не обеспечивают такое же сворачивание.
Поэтому здесь подставляется только имя вида эффекта через JS build API.
Собственный AST-препроцессор и переписывание результата сборки не нужны.
Широкое изменение minifier flags также не требуется для этого выбора.

## Узкое сравнение

Production bundle flags, тот же consumer и gzip oracle. Сохранённые JSON-отчёты
не содержат metadata окружения. Readback 2026-11-03: Windows x64, Node 24.15.0,
esbuild 0.28.1, fflate 0.8.3; он не устанавливает окружение прежнего запуска.
Измерены только выбранные targets и четыре существующих entries; полная сборка
и browser timing локально не выполнялись.
Сохранены исходные JSON: [baseline](source-state-budget-20261103/baseline-existing-consumers.json),
[candidate](source-state-budget-20261103/current-existing-consumers.json) и
[source runtime](source-state-budget-20261103/source-leaf.json). Поля max в них
являются прежними ceilings; таблица использует измеренные bytes/gzipBytes.

| Объект | `44f9c10`, raw/gzip B | `c2d0f557`, raw/gzip B |
|---|---:|---:|
| Прежний state runtime | 4003 / 1583 | 4036 / 1581 |
| Status state-variation consumer | 13990 / 5282 | 13964 / 5273 |
| Playback state-variation consumer | 10512 / 3828 | 10486 / 3821 |
| Status enclosure patch consumer | 4808 / 1935 | 4806 / 1935 |
| Playback enclosure patch consumer | 4812 / 1935 | 4812 / 1935 |

Новый opt-in runtime: 6176 / 2038 B, closure — `runtime.ts` и
`source-runtime.ts`. Это target measurement, а не цена установленного символа.
Первые ceilings новых artifacts и consumer entries принимаются только из полного
self-hosted measurement; прежние ceilings, dependency restrictions и controls
сохраняются. Малые изменения gzip не объявляются полезным ускорением.

## Пределы следующего перехода

Точные off-masters содержат вырезанные участки. Один slash поверх изменённого base
не восстанавливает эти рисунки; `bodyWidth` на off-состоянии пока получает отказ.
Это сохраняет авторский рисунок и определяет следующий спорный переход, вместо
скрытого сброса параметра. Контекстная конструкция круга из base, weight/opsz и
brand profile остаются отдельными требованиями
[активного плана](https://github.com/Labpics-Team/agents-config/blob/main/plans/product-lab-icons/ACTIVE.md).
Авторская причина отказа описана в [контекстной геометрии](microphone-context-20261102.md).

Opacity не требует пересчёта geometry на каждом кадре. Она всё же может иметь
цену слоёв, texture и rasterization: [Chrome](https://developer.chrome.com/blog/hardware-accelerated-animations)
и [rendering pipeline](https://web.dev/articles/animations-overview) описывают
границы compositor acceleration. Низкую стоимость множества переходов
устанавливает реальный consumer benchmark; выбор свойства её не доказывает.
