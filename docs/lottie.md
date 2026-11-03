# Экспортировать авторский символ в Lottie

**Diátaxis:** how-to.

Субпуть `@labpics/icons/lottie/<name>` содержит заранее скомпилированные контуры
выбранного символа. Статические SVG-импорты остаются самостоятельными.
Экспорт использует semantic effects Lab Icons; player выбирает потребитель.

```ts
import { exportLottie, lottieCapabilities } from '@labpics/icons/lottie/reload';

const result = exportLottie({
  variant: 'outline',
  gesture: 'reload.cycle',
  duration: 1000,
  color: '#123456',
  frameRate: 60,
});
if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
const animationData = result.animation;
```

Для неподвижного мастера передайте только `variant` и `color`. Поддержанные
жесты выбранного варианта возвращает `lottieCapabilities(variant).gestures`.
`from` и `to` задают сегмент нормализованного прогресса; обратный сегмент
экспортируется тем же способом. `reducedMotion: true` материализует конечную
неподвижную позу. Параметры движения требуют явного `gesture`.
Значения по умолчанию действуют только для пропущенного поля или `undefined`;
явный `null` получает `INVALID_REQUEST`.

`<name>.nudge` у `chevron-{back,forward,up,down}` и
`arrow-{back,forward,up,down}` переносит исходную цельную часть в объявленном
физическом направлении и возвращает её обратно. Пик на середине прогресса
равен 1/8 соответствующего размера исходного viewBox. Lottie получает
position keyframes в этих же единицах; авторские контуры остаются прежними.
Варианты с кругом требуют отдельной анатомии и этот жест не объявляют.

`notifications.ring` и `notifications-unread.ring` доступны в Outline и
Filled для входящего уведомления. Position keyframes двигают только
`notification-clapper` по шкале `0 → +A → −A → +A/2 → −A/2 → 0`
с равными пятыми прогресса; `A` — четверть ширины язычка в исходном viewBox.
Корпус и badge остаются статическими layers; контуры и порядок сохранены.
Обратный и частичный interval используют эту же шкалу, reduced motion
сохраняет конечную позу. У `notifications-off` этот жест не объявлен.
Для ring проверены source JSON и effect; player-приёмка остаётся открытой
в [evidence среза](evidence/author-motion-20261101.md#входящее-уведомление).

Target profile — `lottie-web-svg-5.13`: квалификация относится к SVG renderer
`lottie-web` 5.13.0. Canvas, native players и dotLottie ещё требуют собственных
проверок. `color` — RGB `#rrggbb`; Lottie JSON не наследует CSS `currentColor`.

При `layers` JSON содержит отдельную layer для каждой исходной части и общий
fill scope для её контуров. Объявленный авторский `compound` с `evenodd`
экспортируется статически одной layer и одной общей заливкой: отрицательные
контуры сохраняют отверстия. Имена shapes сохраняют semantic part IDs и
исходный порядок; build сохраняет cubic geometry, winding, anchors и авторский
receipt. Например, Filled `mic-circle` сохраняет отрицательные корпус и опору.
Независимое движение этих контуров получает отказ существующего motion owner;
`lottieCapabilities('filled').gestures` у этого символа остаётся пустым.
Невырожденные SVG arcs, открытые fill contours, неподдержанная композиция,
маски и stroke получают точный отказ. Оси текущего author master не добавляются.

Длительность задаётся как `N * 1000 / frameRate`, где `N` — целое число кадров.
Строгая обратная проверка принимает это представление в JavaScript Number;
произвольная длительность не округляется. Конечная поза стоит на
`terminalFrame`; `op` включает дополнительный терминальный кадр. Например,
при 1000 ms и 60 fps pose достигается на кадре 60, а длительность player
составляет 61/60 секунды. Параметры и эта конвенция записаны в
`animation.meta.labIcons`. Экспорт с невыразимой длительностью отвергается.

Вращение получает консервативный canvas по convex hull control points.
Перенос учитывает внутренние вершины шкалы, даже когда начальная и конечная
позы совпадают; reduced motion оставляет только конечную позу.
`logicalViewBox` сохраняет размер исходного символа, `offset` — размещение
этого размера внутри target canvas. При вёрстке по исходным 24 единицам
масштабируйте внешние `w/h` тем же коэффициентом, чтобы padding не уменьшал glyph.

Каждый export возвращает свежий изменяемый JSON: `lottie-web` нормализует
tangents in-place. Повторный export сохраняет исходный template. После
использования освобождайте player его штатным `destroy()`.

Состояние source и открытые delivery gates закреплены в
[проверке target](evidence/lottie-20261101.md). Установка опубликованной версии
с этим субпутём будет подтверждена отдельным release readback.
