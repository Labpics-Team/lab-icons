# Упаковка Lottie JSON

`packDotLottie` импортируется из `@labpics/icons/lottie`.
`packDotLottie(animation, { id: 'calendar' })` возвращает новый `Uint8Array`
с архивом dotLottie v2. `animation` — готовый результат `exportLottie`;
функция сохраняет его JSON без изменения путей, поз, кадров или длительности.
Без `id` используется `animation`.

Архив содержит `manifest.json` и `a/<id>.json`. Используется Deflate,
порядок файлов и дата ZIP фиксированы. Одинаковый JSON и id дают одинаковые
bytes; изменение возвращённого массива не влияет на последующие вызовы.
Unicode в содержимом JSON сохраняется как UTF-8. Для id спецификация допускает
ASCII-буквы, цифры, точку, подчёркивание, пробел и дефис; неверный id вызывает
`RangeError`. Упаковщик не загружает внешние ресурсы и не проверяет полную схему
Lottie: он принимает уже подготовленную анимацию Icons с внутренними assets.

Файл сохраняется с расширением `.lottie`, MIME type —
`application/zip+dotlottie`. Архив проверяется настоящим dotLottie Web player:
загрузка ZIP и JSON даёт одинаковые кадры на одном WASM renderer.

Основание: [dotLottie v2 specification](https://dotlottie.io/spec/2.0/),
[выбор актуальной версии](https://dotlottie.io/spec/).
