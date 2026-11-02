# Независимые функции полного Glyph IR

Импорт `glyph` из `@labpics/icons/ir` теперь удерживает построение glyph без
calendar recipe и writer motion capabilities. `parseGlyphRequest` и
`glyphCapabilities` также удаляют геометрические ветви. Полный каталог остаётся
явным opt-in; обычные потребители используют `symbols/<id>`.

Прежний `index.ts` создавал frozen объект со всеми методами, а named exports
читали его свойства. Узкий installed consumer на `8fbb434` подтвердил удержание
неиспользуемых методов: две проверки удаления calendar code получили RED.

Одна приватная сессия по-прежнему владеет catalog, anatomy, grid, неизменяемыми
снимками осей и реестром candidates. В сессии нет объекта всех методов.
Функциональные реализации получают эту сессию; публичный entrypoint объявляет
named функции напрямую. `createGlyphCompiler` сохраняет полный frozen фасад.
Admission, геометрия и candidate-регистрация имеют по одной реализации.
Закрытый тип сессии передаёт entrypoint только публичные снимки. Конкретные
catalog и registry types остаются внутри реализации; возвращаемый фасад
использует явный `GlyphCompiler`, сохраняя дополнение candidate writer.

PURE-вызовы фабрик были проверены и отклонены: production whitespace emit
удаляет комментарии, и следующий bundler удерживал вызовы. Прямые объявления
работают после этого emit без изменения build policy и `keepNames`.
[Документация esbuild](https://esbuild.github.io/api/#tree-shaking) объясняет
консервативное удаление эффектов; [issue 1990](https://github.com/evanw/esbuild/issues/1990)
описывает потерю PURE-комментариев. Асинхронный import изменил бы синхронный API;
отдельные сессии для методов нарушили бы candidate-регистрацию.

## Проверка

2026-11-02, Windows x64, Node 24.15.0, esbuild 0.28.1, fflate 0.8.3,
gzip level 9 / mtime 0. Production helper выпускает compiler/index/request.
Ограниченный static fixture использует настоящие исходники `reload`, `time`
и двух calendar shells с каноническим SVGO. Затем `npm pack` и offline install
переносят bytes в отдельного consumer; hashes установленных файлов сверяются.
Пакет закрывает внутренний session путь через `exports`.

Сравнение с `8fbb434` использует те же fixture и production flags. Debug bundle
проверяет достижимость конкретных функций, а не строки состояний в catalog.
Каждый minified bundle исполняется и сравнивается с baseline.

| Consumer | Baseline raw/gzip, B | Изменение raw/gzip, B |
| --- | ---: | ---: |
| glyph | 495973/113952 | 482464/110029 |
| capabilities | 495940/113934 | 407831/85897 |
| calendar | 495988/113972 | 439703/95379 |
| parser | 495949/113940 | 407557/85623 |
| весь namespace | 501058/114886 | 501426/114813 |

Native compiler вырос с 120591/37074 до 122393/37364 B и сохраняет прежний
потолок 154789/42120 B. Это реальное изменение потребительского замыкания внутри
одного compiler файла; перенос кода между budget entries не использовался.

Шесть consumer tests проверяют сохранение names/arity, getter reads, ошибок,
порядка полей, frozen snapshots и общей identity осей. Packed type consumer
разрешает корректный запрос и отвергает неизвестные icon/variant, неверный тип
оси и импорт приватной сессии. `compiler.d.ts` занимает 7800/2588 B при прежнем
потолке 10290/2736 B; `index.d.ts` — 1937/559 B при 10152/3088 B.
Candidate writer открывает
reader той же сессии; вторая сессия остаётся закрытой, повторная регистрация
не перезаписывает декларацию. Дополнительно прошли 47 существующих проверок
author baseline, вариативности, annulus и compiled runtime policy; `tsc --noEmit`
и `git diff --check` прошли.

[Машинный отчёт](compiler-entrypoints-20261102.json) содержит source digests,
tarball и consumer hashes, metafile contributions и retained-function witnesses.
Полная сборка пакета и точная внешняя consumer пара остаются удалённым гейтом;
этот ограниченный fixture их не квалифицирует. Registry SVG 0.2 parity, browser
rendering, timing и memory stress в данном опыте не проверялись.
