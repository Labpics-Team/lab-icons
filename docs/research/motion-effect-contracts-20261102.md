# Общие данные эффектов

У rotation, opacity sequence и translation одинаковые поля идентичности,
интервала, неподвижных частей, viewport и параметров исполнения. Теперь ими
владеет один приватный `EffectEnvelope`. Публичные интерфейсы и их различимые
версии остаются прежними; новые exports не добавлены. Повторяющиеся комментарии
сокращены в motion, DesignSpec и Lottie без изменения полей или поведения.

Узкий native TypeScript 7.0.2 consumer сравнил каждое публичное поле, включая
readonly и optional, с `8681b975648351a9a93d717ada5769851b46f617` в Bundler
и NodeNext. Расширение отдельного интерфейса не протекает в соседние эффекты.
Нормализованный JavaScript motion совпал с baseline: esbuild 0.28.1,
minifySyntax/minifyWhitespace, без переименования идентификаторов.

| Декларация | Raw до → после | gzip до → после |
|---|---:|---:|
| motion/index.d.ts | 5096 → 4077 | 1559 → 1380 |
| authoring/design-spec.d.ts | 7822 → 7567 | 2303 → 2132 |
| lottie/types.d.ts | 2142 → 2091 | 935 → 912 |

[Наблюдения и хеши](motion-effect-contracts-20261102.json). Windows x64,
Node 24.15.0; gzip fflate 0.8.3, level 9, mtime 0. Это отдельный strict
declaration emit, не полная пакетная сборка. Два существующих type-consumer
теста authored variation/annulus также прошли; runtime и авторские SVG
этой правкой не меняются. Packed install, browser, timing/memory и remote
CI в данном срезе не запускались.

Основания совместимости: [TypeScript interface inheritance](https://www.typescriptlang.org/docs/handbook/2/objects.html#extending-types)
и [declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html).
Пакетные потолки сохранены; оставшиеся runtime превышения требуют отдельного
исправления и проверки exact packed artifact.
