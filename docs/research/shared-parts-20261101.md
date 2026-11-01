# Общая анатомия при смене выражения

Исследование и реализация 2026-11-01. Потребность — сохранить авторские глаза
и оболочку при замене выражения, новом намерении и reduced motion. Полупрозрачное
наложение копий общего рисунка нарушает это свойство даже при точных endpoints.

## Сохранённые авторские источники

Figma file `LuaiBd4anRi4DMZayKAnY2`, saved version `2416636003859748575`.
Raw masters и normalized fingerprints сверяются с
[manifest](../../semantics/figma-baseline.json).

| Outline artwork | Node | Raw master SHA-256 |
|---|---|---|
| aloof | `6431:3990` | `df2d9ece2246c61af4df7426e6cff3cced5127ce5b6c11fc4f16cb34a527bf37` |
| sad | `6431:3945` | `22fd0474e67c0283f2f55e42e2f355d9e9adc25c506193522e95ba7e7519def2` |
| smile | `6431:3966` | `659c4a9a04c83420d61a233959c9b9ba2557426e30ab363146c9286ff997f2b9` |

Mouth — path 0. Paths 1/2/3, левый глаз/правый глаз/оболочка, совпадают
буквально во всех трёх raw masters. SHA-256 объединённых raw suffix tags —
`eada858955eb69f5923a6d48c2e83d1566d46dcca13c346b90a1b64ea05a7655`.
Глаза имеют nonzero rule; оболочка — evenodd с двумя закрытыми контурами.
Filled каждого artwork содержит одну evenodd compound path: выделение
положительных eyes/enclosure из неё не следует. Его transition не принимается.

Это evidence saved source. Live Console возвращал `Transport closed`;
unsaved parity и новая optical admission не установлены.

## Почему сохраняется точный suffix

[SVG2 group opacity](https://www.w3.org/TR/SVG2/render.html#ObjectAndGroupOpacityProperties)
применяется к результату всей группы. По
[source-over equation](https://www.w3.org/TR/compositing-1/#simplealphacompositing)
две одинаковые opaque копии с opacity .5/.5 дают alpha .75; три копии
с .2/.3/.5 дают .72. Это математический контрпример, не выполненный raster
benchmark. Замена всего interior затемнила бы неизменные глаза.

| Способ | Проверенное ограничение | Выбор |
|---|---|---|
| Оставить только отдельные static SVG | Точная форма сохранена, переход выражения отсутствует | Static route сохранён, полезный transition реализуется отдельно |
| Произвольное сопоставление общих paths | Hash не доказывает допустимость перестановки относительно changing paint blocks | Не вводить arbitrary extraction |
| Isolated plus-lighter | True crossfade сохраняет одинаковые пиксели, но требует blend/stacking semantics и возможного offscreen pass | Сильная альтернатива для иных форм; не требуется этим masters |
| Точный общий suffix | Сохраняет исходный paint order и fixed parts один раз, без дополнительного blending API | Расширить существующий compiler |
| Mouth morph | Команды и соответствие контуров различаются; один closed contour не доказывает correspondence | Morph недоступен |

[View Transitions](https://www.w3.org/TR/css-view-transitions-1/) используют
isolated `plus-lighter`; [WICG #167](https://github.com/WICG/shared-element-transitions/issues/167)
обсуждает offscreen cost. В [CSSWG #9983](https://github.com/w3c/csswg-drafts/issues/9983)
автор отозвал утверждение о необходимости linear easing: при одинаковом easing
и синхронных дополняющих весах сумма сохраняется. Новый закон не выводится
из ошибочного ограничения linear-only.

[Apple WWDC25/337, 6:02](https://developer.apple.com/videos/play/wwdc2025/337/)
сохраняет matching enclosure и заменяет differing layers. Это ориентир
семантического разделения, не алгоритм extraction произвольных авторских paths.

## Один владелец и проверяемые отказы

Authoring schema 2 содержит ordered `sharedParts: [{id, role}]`. Последняя
shared part обязана быть container с `enclosurePartId`. `contentPartIds`
каждого member задаёт полный непустой changing prefix; suffix начинается
сразу после него. Второго списка индексов и per-icon координат нет.

Существующие status/playback группы используют тот же закон с suffix длины 1.
Компилятор сравнивает каждый shared contour, rule, paint и рамку в исходном
порядке. Если последняя часть changing prefix равна во всех members, она
получает `SHARED_PART_UNDECLARED`: её нужно явно включить в shared anatomy.
Этот guard закрывает ошибочное возвращение общих глаз в fading groups.

Runtime получает precompiled `sharedSvg` один раз, stable `sharedPartIds`
и независимые prefix strings. Public render/effect entrypoints и contract
`labpics.symbol-state-effect/1` сохраняются; Motion продолжает владеть
clock и исполнением. Observatory читает shared IDs из capability.
Schema 1 авторского документа отвергается явно; это внутренний source migration,
а не второй runtime или обещание поддерживать старый authoring format.

Новые source counterexamples перепривязывают допустимые master hashes после
удаления глаза, изменения его geometry/rule, перестановки глаз и изменения
оболочки. Они получают соответственно topology/shared/enclosure refusals.
Filled compound и stop-circle с оболочкой первой также получают отказ.
Installed raw oracle проверяет весь suffix вне opacity-групп и обнаруживает
дублирование или движение fixed parts.

## Выполненное и оставшееся

Bounded dependency-free probe на Node `v24.15.0` исполнил точный JS admission
compiler и точный TS state runtime через builtin stripping. Raw hashes и
path fingerprints сверены с manifest; все 11 состояний трёх групп сохраняют
ordered geometry/rules, shared-part census и точные отказы. Подготовленная
literal SVG обвязка, geometry compiler и serializer в этом probe — fixtures;
production SVGO/loader/compiler linkage не исполнялись.

Regression cases сохранены в настоящем source/installed conformance harness.
Full Vitest, typecheck/build/pack, browser interruption, raster 16/24/48,
native targets и реальные bytes требуют self-hosted evidence. Уменьшение
копий raw eye tags не выдаётся за measured shipping или frame-time улучшение.
