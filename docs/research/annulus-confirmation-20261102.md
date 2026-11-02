# Подтверждение при изменённом обрамлении

`checkmark-circle.presence` теперь использует ту же авторскую отметку при
допустимом `enclosureEmphasis`. `annulus.counter-scale` меняет только контрформу
оболочки; её наружный path и объект content-части сохраняются. Opacity-жест
отметки не требует нового correspondence, геометрического parser или scheduler.

## Основание и границы

[Авторский master и аннотация](confirmation-presence-20261101.md) относятся к
Figma `LuaiBd4anRi4DMZayKAnY2`, snapshot `2416636003859748575`, Outline node
`6431:4056`. [Annulus certificate](author-annulus-20261102.md) проверяет контрформу
и расстояние до неизменённого содержимого. Эти разные законы уже имеют своих
владельцев; данный срез замыкает их применение через существующий motion compiler.

[Apple WWDC25, 6:02 и 8:02](https://developer.apple.com/videos/play/wwdc2025/337/)
объясняет сохранение общей оболочки и выбор участвующих слоёв. [SVG 2 §3.8](https://www.w3.org/TR/SVG2/render.html#ObjectAndGroupOpacityProperties)
определяет opacity уже отрисованной группы. Это основание для независимой
видимости отметки, а не для восстановления Draw по её залитому контуру.

Вариант ничего не менять сохранял точный отказ, но не давал применить уже
объявленный gesture к той же content-части. Новый generic fade создал бы второй
смысл движения и обход author annotation. Расширение текущего admission выбрано
потому, что сохраняет один compiler, реальные part IDs и effect v2.

В source admission должны совпасть версии 1, поддержанный law, geometry hash,
author и anatomy receipts. Capability сообщает существующий профиль
`existing-part-gestures`; без этого обещания эффект не выдаётся. Последующий
opacity-only gate сохраняется для обеих вариаций. Новая аннотация или жест
по имени символа не создаются. Rotation/translation изменённой геометрии,
Lottie variation и morph остаются неподдержанными.

## Проверка

RED на `d1f940035924a096fbd209bcc50e824ea8800f6c`: реальные annulus glyphs с
emphasis `0.9`, `1.1`, `2` возвращали `SEMANTIC_MOTION_UNAVAILABLE`, тогда как
source-контроль принимал тот же confirmation gesture. Raw master oracle
подтвердил неизменённую отметку и изменение только внутреннего контура оболочки.

28 новых controls проверяют явные v2 targets/stages, прямой/обратный и частичный
прогресс, hold, reduced motion, source default, независимый Filled и точные
отказы для подмены law/version/hash/target/author/anatomy/part identity,
потери targets, duplicate IDs и non-opacity каналов. Все варианты дополняются
достижимым healthy compile. Вместе с прежними dots, annulus, confirmation,
rest-progress и native declarations прошли 104 tests в семи файлах; `tsc --noEmit`,
syntax, docs-drift и diff checks прошли.

Использован проверенный pnpm toolchain родительского checkout, Vitest `--root`
указывает на этот изолированный worktree. Установки пакета, полной сборки,
browser, raster stress и timing qualification этим запуском не заявляются.

[Узкий production emit](annulus-confirmation-budget-20261102.json) использует
настоящий `scripts/build-ir.mjs#bundle`, включая external contour runtime.
Baseline motion hash совпал с authenticated self-hosted full-pack receipt.
Без этого external control emit давал другой closure и был отвергнут hash gate.
Source hashes сверены с d1 Git blobs; отчёт фиксирует candidate source hashes.

| Output | Baseline raw/gzip, B | Candidate raw/gzip, B | Прежний предел |
|---|---:|---:|---:|
| `motion/index.js` | 13381/3715 | 13564/3771 | 14620/3817 |
| `variations/checkmark-circle.js` | 2157/932 | 2167/941 | Отдельный предел не задан |
| `variations/plus-circle.js` | 2131/926 | 2141/936 | Отдельный предел не задан |

Обычные symbol modules и private source/data двух семейств совпадают побайтно.
Default static consumers не импортируют motion. Это детерминированные emit bytes,
не сравнение времени исполнения или полный packed consumer admission.

Повторение narrow emit требует исходный authenticated receipt и checkout d1:

```powershell
node scripts/bench/annulus-confirmation-budget.mjs <receipt.json> <report.json> <baseline-checkout>
```

Следующий гейт — exact installed Lab UI: сохранить выбранное обрамление при
подтверждении, interruption, reverse, reduced motion и cleanup. Его выполняет
владелец consumer на self-hosted runner. Независимые source reviews и этот
runtime readback остаются отдельными условиями приёмки.
