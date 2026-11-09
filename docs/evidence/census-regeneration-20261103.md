# Census после разделения runtime

На 2026-11-03 `semantics/census.json` получен штатным генератором из удалённой
сборки Icons `599f91308ee00356b89fab4d84a3c7913bab0357`.
[CI job](https://github.com/Labpics-Team/lab-icons/actions/runs/41587574307/job/125757048688)
завершился отказом на прежнем census и вернул точный generated JSON.
Отказ всего job сохранён; успешным считается только получение этой проекции.

Полученные bytes сверены с SHA-256
`0b3ccff1b8e2ebfa68a84b8395fa82888967e8f6af5fe83a3e28f79aa9b290e4`
и записаны без ручной правки. [Receipt](census-regeneration-20261103.json)
содержит source/job identity и все изменившиеся поля. Генератор, catalog,
anatomy, SVG и path-data совпадают с входами указанного source.

| Файл | Raw B | gzip B |
| --- | ---: | ---: |
| `dist/index.js` | 365324 | 96297 |
| `dist/ir/index.js` | 379932 | 74017 |

Gzip здесь вычисляет Node `zlib.gzipSync` с обычными параметрами генератора;
это отдельная методика от package-size ratchet с закреплённым fflate.
Поле raw и атрибуция модулей теперь считают UTF-8 bytes, а не длину JS-строки.
Размер entrypoint не устанавливает транзитивный footprint одного consumer.

Проверка свежести сравнивает Buffer и сохраняет проверяемый файл при отказе.
Пять focused tests и независимое ревью проверили stdout/default-generation,
неполные входы, stale snapshot и повреждение UTF-8. Прежний checker воспроизвёл
ошибочную перезапись, а строковое сравнение пропустило повреждённый байт;
regression controls обнаруживают оба дефекта.

Новый полный exact-head CI, установленный Lab UI consumer и merge остаются
отдельными гейтами. Тяжёлые build/pack/browser/benchmark локально не выполнялись.
