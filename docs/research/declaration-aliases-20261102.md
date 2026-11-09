# Отклонённые private aliases в declarations

2026-11-02 выполнен один узкий опыт после отказа от общего callable const и
function wrapper. Baseline:
`ad56d1acc6d8a8bc3103ad280e1b19eaafc4895b`. Function declarations, порядок
overloads и literal symbol IDs сохранялись; сокращались только private имена
импортированных типов. Новый helper, export и runtime не добавлялись.

Фактический Bundler/NodeNext consumer в
`test/authored-variation-types.test.js` прошёл namespace metadata, обычные
вызовы, `Parameters`, `ReturnType`, variation capability и точные четыре
отрицательные диагностики. Import alias сохраняет тот же исходный тип по
[штатному контракту TypeScript](https://www.typescriptlang.org/docs/handbook/modules/reference.html#type-only-imports-and-exports).
Совместимость этого опыта не означала его пригодность по shipping bytes.

| Declaration | Raw/gzip/Brotli до | Raw/gzip/Brotli после |
|---|---:|---:|
| time | 440/215/164 | 388/220/197 |
| ellipse | 446/216/188 | 394/222/201 |
| ellipsis-horizontal | 718/257/206 | 602/262/195 |
| ellipsis-vertical | 712/257/205 | 596/261/195 |

Raw уменьшился, gzip вырос во всех четырёх controls. Многоточия остаются
выше существующих raw/gzip ceilings `470/224` и `466/223` из
`release/package-size-ratchet.json`. Опыт отклонён; прежний emitter
восстановлен. Дополнительный подбор имён или новый type mechanism не запускались.

[Raw результат](declaration-aliases-20261102.json) сохраняет точный текст
четырёх экспериментальных declarations, SHA256 и размеры. Среда: Windows,
Node v24.15.0, TypeScript 7.0.2, fflate 0.8.3 level 9/mtime 0,
Brotli 1.2.0 quality 11. Это независимые generated declarations, не gzip
tarball; полный build/pack/install, browser timing и публикация не проверялись.
