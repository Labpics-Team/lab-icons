# Направленный жест в настоящем SVG consumer

Observatory исполняет `direction.nudge` для восьми авторских семейств:
`chevron-back/forward/up/down` и `arrow-back/forward/up/down`, каждое в Outline
и Filled. Figma-файл `LuaiBd4anRi4DMZayKAnY2`, версия
`2416636003859748575`; node/hash receipts сохранены в
`semantics/figma-baseline.json` и `semantics/author-anatomy.json`.

Effect v3 передаёт публичному `sequence` Lab Motion scalar `x/y` stages в
единицах viewBox. Первый этап при явной инициализации получает `[from,to]`;
новый interval подхватывает видимую позу. Фаза сохраняется отдельно: одинаковый
сдвиг в 0,25 и 0,75 требует разных продолжений при обратном движении.

## Проверено

Windows, Node `24.15.0`, Chrome `156.0.8078.74`, установленный публичный
`@labpics/motion@0.5.0`. Короткая source materialization использует production
compiler, `renderSymbolModule`, effect compiler и текущий Observatory.

- `runExplorerJourney()` прошёл 355 из 355 проверок. Все 16 вариантов сохранили
  точные `d`, fill-rule и доступные source controls; не принятые оси отсутствуют.
- `getScreenCTM()` подтвердил сдвиг `±size/8` на 16/24/48 px. Отдельный
  синтетический viewport `10 20 48 48` подтвердил отрицательный `x/y` сдвиг
  при тех же размерах; авторские SVG для этого опыта не изменялись.
- Реальное движение сохранило позу при reverse и смене цели, различило
  продолжения из фаз 0,25 и 0,75, остановилось на паузе и повторило завершённый
  цикл. Reduced motion принял последнюю конечную позу.
- Экспорты v3 effect и Lottie прошли для всех 16 вариантов. Lottie download
  сохранил source receipt и три позиционные ключевые точки: покой, максимум,
  покой. Оба circle-варианта отказали nudge.
- Восемь focused consumer tests прошли. Oracle проверяет viewBox units и
  поворотную точку; подмена unit на `px` не прошла admission.

Immutable executor из `fc2f1e163a8d04819aa98cbd9ed14975a8b892f1` прошёл прежние
сценарии, затем обнаружен RED на первом nudge: check 133,
`chevron-back/outline/nudge-16px-viewbox-units`. Новая effect-анатомия в этом
контроле сохранена; заменён только executor. Отказ прежней версии оставил
сдвиг нулевым.

[Полный browser result и хеши](author-nudge-consumer-20261101.json).
[Авторские формы и максимальный сдвиг на 16/24/48 px](author-nudge-consumer-20261101.png)
просмотрены в натуральном масштабе. Отдельный source снимок Observatory на
112 px сохранён рядом с локальным browser result.

## Область вывода

Эта запись подтверждает source browser behavior и сохранение проверенных
авторских форм. Полный build/pack, installed Lab Icons consumer,
сравнительные CPU/память/bundle benchmarks, exact-head CI и npm publication
локально не выполнялись. Удалённый clean-consumer lane исполняет этот же
journey после штатной упаковки. Полная независимая оптическая приёмка 660
мастеров остаётся открытой.
