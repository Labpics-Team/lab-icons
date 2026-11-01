# Размеры авторского пакета

**Diátaxis:** explanation. Срез 2026-11-01.

Установленный Lab UI consumer `655a75173b8244ca429693e66dd9361a067da066`
проверил packed Icons `dc04d50903c658c29782f900da33a83c9a3fcb93` на
[self-hosted runner](https://github.com/Labpics-Team/labui/actions/runs/41339731144/job/124946991060).
Отчёт создан `2026-11-01T19:16:56.628Z`; SHA-256 исходных JSON bytes:
`955753c387455248b5575c95608530cece0dfd32460baaf16a46cdeb2ce9bf80`.
Он содержит 1354 файла контракта и 10 consumers. Source между этим producer
и `7596be310086504bb0967d64b08a77c241f9bc98` изменил четыре документа;
build inputs и lockfile сохранились.

| Consumer этого packed пакета | Raw, B | Gzip, B | Brotli, B |
|---|---:|---:|---:|
| Legacy static import | 637 | 394 | 353 |
| Авторская static `symbols/time` | 1155 | 583 | 512 |
| Авторский `symbols/alert.glyph()` | 12433 | 3265 | 2730 |
| Полный IR, явный `ir.glyph({ icon: 'alert' })` | 853303 | 214691 | 160989 |

Условия: esbuild 0.28.1, bundle/minify/tree-shake, es2022/browser;
gzip — fflate 0.8.3, level 9, mtime 0. Brotli — Node 22.19.0 на Linux x64,
quality 11. Запуск consumer подтвердил отсутствие нарушений byte policy.
Таблица сравнивает маршруты одного пакета; comparative cold/render/frame/memory
приёмка BENCH-01 остаётся открытой.

Прежняя package policy охватывала 9 файлов при контракте из 1354.
Проверка exact file set обнаруживает этот дефект до измерения файлов.
Runner projection теперь закрепляет все 1354 baseline; потолки, module lists,
запреты и equality прежних девяти файлов сохранены. Для новых outputs потолок
равен измеренному raw/gzip размеру.

Consumer budget принадлежит точному import entry. Прежний `glyph-one`
импортировал полный IR; его потолки 921319 raw / 231011 gzip сохраняются
у `full-ir-opt-in`. Новый `glyph-one` импортирует один авторский symbol и
получает собственные потолки 12433 / 3265. `--update` отказывает росту,
выходящему за них, и потере любого прежнего entry даже при сохранении имени
сценария. До исправления четыре regression controls были RED; после изменения
владельца все 13 admission controls прошли. Это проверка политики с fixture
bundler/compressor; полный exact-head build и CI выполняются отдельно.

Последующий контрпример показал, что перестановка имён сценариев сохраняет
entry, но могла сбросить его бюджет. Итоговый владелец индексирует ограничения
по exact entry. Для нескольких aliases берутся наиболее строгие raw и gzip
потолки независимо; отдельная ветка миграции IR удалена. Эти случаи проверены
при здоровом соседнем update и при росте размера; четыре новых контрпримера
стали RED до изменения владельца.
