# Размер compiler после закрытия XML-атрибутов

PR head `d4fe3f32c79e8097d146960af60e36dbb1e43025` проверялся удалённым CI
[41568603998](https://github.com/Labpics-Team/lab-icons/actions/runs/41568603998).
Checkout использовал GitHub merge commit `5fd5d1d876340ad30c3cf64b54a883f9560dd096`.
GitHub Git API подтвердил одинаковое полное дерево обоих commits:
`7c2f471c63fbb2bd2c36c52d7ab632373324a9dd`. Это перенос измерения размера
неизменных исходников; commit identities остаются разными.
`check-package-size.js` после полного `pnpm build` измерил `dist/ir/compiler.js`:
124044 B raw и 37801 B gzip. Эти значения совпали в
[Ubuntu / Node 24](https://github.com/Labpics-Team/lab-icons/actions/runs/41568603998/job/125695987567)
и [Windows / Node 24](https://github.com/Labpics-Team/lab-icons/actions/runs/41568603998/job/125695987538).
Измеритель — закреплённый `fflate` из `package.json`, `gzipSync`, level=9,
mtime=0; точная версия сохранена в `release/package-size-ratchet.json#measurement`.

Изменились только два фактических baseline поля этого файла: 124013 → 124044 B
и 37790 → 37801 B gzip. Потолки 154789 / 42120 B, module allowlist,
запрещённые markers и остальные записи сохраняются. Общий parser XML-атрибутов
принадлежит `src/core/icon-geometry.js`; author oracle использует ту же границу
до нормализации SVG. Статический импорт не получает новый runtime.

Проверка этих запусков завершилась отказом из-за прежних фактических размеров;
других size violations она не сообщила. Этот результат подтверждает размер
собранного compiler, но не весь CI, consumer, визуальную приёмку, скорость,
merge или публикацию npm. Новый exact-head прогон остаётся обязательным.

Следующий [run 41570678044](https://github.com/Labpics-Team/lab-icons/actions/runs/41570678044)
подтвердил package size gate и измерил три прежних opt-in IR consumer.
GitHub merge `21835aee61f5660364f79d3489b2438b37e27668` и PR head
`e48dc39653ca49a71b99ddb56e5db76bebf68fe1` имеют одинаковое полное дерево
`5cf11c068775049d5687d527e098e0d0a8706684` по GitHub Git API.
[Ubuntu / Node 24](https://github.com/Labpics-Team/lab-icons/actions/runs/41570678044/job/125702574686)
и [Windows / Node 24](https://github.com/Labpics-Team/lab-icons/actions/runs/41570678044/job/125702574863)
дали одинаковые размеры. `check-consumer-size.js` использует закреплённые
esbuild и fflate, параметры сохранены в `consumer-size-ratchet.json#measurement`.

| Consumer | Прежний raw/gzip B | Измеренный raw/gzip B | Неизменный потолок raw/gzip B |
| --- | ---: | ---: | ---: |
| recorded-model-axis | 841271 / 210799 | 841281 / 210797 | 853339 / 214703 |
| recorded-motion | 863407 / 216697 | 863417 / 216690 | 865952 / 217706 |
| full-ir-opt-in | 841235 / 210784 | 841245 / 210782 | 921319 / 231011 |

Обновлены только шесть фактических baseline полей этих сценариев.
Их entry expressions, все потолки и остальные сценарии сохранены.
Эти размеры относятся к явному полному IR, а не к импорту одного авторского
символа. Отказ из-за прежних factual baselines не является общей приёмкой CI.
