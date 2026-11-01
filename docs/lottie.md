# Экспортировать авторский символ в Lottie

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

Target profile — `lottie-web-svg-5.13`: квалификация относится к SVG renderer
`lottie-web` 5.13.0. Canvas, native players и dotLottie ещё требуют собственных
проверок. `color` — RGB `#rrggbb`; Lottie JSON не наследует CSS `currentColor`.

JSON содержит отдельную layer для каждой исходной части и общий fill scope
для её контуров. Build сохраняет cubic geometry, winding и порядок частей.
Невырожденные SVG arcs, открытые fill contours, compound/mask composition и
stroke получают точный отказ. Оси текущего author master не добавляются.

Длительность задаётся как `N * 1000 / frameRate`, где `N` — целое число кадров.
Строгая обратная проверка принимает это представление в JavaScript Number;
произвольная длительность не округляется. Конечная поза стоит на
`terminalFrame`; `op` включает дополнительный терминальный кадр. Например,
при 1000 ms и 60 fps pose достигается на кадре 60, а длительность player
составляет 61/60 секунды. Параметры и эта конвенция записаны в
`animation.meta.labIcons`. Экспорт с невыразимой длительностью отвергается.

Вращение получает консервативный canvas по convex hull control points.
`logicalViewBox` сохраняет размер исходного символа, `offset` — размещение
этого размера внутри target canvas. При вёрстке по исходным 24 единицам
масштабируйте внешние `w/h` тем же коэффициентом, чтобы padding не уменьшал glyph.

Каждый export возвращает свежий изменяемый JSON: `lottie-web` нормализует
tangents in-place. Повторный export сохраняет исходный template. После
использования освобождайте player его штатным `destroy()`.

Состояние source и открытые delivery gates закреплены в
[проверке target](evidence/lottie-20261101.md). Установка опубликованной версии
с этим субпутём будет подтверждена отдельным release readback.
