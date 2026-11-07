# Подтверждение без замены авторской геометрии

Исследование и source-срез от 2026-11-01. Вопрос: как дать настоящее
подтверждение, обратный переход и экспорт, сохранив refined Figma-рисунок?
Выбран явный `confirmation.presence`: отдельная отметка меняет opacity,
оболочка сохраняется. Используются существующие effect v2, Lab Motion
`sequence()` и Lottie compiler; новый планировщик не требуется.

## Авторские источники

Файл **Lab UI v2.1**, key `LuaiBd4anRi4DMZayKAnY2`. Сохранённый master
snapshot: `2416636003859748575`. Более новая наблюдённая версия:
`2416781108246633005`. [Закреплённое сравнение](../evidence/figma-20261101/version-comparison.json)
от `2026-11-01T09:51:27.136Z` проверило полные документы 660 компонентов:
добавлений, удалений и изменений не обнаружено. Поэтому этот срез использует
точные сохранённые masters; экспорт новой версии не выдуман.

| Символ | Outline node | Filled node | Принят presence |
|---|---|---|---|
| `checkmark` | `6431:3850` | `6413:301` | Оба |
| `checkmark-circle` | `6431:4056` | `6413:288` | Outline |
| `cloud-checkmark` | `6431:3889` | `6413:200` | Outline |
| `shield-checkmark` | `6431:3884` | `6413:234` | Outline |

Исходные `d`, fill rule, path order и master fingerprints остаются прежними.
В Outline отметка — path 0, оболочка — path 1. У трёх enclosed Filled
variants одна evenodd-композиция объединяет тело и отрицательную галочку;
она получает отказ при попытке назначить независимый presence.

## Проверенные альтернативы

| Подход | Проверенный предел | Решение |
|---|---|---|
| Stroke dashing | [SVG 2 §13.5.6](https://www.w3.org/TR/SVG2/painting.html#StrokeDashing) описывает dash как управление stroke. Наши marks — залитые outlines; их perimeter не является осевой линией галочки | Не заменять оригинал равномерным stroke |
| Lottie TrimPath | [Lottie 1.0.1, Shapes](https://lottie.github.io/lottie-spec/1.0.1/specs/shapes/#trim-path): modifier изменяет bezier curves и выбирает участок длины пути. Это не восстановление авторских guide points и variable-width draw | Для presence не применять modifier |
| Clipping sweep | [CSS Masking §6](https://www.w3.org/TR/css-masking-1/#clipping) позволяет сохранить геометрию под clip. Для авторского check нужен порядок раскрытия вокруг угла; generic wipe его не задаёт. У текущего effect contract нет clip target | Оставить исследованием будущего authored Draw |
| Opacity отдельной отметки | SVG painting и Lottie group opacity поддерживают изменение видимости без изменения contour geometry. Current effect v2 уже передаёт opacity публичному исполнителю | Использовать для состояния подтверждения |

Дополнительное первичное основание для границы Draw:
[WWDC25, SF Symbols 7, 2:19 и 8:02](https://developer.apple.com/videos/play/wwdc2025/337/).
Guide-point pairs, corners, attachments и end caps сохраняют авторскую форму;
одних начальной и конечной точек для сложного draw недостаточно. Presence
имеет собственный смысл и не выдаётся за рисование или morph.

## Контрпримеры обобщению

Отдельный slash у `cloud-off`, `eye-off` и `video-camera-off` ещё не доказывает
on/off correspondence: остальное тело уже прервано диагональю. Убрать slash
недостаточно, чтобы получить on-мастер. `link-horizontal-off` вообще имеет
две chain paths и не содержит отдельного slash. Суффикс `-off` не назначает
анатомию и поведение.

Пустая оболочка в progress `0` принадлежит тому же confirmation-символу.
Равенство с самостоятельными `circle`, `cloud` или `shield` не объявлено.
Это сохраняет возможность независимо править их оптику и композицию.

## Проверки и следующий перенос

[Source-тест](../../test/author-confirmation.test.js) проверяет пять variants:
raw paths/fill/z-order, fixed enclosure, progress, прямые и обратные intervals,
reduced-motion endpoint, Lottie opacity из того же закона и точные отказы.
25 тестов прошли; исходный raw-master oracle не использует production parser.
Этот результат не подтверждает опубликованный npm package или полный корпус.

Граница следующей проверки — exact packed consumer и browser execution:
новое намерение должно подхватывать opacity без скачка, сохраняя enclosure,
terminal state и cleanup. Корпусные raster/benchmark проверки выполняются
штатной self-hosted CI. Их прохождение здесь не утверждается.

Срез закрывает класс угадывания подтверждения по имени или восстановления
частей из готового path: capability принимается явной аннотацией точного
мастера. Один и тот же закон используется несколькими настоящими символами.
Более сильный Draw потребует нового авторского correspondence и target proof;
замена им presence сейчас изменила бы задачу и увеличила риск для рисунка.
