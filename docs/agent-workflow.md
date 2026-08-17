# Как агент создаёт иконку — гайд

Цель процесса — получить пару `Outline`/`Filled`, совместимую с библиотекой, не выдавая статический SVG за параметрическую или анимационную модель.

## Что является контрактом

- `iconDesignContract` из `@labpics/icons/ir` — машинная граница канвы, исходного SVG, осей и экспортных целей;
- `semantics/grid.json` — размеры, keylines, веса, просветы и допустимые направления;
- `docs/foundations.md` — правила оптики, отрицательного пространства и semantic parts;
- `glyphCapabilities(icon, variant)` — фактические возможности конкретного варианта.

Метрика не выбирает красивую форму. Она отбрасывает решения, которые нарушают измеримый инвариант. Силуэт, узнаваемость и характер проверяются визуально рядом с иконками того же архетипа.

## Рабочий маршрут

1. Сформулировать смысл иконки одним предложением и выбрать ближайшие семейства в каталоге.
2. Выбрать keyline по типу массы: круг, квадрат, широкая или высокая форма.
3. Нарисовать `Outline` и `Filled` как два самостоятельных мастера. Filled не получается механическим расширением Outline.
4. Экспортировать пару в `<export-dir>/{Outline,Filled}` и положить рядом
   `<export-dir>/proposal.json`. Proposal обязан явно назвать смысл, ближайшие
   семейства, keyline, relationship мастеров, измеримые negative-space
   constraints, optical-size policy, semantic parts и возможные жесты.
5. Проверить предложение без записи в репозиторий:

   ```powershell
   pnpm validate:proposal -- --source "<export-dir>" --icons icon-name --json
   ```

6. После визуального review импортировать пару:

   ```powershell
   pnpm import:figma -- --source "<export-dir>" --icons icon-name --write
   ```

7. Пересобрать каталог, открыть Observatory и пройти полный gate:

   ```powershell
   pnpm build
   pnpm observatory
   pnpm verify
   ```

`validate:proposal` проверяет закрытый SVG-язык, строгую схему proposal,
существование family references, парность, канву/поля, fill-rule/topology,
keyline-контейнеры и доказуемый сдвиг идентичных контуров. Команда ничего не
записывает. `pnpm verify` остаётся единственным финальным gate.

Минимальный пример `proposal.json`:

```json
{
  "version": 1,
  "icon": "sample",
  "intent": "Один проверяемый смысл знака без скрытой второй трактовки.",
  "family": {
    "references": ["square"],
    "sharedRules": ["центрирование по square keyline"]
  },
  "keyline": { "kind": "square", "reason": "Компактная квадратная масса." },
  "variants": {
    "relationship": "independent-masters",
    "outline": {
      "role": "контурный master",
      "negativeSpace": [{
        "id": "body.counter",
        "kind": "counter",
        "minimum": 0.033333,
        "participants": ["body"],
        "measurement": "minimum counter width"
      }]
    },
    "filled": {
      "role": "заливочный master",
      "negativeSpace": [{
        "id": "body.margin",
        "kind": "exterior-margin",
        "minimum": 0.041667,
        "participants": ["body"],
        "measurement": "ink bounds to canvas"
      }]
    }
  },
  "opticalSizing": {
    "mode": "fixed-master",
    "masters": [{ "size": 24, "source": "paired Figma export" }],
    "behavior": ["opsz не заявлен"]
  },
  "parts": [{ "id": "body", "role": "body", "anchor": null, "moves": false }],
  "motion": { "state": "none", "gestures": [] }
}
```

## Уровни зрелости

- `source-only` — отгружается точный SVG; оси, semantic parts и motion не заявлены;
- `candidate` — конструктивная модель существует, но default API продолжает отдавать source;
- `accepted` — модель прошла fidelity, topology и raster proof;
- ось появляется в `supportedAxes` только после отдельного доказательства на всём диапазоне;
- `motion.state = semantic-parts` означает стабильные части без жеста;
- `motion.state = anchored-parts` означает части и transform anchors, но не проверенный жест;
- `motion.state = gesture-ready` означает явный gesture contract и trajectory proof, но не готовый Lottie/SF Symbols экспорт.

`opsz` меняет пропорции, просветы и детали. Масштабирование готового SVG не является optical-size master.

## Границы

- Lottie и SF Symbols adapters не входят в package surface. Их нельзя заявлять по наличию path IDs или anchors.
- Автоматические gates не заменяют визуальное review.
- Geometry-derived IDs у `source-only` стабильны для неизменной геометрии, но не являются semantic part names.
- Новая ось, motion gesture или morph требует собственного контракта и RED-proof; общий fallback запрещён.

## Откат

До merge откат состоит из возврата пары SVG и связанных деклараций к предыдущему commit с последующим `pnpm build && pnpm verify`. Импорт не меняет внешние системы и не публикует пакет.
