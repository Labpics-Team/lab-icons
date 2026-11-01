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
- `runExplorerJourney()` прошёл **75 из 75** проверок: независимые master paths,
  receipts, controls, SVG/effect export, отказы Lottie/SF, клавиатурный focus,
  ошибки текущей и устаревшей загрузки, независимые Filled instances и cleanup.
- Пауза фиксирует позу и индикатор. На границе reverse admission:
  `39.96001548194913° → 39.96001548194913°`.
- Scrub применяет нулевую длительность; повтор завершённого цикла создаёт новое
  occurrence. Reduced motion сразу принимает конечную позу.
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
