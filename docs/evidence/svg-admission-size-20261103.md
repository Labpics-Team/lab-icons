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
