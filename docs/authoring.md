# Создать собственный символ

`@labpics/icons/authoring` компилирует DesignSpec в GlyphIR и готовый SVG.
Спецификация задаёт смысловые части, их построение, именованные якоря и правила
композиции. Компилятор проверяет ссылки, окрашенные границы и объявленные отступы.

В этом примере создадим `focus-beacon`: кольцо фокуса, центральную точку и
отдельный сигнал справа сверху. Это новый авторский знак со статусом `candidate`.
Принятие его рисунка в дизайн-систему требует отдельной визуальной оценки.

## 1. Описать знак

Координаты живут на квадратном холсте `0..1`. Якорь `signal` строится от центра
по углу и расстоянию; части ссылаются на его имя.

```ts
import { compileDesignSpec, renderGlyphSvg, type DesignSpec } from '@labpics/icons/authoring';

const beacon = {
  version: 1,
  anchors: [
    { id: 'center', kind: 'canvas', at: 'center' },
    { id: 'signal', kind: 'polar', from: 'center', angle: -45, distance: 0.32 },
  ],
  parts: [
    {
      id: 'body', role: 'body',
      geometry: { kind: 'circle', center: 'center', radius: 0.21 },
      paint: { kind: 'stroke', width: 0.055 },
    },
    {
      id: 'focus', role: 'content',
      geometry: { kind: 'circle', center: 'center', radius: 0.055 },
      paint: { kind: 'fill' },
    },
    {
      id: 'signal', role: 'decorator',
      geometry: { kind: 'circle', center: 'signal', radius: 0.045 },
      paint: { kind: 'fill' },
    },
  ],
  composition: { kind: 'layers' },
  decorators: [
    { id: 'signal-overlay', kind: 'overlay', partId: 'signal', targetPartIds: ['body'] },
  ],
  negativeSpace: [
    {
      id: 'canvas-margin', kind: 'exterior-margin', minimum: 0.2,
      participants: ['body', 'focus', 'signal'],
      measurement: 'ink-bounds-to-canvas',
    },
  ],
} satisfies DesignSpec;

const glyph = compileDesignSpec(beacon, { icon: 'focus-beacon', size: 24 });
```

Порядок `parts` задаёт порядок слоёв. Все три части имеют устойчивые имена.
Декоратор фиксирует отношение сигнала к кольцу; его положение и окраску задаёт
сама часть. Компилятор не добавляет скрытую геометрию из имени декоратора.

## 2. Показать SVG

```ts
const host = document.querySelector<HTMLElement>('#beacon');
if (!host) throw new Error('Нет контейнера #beacon');

host.innerHTML = renderGlyphSvg(glyph, { instanceId: 'beacon-main' });
const svg = host.querySelector('svg')!;
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', 'Фокус активен');
```

`instanceId` должен быть уникален в документе. Renderer сохраняет имена частей
и изолирует SVG-ресурсы экземпляра, в том числе маски. Цвет берётся из CSS
`color` контейнера. Декоративному символу задайте `aria-hidden="true"` вместо
доступного имени; интерактивной кнопкой и её областью нажатия владеет интерфейс.

Проверьте рисунок в размерах 16, 24 и 48:

```ts
const preview = document.querySelector<HTMLElement>('#sizes');
if (!preview) throw new Error('Нет контейнера #sizes');
preview.innerHTML = [16, 24, 48].map(size => renderGlyphSvg(
  compileDesignSpec(beacon, { icon: 'focus-beacon', size }),
  { instanceId: `beacon-${size}` },
)).join('');
```

`size` задаёт ширину и высоту SVG. Контуры и относительная толщина штриха
сохраняются; автоматическая оптическая адаптация из этого параметра не следует.
Для Outline и Filled передайте независимо нарисованные спецификации и явно
укажите `variant`. Этот параметр обозначает начертание, а геометрию задаёт автор.

## 3. Экспортировать результат

Скомпилируйте спецификацию при сборке и сохраните SVG. В Node.js:

```ts
import { writeFile } from 'node:fs/promises';

await writeFile('focus-beacon.svg', glyph.svg, 'utf8');
```

Статический потребитель может загрузить полученный файл без authoring runtime.
SVG сохраняет `currentColor`; внешний `<img>` имеет собственный контекст цвета.
Для управляемого цвета вставьте SVG в документ или задайте цвет при подготовке
отдельного статического файла.

`glyph.provenance.specSha256` связывает результат с нормализованной спецификацией.
`glyph.designSpec` содержит разрешённые якоря, декораторы и измеренные ограничения
negative space. Сохраните их рядом с авторской спецификацией, если приложение
использует анатомию знака. Наличие `morphGroup` само по себе не доказывает
совместимость контуров для morph.

## 4. Обработать отказ

```ts
import { DesignSpecError } from '@labpics/icons/authoring';

try {
  compileDesignSpec(beacon, { icon: 'focus-beacon' });
} catch (error) {
  if (!(error instanceof DesignSpecError)) throw error;
  console.error(error.code, error.at, error.message);
}
```

Ошибки имеют код и адрес поля. Например, `UNSUPPORTED_COMPOSITION` означает
stroke в `compound`: выберите поддержанную композицию или подготовьте авторские
залитые контуры. `CONSTRAINT_VIOLATION` требует исправить геометрию либо честно
пересмотреть исходное требование к отступу. Компилятор не ослабляет его молча.

Состав грамматики и точные ограничения описаны в
[справочнике DesignSpec](authoring-reference.md).
