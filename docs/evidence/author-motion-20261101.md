# Авторское движение и Observatory

На 2026-11-01 Observatory показывает 330 семейств и 660 независимых мастеров
[закреплённой Figma-версии](figma-20261101.md). Production compiler принимает
анатомию `reload` и `refresh` в обоих начертаниях: точный целый контур вращается
вокруг явно объявленного центра canvas. Source-motion commit:
`38533b4bb27ea15b6d08ec158311f4e3556d7788`.

## Выполненная проверка

Короткий browser smoke использовал исходный Observatory и четыре модуля,
построенные настоящим source compiler/renderSymbolModule. Остальная preview
проекция оставалась source-only. Упаковка всего проекта локально не выполнялась.

- Windows, Chrome `156.0.0.0`; публичный `@labpics/motion@0.5.0`.
- `runExplorerJourney()` прошёл **106 из 106** проверок: независимые master paths,
  receipts, controls, SVG/effect export, отказы Lottie/SF, клавиатурный focus,
  ошибки текущей и устаревшей загрузки, независимые Filled instances и cleanup.
- Пауза фиксирует позу и индикатор. На границе reverse admission:
  `39.96001548194913° → 39.96001548194913°`.
- Scrub применяет нулевую длительность; повтор завершённого цикла создаёт новое
  occurrence. Reduced motion сразу принимает конечную позу.
- Изолированное UI-ревью нашло потерю паузы во время первого lazy import и
  устаревшую кнопку «Продолжить» после scrub. Исправленный pending intent хранит
  паузу до admission. Проверка задержала реальный module request: после загрузки
  progress и угол остались `0`, затем «Продолжить» запустила движение. Scrub
  завершает прежнее occurrence и выключает его Pause control.
- Текущий `time` отказывает `time.advance`: сваренные руки не получили допуск
  прежней двухчастной модели.
- Syntax и `git diff --check` прошли. Core targeted tests/typecheck/security и два
  изолированных source review относятся к commit выше.

Рендеры: [desktop, viewport 1440×960](author-motion-desktop-20261101.png) и
[mobile, viewport 390×844](author-motion-20261101.png). Снимки показывают текущую
авторскую основу; полная оптическая приёмка 660 вариантов остаётся открытой.

## Удалённая цепочка

Существующий clean-consumer lane вызывает `verifyExplorer()` на замороженном
candidate после его штатного prepack. Проверка строит Observatory, выполняет
тот же journey, сохраняет JSON и desktop/mobile PNG и освобождает browser/server.
Packed runtime/type consumer проверяется отдельно этим же lane.

На момент записи self-hosted jobs находятся в очереди. Полный build, packed
consumer, performance comparison и merge этого среза **ещё не подтверждены**.
Функциональный preview не задаёт чисел производительности или publication claim.

## Loading и typing

Core `e05b25a0901c8fbfd7e6f5240974dca94a9b597d` добавляет один закон
`activity.triad` для трёх вариантов: `ellipsis-horizontal/outline`,
`ellipsis-horizontal/filled`, `chatbubble-ellipses/outline`. Последний сохраняет
неподвижную авторскую оболочку. Аннотации всех семи motion-вариантов проверены
отдельно от конструктивного и axis admission.

V2 effect содержит scalar opacity stages в миллисекундах. Consumer передаёт их
публичному `sequence` Lab Motion; последний владеет часами и текущей позой.
Движение не изменяет `d`, fill-rule или порядок. Paused→reverse admission сохранил
точные opacity трёх частей во всех трёх browser cases; idle вернул opacity `1`.
Filled chatbubble с одним compound path и вертикальное меню остаются без жеста.

Короткая materialization расширена до четырёх семейств / восьми вариантов,
остальная source-only preview проекция сохранена. Journey обнаружил RED: reduced
motion после нового ожидающего idle использовал старую reverse-цель. Исправленный
UI берёт последнюю pending-цель. Проверки idle+reduced и видимых ошибок загрузки
входят в 106 checks. Управление движением расположено рядом с preview; точные
file/node/version доступны в «Основа и версия».

[Рендер typing с неподвижной оболочкой](author-triad-20261101.png) снят при
viewport 1440×960. Core targeted suite: 95 tests / 6 test files и typecheck прошли.
Два изолированных core review прошли; локальный full build/pack/benchmark не
выполнялся. Browser evidence относится к source preview, installed chain остаётся
за удалённым self-hosted lane.

## Входящее уведомление

Срез от 2026-11-02 добавляет `notification.ring` для `notifications` и
`notifications-unread`, Outline и Filled, на той же Figma-версии
`2416636003859748575`. Manifest сохраняет 330 семейств / 660 вариантов;
выборка проверки содержит три семейства / шесть masters, включая
неаннотированный `notifications-off`. [Receipt](notification-ring-20261102/source-receipt.json)
закрепляет source hashes, пути, части и проверенную среду.

Явный смысл `incoming-notification` назначает один затухающий горизонтальный
цикл язычка. Амплитуда — общая четверть ширины `notification-clapper`;
позы `0 → +A → −A → +A/2 → −A/2 → 0` заданы через равные пятые прогресса.
Корпус и badge неподвижны. Закон использует существующие translate tracks,
effect v3 и Lottie position keyframes. Шарнир и отдельный исполнитель не добавлены.
Observatory получает список жестов из capabilities через существующий selector.

- **Да:** исходный [feature RED](notification-ring-20261102/red.log) —
  `LAW_UNSUPPORTED` для `notification.ring`; остальные 23 tests намеренно skipped.
- **Да:** [26/26 targeted tests](notification-ring-20261102/green.log) проверяют
  независимые raw paths/fill-rule/z-order, source receipts, ширину через
  экстремумы Bernstein-полиномов, шкалу и reverse/partial intervals,
  одинаковые позы разных фаз, reduced motion, неизменные Lottie curves и
  точные отказы для off, muted/disabled и ошибочных аннотаций.
- **Да:** [81/81 соседних tests](notification-ring-20261102/regression.log)
  включают author anatomy, nudge, confirmation и ring.
- **Да:** [две deliberate mutations](notification-ring-20261102/topology-sensitivity.log)
  по отдельности удаляют compound/closed guards. Каждая даёт предметный RED
  на своём `nonzero` source-contract witness; законный контроль проходит.
  Это синтетическая проверка границы анатомии. Исходник восстановлен с проверкой digest.
- **Да:** syntax, `git diff --check`, неизменность masters и manifest,
  `check:repo-contract` и проверка изменённых страниц.
- **Нет:** общий [check:docs-drift](notification-ring-20261102/docs-drift.log)
  сохраняет замечания baseline в `size-policy-20261101.md` и
  `symbol-payload-split-20261101.md`. Эти страницы не входят в срез.
- **Не было:** локальный full build, browser, Lottie player, установленный
  consumer, performance comparison и полная оптическая приёмка.

Промежуточные отказы тестового oracle сохранены отдельно: raw master использует
`H`, normalized topology — `L`; общий GlyphIR содержит bbox anchor metadata;
нулевая Lottie position может различаться знаком `0`. Эти исправленные
предпосылки oracle не являются product RED.

Source-проверка не закрывает independent review, обязательный удалённый CI,
packed consumer и delivery readback. После публикации родительский срез
закрепляет их на точном SHA. Откат source-среза — revert его commit;
master SVG и текущая опубликованная версия этим срезом не изменяются.
