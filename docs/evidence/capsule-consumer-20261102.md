# Установленный consumer и измерение среза

**Diátaxis:** reference. Проверка 2026-11-02 относится к Icons
`504fb6ab91aa989975b29fd7412bd06df627398f` и Lab UI
`c6d19e296720a731db117c9d3d52dec73876c79d`.
[Self-hosted run](https://github.com/Labpics-Team/labui/actions/runs/41486440065)
и job `125417915950` завершились успешно. Workload исполнялся на Linux/X64,
Node `22.19.0`, Chromium `140.0.7339.186`, AMD Ryzen 9 5950X.

Receipt подтверждает публичные импорты из отдельных установленных пакетов,
действия настоящих Lab UI кнопок, trusted/composed активацию, совместное
изменение параметров, отказ, reset, экспорт и непрерывность во время движения
в обычном режиме и reduced motion. Проверена целостность исходников harness
на точных Git blobs. Это source-pack consumer, а публикация npm проверяется
отдельно. Новый negative Filled корпус в этот источник ещё не входит.

## Полученные байты

Числа относятся к измерению `2026-11-02T17:24:28.547Z` после сборки этого SHA;
gzip выполнялся закреплённым package oracle. Сравнительное ускорение и
полная BENCH-01 этим измерением не устанавливаются.

| Объект | Raw bytes | Gzip bytes |
|---|---:|---:|
| `dist/ir/capsule-runtime.js` | 10227 | 4460 |
| `dist/ir/content-runtime.js` | 8389 | 3559 |
| `dist/ir/glyph-types.d.ts` | 8750 | 2238 |
| `one-static` consumer | 637 | 394 |
| `status-circle-state` consumer | 9196 | 3821 |
| Весь установленный fixture, JavaScript | 472719 | 118060 |

Measurement совпал с полным release-file census. Его `candidatePolicies`
сохранили все действующие `maxBytes` и `maxGzipBytes`; новые строки и обновлённые
baseline являются измеренной проекцией. Policies этим receipt не изменены.
Для следующего source SHA требуется новый результат.

## Identity и повторное чтение

Полный log содержит стандартные gzip/base64 блоки
`LABUI_ICONS_PLATFORM_MEASUREMENT`, `LABUI_ICONS_CONSUMER_VISUAL` и
`LABUI_ICONS_CONSUMER_RECEIPT`. Последовательность chunks, BEGIN/END, размер
compressed/decoded bytes и SHA-256 проверены независимо от исходного decoder.
PNG дополнительно прошли CRC. Скачанные archive bytes заново не хешировались;
проверена цепочка source/receipt/install lockIntegrity.

| Артефакт | SHA-256 |
|---|---|
| Measurement JSON | `006b22edfd654ebdb573da3f204a2e513d790ae7ed73edbe3bb4c97c5efc7715` |
| Receipt JSON | `f89d61aeaabf10c02e83a3afe05efae7680445df309ffd0059be1ce137d7c64c` |
| PNG обычного режима | `0df17a4d8cda8e2e1b92b54dc50b8aa0a45fb9f7e7752413e87ae46899864394` |
| PNG reduced motion | `bac508cfc60773d241229d58a81f2c7f2b8bf55027147240f645d2e606f5bf33` |

Полный CI Icons и review готовности остаются открытыми. Эта проверка также
не закрывает full-corpus оптику, prospective authoring или registry release.
