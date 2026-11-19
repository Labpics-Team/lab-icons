# Авторская вариативность

Геометрический закон подключается через `variations/<имя>`. Поддержка относится
к конкретному начертанию и объявленным параметрам. Эти законы сохраняют авторские
masters; они не объявляют глобальные оси веса, optical sizing или StyleProfile.

## Точки: размер и расстояние

`variations/ellipsis-horizontal` и `variations/ellipsis-vertical` сохраняют независимые
Outline/Filled masters Figma `2416636003859748575`. Два множителя меняют настоящие
кубические контуры каждой точки:

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/variations/ellipsis-horizontal';
import { renderGlyphSvg } from '@labpics/icons/ir/render';

const symbol = glyph({
  variant: 'filled',
  variation: { dotScale: 1.1, spacingScale: 0.9 },
});
const svg = renderGlyphSvg(symbol, { instanceId: 'loading' });
const domain = glyphCapabilities('filled').variation.domain;
```

`dotScale` меняет размер каждой точки относительно её собственного авторского
центра. `spacingScale` меняет продольное расстояние между центрами, сохраняя среднюю
точку. Оба default равны 1. Запрос без variation, пустая variation и пара 1/1
возвращают тот же неизменяемый авторский объект; исходные `d` не пересериализуются.
В `source-only` любое отличное от default значение отвергается.

Build compiler получает смысл частей из `semantics/author-anatomy.json`, сверяет
raw master и path receipts и компилирует только три самостоятельных положительных
контура `MCCCCZ`. Он сохраняет все исходные operands, включая разные экстремумы
Filled dots. Runtime получает готовые точки, pivots и коэффициенты; он не разбирает
`d` и не ищет предполагаемые части. Потребитель задаёт только размер и расстояние.

Обычный `symbols/<id>` возвращает точный source glyph и source capabilities.
Он не загружает variation domain или геометрический runtime; запрос `variation`
возвращает `AUTHOR_VARIATION_UNSUPPORTED`. Вариативность выбирается явным
синхронным импортом `variations/<id>`. Default в обоих путях — один frozen
source объект, с теми же author/anatomy receipts. Общие данные компилируются
в закрытый модуль одного символа; потребитель использует только публичные пути.

Возможности проверяются для запрошенного начертания через
`glyphCapabilities('outline' | 'filled')`. Наличие family entrypoint само по
себе не является обещанием поддержки всех начертаний или осей. Текущие dots
имеют доказанные независимые формы обоих начертаний; это условие их закона,
не универсальное правило для будущих семейств.

Область `domain` — пересечение линейных неравенств по двум положительным
множителям. Каждое имеет вид
`dotScaleCoefficient*dotScale + spacingScaleCoefficient*spacingScale >= minimum`:
коэффициенты названы `dotScale` и `spacingScale` в `constraints`. Minimum gap и
поля берутся из `semantics/grid.json`; receipt содержит версию и SHA-256 этой
policy. Control hull даёт достаточную границу для cubic curve. Это геометрическая
охранная область; авторская визуальная приёмка всего её диапазона не заявлена.
Runtime дополнительно проверяет материализованные Number controls, чтобы
округление или схлопывание слишком малой формы не стало успешным результатом.

Nondefault имеет `provenance.kind = 'authored-variation'`: исходный master,
анатомия, версия закона, digest скомпилированной геометрии и эффективные значения
сохранены. Это вариация авторских частей; конструктивные модели, StyleProfile и
optical sizing остаются отдельными возможностями.

| Запрос | Машинный отказ |
|---|---|
| Неположительный, бесконечный или неизвестный параметр | `INVALID_VARIATION` |
| Gap либо canvas margin нарушен | `VARIATION_OUTSIDE_DOMAIN` |
| Number-представление схлопнуло точку | `VARIATION_UNREPRESENTABLE` |
| Скомпилированные части и master не соответствуют друг другу | `VARIATION_SOURCE_MISMATCH` |
| Необъявленное семейство, включая ellipse/chatbubble | `AUTHOR_VARIATION_UNSUPPORTED` |
| Nondefault в `source-only` или запрос model axes | `AUTHOR_PARITY_REQUIRED` |
| Передача variation существующему Lottie target | `VARIATION_UNSUPPORTED` |

Horizontal сохраняет stable part IDs и существующие opacity-жесты activity/idle;
изменение формы не меняет эти цели движения. Vertical имеет только семантические
части геометрии, без loading-жеста. Outline/Filled не объявлены совместимыми
морфинг-мастерами. Прерывания и исполнение принадлежат потребителю движения.
SVG и GlyphIR содержат изменённую геометрию. Lottie/SF Symbols target для неё
не допущен; Lottie явно отказывает, сохраняя существующий export точного default.

Контракт проверяют `test/authored-variation.test.js` и installed positive/negative
controls в `scripts/check-package-artifact.js`. Они не удостоверяют визуальное
качество 16/24/48 или browser-производительность. Математическое основание и
исключённые circle replacements: [исследование](research/authored-cubic-family-20261102.md).

## Обрамление: внутренний просвет

`variations/plus-circle` и `variations/minus-circle` поддерживают
`enclosureEmphasis` в Outline. Множитель меняет толщину кольца через внутреннюю
контрформу. Наружный контур, содержимое, порядок и IDs частей сохраняются.

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/variations/plus-circle';
import { renderGlyphSvg } from '@labpics/icons/ir/render';

const symbol = glyph({ variant: 'outline', variation: { enclosureEmphasis: 1.2 } });
const svg = renderGlyphSvg(symbol, { instanceId: 'increase' });
const capability = glyphCapabilities('outline').variation;
console.log(capability.law, capability.domain);
```

Значение 1 и пустой запрос variation возвращают тот же frozen master, что
`symbols/plus-circle`; default не пересериализуется. Filled остаётся независимой
авторской формой: `glyphCapabilities('filled')` не содержит variation, а запрос
этого параметра получает `AUTHOR_VARIATION_UNSUPPORTED`. `source-only` принимает
только точный default. Неизвестные, неположительные и нечисловые параметры
получают `INVALID_VARIATION`.

Компилятор проверяет winding, замкнутость, общий центр, вложенность контуров и
расстояние до содержимого. Он выдаёт компактные controls и доказанную область
`radial-bernstein`; runtime проверяет фактически вычисленный binary64 scale.
Выход за область получает `VARIATION_OUTSIDE_DOMAIN`, схлопывание Number-геометрии
— `VARIATION_UNREPRESENTABLE`. Повторный разбор path и построение сертификата
при запросе не нужны.

Эта область гарантирует геометрические ограничения. Визуальная приёмка всего
диапазона, особенно почти исчезающей стенки у нижней границы, остаётся открытой.
Исходная авторская форма сохраняется точно; произвольное допустимое значение
не обещает улучшенную оптику. [Геометрическое основание](research/author-annulus-20261102.md)
содержит источник, контрпримеры и пределы доказательства.

Закон сохраняет существующие opacity-жесты объявленных частей. Например,
`checkmark-circle.presence` меняет видимость той же отметки при выбранной толщине
обрамления; оболочка остаётся неподвижной. `targets.webEffect` сообщает
`existing-part-gestures`, а доступные жесты перечислены в `motion.gestures`.
У символа без объявленного жеста запрос получает `SEMANTIC_MOTION_UNAVAILABLE`.
Повороты и переносы изменённой геометрии остаются неподдержанными.

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/variations/checkmark-circle';
import { compileSymbolEffect } from '@labpics/icons/motion';

const symbol = glyph({ variation: { enclosureEmphasis: 1.2 } });
const result = compileSymbolEffect(symbol, glyphCapabilities(), 'checkmark-circle.presence', {
  duration: 240, from: 0, to: 1,
});
if (!result.ok) throw new Error(result.reason.code);
```

Observatory показывает текущий SVG, наложение и разницу. Обычный
`states/status-circle` сохраняет авторский default. Общую оболочку группы
можно изменять отдельно, сохраняя уже смонтированные состояния.

## Общее обрамление при смене состояния

`state-variations/status-circle` и `state-variations/playback-circle` добавляют
`renderEnclosurePatch` и `enclosureVariationCapabilities`. Они переэкспортируют
те же state-функции, что соответствующий `states/<имя>`, без копии данных
состояний. Обычный state-импорт не загружает материализатор обрамления.

```ts
import {
  renderStateSvg, renderEnclosurePatch, compileStateEffect,
} from '@labpics/icons/state-variations/status-circle';

const initial = renderStateSvg('confirmation');
const presentation = renderEnclosurePatch({
  variation: { enclosureEmphasis: 1.2 },
});
const transition = compileStateEffect('dismissal', { duration: 240 });
```

`initial.svg` служит для первого mount. После успешного `presentation` готовый
`patch` адресует общую часть через `partId` и содержит SVG-атрибут `d`.
Потребитель проверяет `contract`, `version`, `group` и `variant`, находит эту
объявленную часть и применяет атрибут. Он сохраняет остальные nodes, их opacity
и активный переход; повторный mount всего `initial.svg` сбросил бы видимую смесь.
Геометрия меняется один раз по событию. Исполнитель движения связывает стандартные
opacity-стадии `transition.effect` с текущей видимой позой, включая прерывание.

Default patch возвращает точную строку авторского обрамления и тот же frozen
объект. Для nondefault компилятор пересекает геометрические допуски **всех**
участников. Поэтому запрос, допустимый для отдельного checkmark-circle, может
получить `VARIATION_OUTSIDE_DOMAIN` в status-circle. Нечисловые и неизвестные
параметры получают `INVALID_REQUEST`, Filled — `VARIANT_UNSUPPORTED`, схлопнувшаяся
геометрия — `POSE_UNREPRESENTABLE`. При отказе patch отсутствует; текущий рисунок
остаётся пригоден для следующего запроса.

Оболочка остаётся неподвижной в каждом opacity-переходе. `reducedMotion` передаётся
существующему `compileStateEffect`. Изменённый SVG экспортируется из текущей
презентации; обычные `render` и `renderStateSvg` сохраняют exact source-результат.
Новые morph, Lottie и SF Symbols adapters этим срезом не заявляются.
[Основание и ограничения](research/state-annulus-20261102.md).

## Поворот многоточия

`states/ellipsis-orientation-outline` и `states/ellipsis-orientation-filled`
соединяют горизонтальное и вертикальное многоточия внутри одного начертания.
Каждая исходная команда и её численные параметры имеют явное соответствие;
переход меняет `d` крайних точек. Средняя точка сохраняется буквально.

```ts
import { compileStateEffect, renderStateSvg } from '@labpics/icons/states/ellipsis-orientation-filled';
import { prepareContourStateEffect } from '@labpics/icons/motion';
import { value } from '@labpics/motion';

// SVG содержит data-part для адресации существующих paths.
const initial = renderStateSvg('horizontal');
if (!initial.ok) throw new Error(initial.reason.code);
container.innerHTML = initial.svg;

const result = compileStateEffect('vertical', { duration: 300, from: 0 });
if (!result.ok) throw new Error(result.reason.code);
const prepared = prepareContourStateEffect(result.effect);
if (!prepared.ok) throw new Error(prepared.reason.code);
const paths = new Map([...container.querySelectorAll<SVGPathElement>('path[data-part]')]
  .map(path => [path.dataset.part!, path]));
const progress = value(result.effect.from);
const unsubscribe = progress.subscribe(p => {
  const pose = prepared.sample(p);
  if (!pose.ok) throw new Error(pose.reason.code);
  for (const part of pose.parts) paths.get(part.partId)!.setAttribute('d', part.d);
});
progress.animate(result.effect.to, {
  duration: result.effect.options.duration,
  ease: 'linear',
});
// При удалении компонента: unsubscribe(); progress.dispose();
```

`from` и аргумент `sample()` — положение в общем семействе: 0 соответствует
горизонтальному состоянию, 1 вертикальному. Для разворота исполнитель читает
`progress.get()`, составляет новый эффект с этим `from` и анимирует ту же шкалу
к новому `to`. Готовый sampler остаётся тем же для всего интервала. Прерывание,
часы и освобождение подписки принадлежат публичному Motion API.

`prepareContourStateEffect()` один раз копирует и проверяет переносимый пакет:
фиксированные `MCCCCZ`, конечные пары чисел, замкнутость и численное совпадение
точных строк концов с векторами. JSON-перенос и отдельная установленная копия
пакета поддержаны. Проверка представления не удостоверяет авторство внешних
данных; авторские receipts и геометрическое доказательство проверяет build compiler.
Он требует буквальные абсолютные `MCCCCZ`, совпадение строки с raw master и
длину до 4096 символов. Начальное relative `m`, неявные повторения `C` и более
длинные строки возвращают `CORRESPONDENCE_UNAVAILABLE` при сборке.
В кадре sampler только интерполирует числа и записывает строку. При 0/1 он
возвращает исходные `d` без форматирования.

Для перехода принят exact default: variation отсутствует, пуста либо содержит
множители 1. Отличные от 1 положительные множители возвращают
`VARIATION_UNSUPPORTED`; ошибочные параметры — `INVALID_REQUEST`.
Безопасность отдельных конечных форм не доказывает зазор при их сближении.
`stateCapabilities().proof` содержит точные рациональные границы для всех пар
точек и бюджета округления. Lottie, dotLottie и SF Symbols transition возвращают
`FORMAT_UNSUPPORTED`. Горизонтальные activity/idle и отсутствие loading у
вертикального меню сохраняются.

Тест `test/authored-contour-states.test.js` проверяет исходные строки, перенос,
обратный ход, отказы и опасную промежуточную форму. Приёмка браузерного
исполнения, размеров 16/24/48 и оптического качества проводится отдельно.

## Содержание внутри круглого обрамления

`content-variations/<icon>` совместно изменяет всё содержание и внутренний
контур кольца. Входы доступны для `plus-circle`, `minus-circle`,
`checkmark-circle`, `close-circle`, `question-circle`, `alert-circle`,
`play-circle` и `pause-circle` в Outline.

```ts
import { glyph, glyphCapabilities } from '@labpics/icons/content-variations/question-circle';

const exact = glyph();
const presentation = glyph({
  variation: { contentScale: 0.9, enclosureEmphasis: 1.1 },
});
const domain = glyphCapabilities().variation.domain;
```

`contentScale` масштабирует все content-части вокруг проверенного центра
обрамления: точку и стержень вопроса, обе полосы паузы и весь знак остальных
участников. Их взаимное расположение, команды, замыкание и направление обхода
сохраняются. Внешний контур кольца остаётся авторским. `enclosureEmphasis`
изменяет только внутренний контур кольца по прежнему annulus закону.
`presentation` содержит готовые `d`, `svg` и якоря частей; пересчитывайте его
один раз по событию изменения профиля. `checkmark-circle.presence` использует
существующий opacity-протокол Motion API: внутренний знак появляется или исчезает,
а обрамление остаётся неподвижным. Обратный ход, промежуточное состояние и reduced
motion меняют данные эффекта без замены геометрии. Rotation/translation для этого
закона получают `SEMANTIC_MOTION_UNAVAILABLE`; масштабирование якорей само по себе
не удостоверяет безопасную траекторию такого движения.

Оба множителя по умолчанию равны 1. Запрос без variation и явный `1/1`
возвращают тот же точный source-объект. Обычный Filled доступен без variation;
любая его variation, включая `1/1`, возвращает `AUTHOR_VARIATION_UNSUPPORTED`.
`source-only` с отличным от default запросом возвращает `AUTHOR_PARITY_REQUIRED`.

Допуск совместный: два параметра могут пройти отдельно и не пройти вместе.
Например, `plus-circle` принимает `contentScale: 1.3` и
`enclosureEmphasis: 2.2` отдельно. Их сочетание возвращает
`VARIATION_OUTSIDE_DOMAIN`. `domain.clearance` проверяет фактический binary64
масштаб внутреннего контура относительно масштаба содержания. Build compiler
выводит достаточную радиальную границу кривой кольца из Bernstein coefficients,
границу всего содержания из control hull и бюджет округления обеих деформаций
и самого сравнения, включая gradual underflow. Каждый master имеет свой допуск.
Слишком малый множитель, схлопнувшийся контур или потеря различимости controls
возвращают `VARIATION_UNREPRESENTABLE`. Нечисловые, неположительные и неизвестные
параметры возвращают `INVALID_VARIATION`. Значения автоматически не подгоняются.

Масштаб содержания меняет его размер, толщину и внутренние промежутки вместе.
Это полезная деформация конкретной анатомии, с отдельной оптической приёмкой
соседних кнопок. Полные `opsz` и независимая ось веса требуют своей калибровки:
[OpenType 1.9.1](https://learn.microsoft.com/en-us/typography/opentype/spec/dvaraxistag_opsz)
описывает изменение дизайна для размера, а
[IBM](https://www.ibm.com/design/language/iconography/ui-icons/usage/)
отдельно требует оптического выравнивания и соответствия размера контексту.
Одинаковый bbox не определяет такой профиль.

Отдельный import сохраняет прежние `symbols/<icon>` и `variations/<icon>`:
их runtime, данные, capabilities и лимиты остаются прежними. Новый вход
поставляет подготовленную программу допустимых path-команд и controls;
runtime не разбирает произвольный SVG и не ищет семантические части.
Build связывает программу с объявленной анатомией и master receipts,
а загрузка проверяет source и целостность packet. Affine преобразование всех
точек и controls соответствует
[SVG 2](https://www.w3.org/TR/SVG2/coords.html) и
[FontTools TransformPen](https://fonttools.readthedocs.io/en/latest/pens/transformPen.html).

`test/authored-content-geometry.test.js` сверяет raw H/V/C/L operands и
материализованный binary64 зазор независимым Fraction oracle.
`test/content-optin-projection.test.js` исполняет все восемь публичных входов
и сравнивает прежние emitted bytes. `test/content-optin-types.test.js`
проверяет positive и negative consumer в Bundler и NodeNext.
