# Четыре авторских варианта микрофона у consumer

**Diátaxis:** reference. [Self-hosted run](https://github.com/Labpics-Team/labui/actions/runs/41508710908/job/125494614263)
завершился SUCCESS 2026-11-02 в 20:01:08 UTC. Точная пара: Icons
`61111d12f58642cc6d6f6c45e17166765bd2ca8f`, Lab UI
`85ad9c23d511870f1d1c32d3f0911f31713ce7dc`. Linux/X64, Node 22.19.0,
Chromium 140.0.7339.186, Ryzen 9950X, восемь доступных CPU.

Установленные source-pack пакеты проверены через публичные imports, 14 отрицательных
type controls и 182 browser records. Mic/mic-circle представлены в независимых
Outline/Filled при 16/24/48 px; native кнопки выбирают экспорт, ширины 0.9/0.8
меняют корпус, reset возвращает исходную модель. DOM, доступные labels и hit targets,
точные отказы и оба motion modes проверены. Собственное движение микрофона пока
не объявлено: его запрос получает отказ.

## Измерение и сохранность ограничений

| Объект | Прежний `201ea24`, raw/gzip B | Текущий `61111d1`, raw/gzip B |
|---|---:|---:|
| variation runtime | 10780 / 4419 | 8872 / 3859 |
| varied ellipsis horizontal consumer | 27354 / 7500 | 25811 / 6985 |
| varied ellipsis vertical consumer | 27101 / 7442 | 25558 / 6933 |
| compiler | 124191 / 37906 | 124013 / 37790 |
| one-static consumer | 637 / 394 | 637 / 394 |

Сравниваются закреплённые compiler/compressor versions и реальные emitted bytes.
Latency speedup не установлен: прежний runner имел 5950X и 12 доступных CPU.
Контурные source spans вычисляются при сборке; runtime compiler больше не удерживает
новый parser. Dots используют проверенную layered composition без ненужных mask ветвей.

Measurement покрывает 1433 release artifacts и 18 consumer scenarios, violations=[].
[Приёмка policies](package-policy-admission-61111d1-20261102.json) сохраняет
все 2848 прежних max-поля, module/forbidden/identity ограничения и consumer entries.
27 новых файлов получили первые raw/gzip caps ровно по измерению, без запаса.
Независимая сверка повторно прочла authenticated CI packets и их hashes.

Оба итоговых PNG побайтно совпали с прежним запуском. Они сняты после reset и
показывают default; независимую оптическую приёмку нового Filled circle при
изменённой ширине они не заменяют. Её дополнительные снимки готовит consumer.

Полные measurement/receipt восстанавливаются из BEGIN/CHUNK/END log packets;
их SHA256 закреплены в приёмке policies. Обязательный CI последующих commits,
review, mixed-version rollback, полная оптика corpus и публикация npm остаются открытыми.
